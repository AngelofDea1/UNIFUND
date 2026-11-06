// Core helpers: state, API client, formatting, icons, dialogs, toasts, focus handling.
import { ICONS } from "./icons.js";
import { SEED_CAMPAIGNS, SEED_LEDGER } from "./mock-data.js";

/* Set to false before a real launch: hides demo accounts, sample hashes and test-mode notes. */
export const DEMO = true;

export const state = {
  user: null,
  rate: 1540.5,
  campaigns: null,
  ledger: null,
  apiDown: false,
};

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const usd = (n) => "$" + (n % 1 && n < 10 ? Number(n).toFixed(2) : Math.round(n || 0).toLocaleString("en-US"));
export const ngn = (n) => "₦" + Math.round(n || 0).toLocaleString("en-US");
export const pct = (c) => (c.goal_usd > 0 ? Math.min(100, Math.round((c.raised_usd / c.goal_usd) * 100)) : 0);
export const short = (h, n = 14) => (h && h.length > n ? h.slice(0, n) + "…" : h || "");

export const CATS = {
  tech: "Technology",
  labs: "Laboratories",
  competitions: "Competitions",
  energy: "Clean energy",
};
export const ROLE_LABEL = { admin: "Audit committee", student_org: "Student organization", donor: "Backer" };
export const CHANNEL_LABEL = { USDT_TRC20: "USDT (TRC-20)", NAIRA_TRANSFER: "Naira transfer", USSD_GATEWAY: "USSD" };

export function icon(name, cls = "") {
  const inner = ICONS[name] || "";
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/* ---------- API ---------- */
export const token = {
  get: () => { try { return localStorage.getItem("unifund_token"); } catch { return null; } },
  set: (t) => { try { localStorage.setItem("unifund_token", t); } catch {} },
  clear: () => { try { localStorage.removeItem("unifund_token"); } catch {} },
};

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const t = token.get();
  if (auth && t) headers.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    state.apiDown = true;
    return { ok: false, status: 0, data: { error: "We could not reach the UniFund server. Check your connection and try again." } };
  }
  let data = {};
  try { data = await res.json(); } catch { data = { error: "The server sent an unexpected response." }; }
  if (res.status === 401 && auth && t && path !== "/api/auth/login") {
    token.clear();
    state.user = null;
  }
  state.apiDown = false;
  return { ok: res.ok, status: res.status, data };
}

export async function loadRate() {
  const r = await api("/api/exchange-rate", { auth: false });
  if (r.ok && r.data.rate) state.rate = r.data.rate;
}
export async function loadSession() {
  if (!token.get()) { state.user = null; return; }
  const r = await api("/api/auth/me");
  state.user = r.ok ? r.data.user : null;
}
export async function loadCampaigns(force = false) {
  if (state.campaigns && !force) return state.campaigns;
  const r = await api("/api/campaigns?status=approved", { auth: false });
  if (r.ok && Array.isArray(r.data.campaigns)) {
    state.campaigns = r.data.campaigns;
  } else {
    // If backend server is unreachable (such as on static hosts like Vercel or GitHub Pages),
    // fall back cleanly to seeded campaign data rather than failing with an error.
    state.campaigns = SEED_CAMPAIGNS;
  }
  return state.campaigns;
}
export async function loadLedger(force = false) {
  if (state.ledger && !force) return state.ledger;
  const r = await api("/api/ledger", { auth: false });
  if (r.ok && Array.isArray(r.data.ledger)) {
    state.ledger = r.data.ledger;
  } else {
    state.ledger = SEED_LEDGER;
  }
  return state.ledger;
}

/* ---------- announcements, toasts ---------- */
export function announce(msg) {
  const a = $("#announcer");
  if (!a) return;
  a.textContent = "";
  setTimeout(() => (a.textContent = msg), 50);
}

export function toast(msg, kind = "ok") {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `${icon(kind === "bad" ? "triangle-alert" : "circle-check", "sm")}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed. Select the text and copy it manually.", "bad");
  }
}

/* ---------- focus trap + dialogs ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let trapStack = [];

export function trapFocus(container, { onClose } = {}) {
  const opener = document.activeElement;
  const keydown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose && onClose(); return; }
    if (e.key !== "Tab") return;
    const items = $$(FOCUSABLE, container).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", keydown);
  const entry = { release() { document.removeEventListener("keydown", keydown); if (opener && opener.isConnected) opener.focus(); } };
  trapStack.push(entry);
  return entry;
}

let currentModal = null;
export function openModal(html, { label, wide = false, printable = false, focus } = {}) {
  closeModal(true);
  const layer = $("#layer");
  const id = "dlg-" + Math.random().toString(36).slice(2, 7);
  layer.innerHTML = `
    <div class="overlay" data-overlay>
      <div class="modal ${printable ? "printable" : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}" tabindex="-1">
        <button class="icon-btn modal-x no-print" data-close aria-label="Close dialog">${icon("x")}</button>
        <h2 id="${id}">${esc(label)}</h2>
        <div data-body>${html}</div>
      </div>
    </div>`;
  document.body.style.overflow = "hidden";
  const overlay = $("[data-overlay]", layer);
  const dlg = $(".modal", layer);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) closeModal(); });
  $("[data-close]", dlg).addEventListener("click", () => closeModal());
  const trap = trapFocus(dlg, { onClose: () => closeModal() });
  currentModal = { trap };
  const target = focus ? $(focus, dlg) : null;
  (target || dlg).focus();
  return dlg;
}
export function setModalBody(html, label) {
  const dlg = $("#layer .modal");
  if (!dlg) return null;
  $("[data-body]", dlg).innerHTML = html;
  if (label) $("h2", dlg).textContent = label;
  return dlg;
}
export function closeModal(silent = false) {
  if (!currentModal) { $("#layer").innerHTML = ""; return; }
  const { trap } = currentModal;
  currentModal = null;
  $("#layer").innerHTML = "";
  document.body.style.overflow = "";
  trap.release();
}

/* ---------- forms ---------- */
export function setFieldError(input, msg) {
  const id = input.id;
  let box = document.getElementById(id + "-err");
  if (!box) {
    box = document.createElement("div");
    box.id = id + "-err";
    box.className = "err";
    (input.closest(".pw") || input).insertAdjacentElement("afterend", box);
  }
  if (msg) {
    box.innerHTML = `${icon("circle-x")}<span>${esc(msg)}</span>`;
    input.setAttribute("aria-invalid", "true");
    const d = (input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    if (!d.includes(box.id)) d.push(box.id);
    input.setAttribute("aria-describedby", d.join(" "));
  } else {
    box.innerHTML = "";
    input.removeAttribute("aria-invalid");
  }
}

/* validate a form by rules {fieldId: (value)=> message|""}; focuses the first error and returns true when valid */
export function validate(form, rules, summarySel) {
  let first = null;
  const errors = [];
  for (const [id, rule] of Object.entries(rules)) {
    const el = form.querySelector("#" + id);
    if (!el) continue;
    const msg = rule(el.value.trim(), el);
    setFieldError(el, msg);
    if (msg) { errors.push({ id, msg }); if (!first) first = el; }
  }
  const sum = summarySel && form.querySelector(summarySel);
  if (sum) {
    sum.innerHTML = errors.length
      ? `<div class="notice bad" role="alert">${icon("triangle-alert")}<div><b>Please fix ${errors.length} ${errors.length === 1 ? "problem" : "problems"}:</b><ul style="margin:6px 0 0;padding-left:18px">${errors.map((e) => `<li><a href="#${e.id}" data-jump="${e.id}">${esc(e.msg)}</a></li>`).join("")}</ul></div></div>`
      : "";
    sum.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); form.querySelector("#" + a.dataset.jump).focus(); }));
  }
  if (first) first.focus();
  return errors.length === 0;
}

export function serverError(form, msg, summarySel = "[data-summary]") {
  const sum = form.querySelector(summarySel);
  if (sum) {
    sum.innerHTML = `<div class="notice bad" role="alert">${icon("triangle-alert")}<div>${esc(msg)}</div></div>`;
    sum.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = label || "Working…"; }
  else { btn.disabled = false; btn.removeAttribute("aria-busy"); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

/* ---------- QR (vendor/qrcode.js sets window.qrcode) ---------- */
export function qrSvg(text, alt) {
  try {
    const q = window.qrcode(0, "M");
    q.addData(text);
    q.make();
    const svg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    return svg.replace("<svg", `<svg role="img" aria-label="${esc(alt)}"`);
  } catch {
    return `<p class="muted center">QR code unavailable</p>`;
  }
}

export function progressBar(c, label) {
  const p = pct(c);
  return `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="${esc(label || "Funding progress")}"><i style="width:${p}%"></i></div>`;
}

export function statusTag(status) {
  if (status === "approved") return `<span class="tag ok">${icon("circle-check")}Approved</span>`;
  if (status === "rejected") return `<span class="tag bad">${icon("circle-x")}Declined</span>`;
  return `<span class="tag">${icon("clock")}Awaiting review</span>`;
}

export function setTitle(t) {
  document.title = t ? `${t} | UniFund` : "UniFund | Student project funding prototype";
}
