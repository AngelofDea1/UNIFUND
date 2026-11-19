// Decorative hero motion is brief and disabled when reduced motion is requested.
import { $ } from "./core.js?v=16";

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const MAX_DURATION = 4000;
let raf = 0;
let cleanup = null;

const smooth = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };

export function stopHero() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (cleanup) cleanup();
  cleanup = null;
}

export function startHero() {
  stopHero();
  const cv = $("#hero-canvas");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;

  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const CELL = 8;
  let w = 0, h = 0, img, rgb = [27, 94, 87], frameTime = performance.now(), startedAt = 0, last = 0, finished = false;
  let box = { cx: 0, cy: 0, hw: 0, hh: 0, f: 20 };

  function size() {
    const r0 = cv.getBoundingClientRect();
    w = Math.max(1, Math.ceil(r0.width / CELL));
    h = Math.max(1, Math.ceil(r0.height / CELL));
    cv.width = w;
    cv.height = h;
    img = ctx.createImageData(w, h);
    const m = getComputedStyle(cv).color.match(/[\d.]+/g);
    if (m) rgb = [+m[0], +m[1], +m[2]];
    const t = $(".hero-in");
    const r = t ? t.getBoundingClientRect() : r0;
    box = {
      cx: (r.left + r.width / 2 - r0.left) / CELL,
      cy: (r.top + r.height / 2 - r0.top) / CELL,
      hw: Math.min(r.width / 2 / CELL, w / 2),
      hh: r.height / 2 / CELL + 2,
      f: Math.max(14, Math.min(w, h) * 0.5),
    };
  }

  function draw(t) {
    frameTime = t;
    const d = img.data;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const alpha = dark ? 70 : 62;
    for (let y = 0; y < h; y++) {
      const ny = y / h;
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const v = 0.5 + 0.3 * Math.sin(nx * 7 + t * 0.00022 + Math.sin(ny * 4 + t * 0.00016) * 1.5) + 0.2 * Math.sin(ny * 8 - t * 0.0002 + nx * 2.5);
        const ex = Math.max(0, Math.abs(x - box.cx) - box.hw);
        const ey = Math.max(0, Math.abs(y - box.cy) - box.hh);
        const clear = smooth(0, box.f, Math.sqrt(ex * ex + ey * ey));
        const val = v * (0.28 + 0.72 * ny) * clear * 1.15;
        const i = (y * w + x) * 4;
        if (val > BAYER[(y & 3) * 4 + (x & 3)]) {
          d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = alpha;
        } else d[i + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function tick(now) {
    if (!cv.isConnected || motionQuery.matches) { raf = 0; return; }
    if (now - startedAt >= MAX_DURATION) {
      draw(startedAt + MAX_DURATION);
      raf = 0;
      finished = true;
      return;
    }
    if (now - last > 50) { last = now; draw(now); }
    raf = requestAnimationFrame(tick);
  }

  const play = () => {
    if (finished || motionQuery.matches || raf) return;
    startedAt = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const onMotionChange = () => {
    if (motionQuery.matches) {
      cancelAnimationFrame(raf);
      raf = 0;
      draw(frameTime);
    } else play();
  };
  const onResize = () => { size(); draw(frameTime); };

  size();
  draw(frameTime);
  addEventListener("resize", onResize);
  if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
  else motionQuery.addListener(onMotionChange);
  const themeObs = new MutationObserver(() => {
    rgb = (getComputedStyle(cv).color.match(/[\d.]+/g) || rgb).map(Number);
    draw(frameTime);
  });
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  play();

  cleanup = () => {
    removeEventListener("resize", onResize);
    if (motionQuery.removeEventListener) motionQuery.removeEventListener("change", onMotionChange);
    else motionQuery.removeListener(onMotionChange);
    themeObs.disconnect();
  };
}
