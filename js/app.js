// App shell: header, mobile drawer, footer, router.
import { $, $$, state, icon, esc, api, token, toast, announce, setTitle, trapFocus, closeModal, loadRate, loadSession, loadLedger, usd, ngn, ROLE_LABEL } from "./core.js";
import { stopHero } from "./hero.js";
import * as pub from "./pages-public.js?v=7";
import * as acct from "./pages-account.js?v=7";
import * as camp from "./pages-campaign.js?v=7";

const NAV = [
  ["campaigns", "Campaigns"],
  ["#home-how", "How it works"],
  ["ledger", "Public ledger"],
  ["ussd", "Pay by USSD"],
  ["#home-trust", "Trust"],
];

const ROUTES = {
  "": pub.home,
  campaigns: pub.campaigns,
  c: camp.detail,
  how: pub.how,
  trust: pub.trust,
  ledger: pub.ledger,
  ussd: pub.ussd,
  terms: pub.terms,
  privacy: pub.privacy,
  signin: acct.signin,
  signup: acct.signup,
  start: acct.start,
  dashboard: acct.dashboard,
  donor: acct.donor,
  admin: acct.admin,
};

let current = "";
let first = true;
let renderId = 0;

/* ---------- theme ---------- */
function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("unifund_theme", next); } catch {}
  renderHeader();
  $("#theme-btn")?.focus();
  announce(`${next === "dark" ? "Dark" : "Light"} theme on`);
}
const themeBtn = () => `<button class="icon-btn" id="theme-btn" aria-label="Switch to ${isDark() ? "light" : "dark"} theme">${icon(isDark() ? "sun" : "moon")}</button>`;

/* ---------- header ---------- */
const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

function accountLinks() {
  const u = state.user;
  if (!u) return [];
  if (u.role === "admin") return [["#/admin", "layout-dashboard", "Audit panel"], ["#/start", "plus", "New campaign"]];
  if (u.role === "student_org") return [["#/dashboard", "layout-dashboard", "Organization dashboard"], ["#/start", "plus", "New campaign"]];
  return [["#/donor", "receipt", "My contributions"]];
}

function navHref(target) {
  if (target.startsWith("#")) {
    return current === "" ? target : "#/" + target;
  }
  return "#/" + target;
}

function renderHeader() {
  const u = state.user;
  const isCampActive = current === "campaigns" || current === "c";
  
  const right = u
    ? `<div class="usermenu">
         <button class="user-trigger" id="user-btn" aria-expanded="false" aria-controls="user-menu" aria-haspopup="true">
           <span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><span class="user-name-text">${esc(u.name.split(" ")[0])}</span>${icon("chevron-down", "sm")}
         </button>
         <div class="menu" id="user-menu" hidden>
           <div class="menu-id"><b>${esc(u.name)}</b><span>${esc(ROLE_LABEL[u.role] || u.role)}${u.org_name ? " · " + esc(u.org_name) : ""}</span></div>
           ${accountLinks().map(([h, ic, l]) => `<a href="${h}">${icon(ic)}${l}</a>`).join("")}
           <button id="logout-btn">${icon("log-out")}Sign out</button>
         </div>
       </div>`
    : `<div class="nav-auth-group">
         <a class="nav-signin-link" href="#/signin">Sign in</a>
         <a class="btn primary-nav-btn" href="#/signup">Get started</a>
       </div>`;

  $("#site-header").innerHTML = `
    <div class="wrap head-in">
      <div class="head-left">
        <a class="brand" href="#/" aria-label="UniFund home">
          <span class="brand-mark">${markSvg()}</span>
          <span class="brand-text">UniFund</span>
        </a>
      </div>

      <!-- Clean, minimal central pill bar for desktop -->
      <nav class="nav-pill-bar hide-sm" aria-label="Main">
        <a class="nav-pill ${isCampActive ? "active" : ""}" href="#/campaigns">Explore</a>
        <div class="nav-dropdown-wrap" id="nav-info-dropdown">
          <button class="nav-pill nav-dropdown-btn" id="info-menu-btn" type="button" aria-expanded="false" aria-haspopup="true">
            <span>Platform</span>${icon("chevron-down", "sm")}
          </button>
          <div class="nav-dropdown-popover" id="info-menu-popover" hidden>
            <a class="dropdown-item" href="#/ledger">
              <div class="item-ico">${icon("hash", "sm")}</div>
              <div><b>Public ledger</b><span>SQLite sample records and sandbox simulations</span></div>
            </a>
            <a class="dropdown-item" href="#/ussd">
              <div class="item-ico">${icon("smartphone", "sm")}</div>
              <div><b>USSD concept</b><span>Non-payable flow preview only</span></div>
            </a>
            <a class="dropdown-item" href="${navHref("#home-trust")}">
              <div class="item-ico">${icon("shield-check", "sm")}</div>
              <div><b>Trust & Security</b><span>Review workflow and prototype limits</span></div>
            </a>
          </div>
        </div>
      </nav>

      <div class="head-actions">
        ${themeBtn()}
        ${right}
        <button class="icon-btn burger" id="burger" aria-label="Open menu" aria-haspopup="dialog">${icon("menu")}</button>
      </div>
    </div>`;

  $("#theme-btn").addEventListener("click", toggleTheme);
  $("#burger").addEventListener("click", openDrawer);

  // Wire platform dropdown popover
  const infoBtn = $("#info-menu-btn");
  const infoPopover = $("#info-menu-popover");
  if (infoBtn && infoPopover) {
    const toggleInfo = (open) => {
      const isExpanded = open !== undefined ? open : infoPopover.hidden;
      infoPopover.hidden = !isExpanded;
      infoBtn.setAttribute("aria-expanded", String(isExpanded));
    };
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleInfo();
    });
    infoPopover.addEventListener("click", (e) => {
      if (e.target.closest("a")) toggleInfo(false);
    });
    document.addEventListener("click", (e) => {
      if (!infoPopover.hidden && !e.target.closest("#nav-info-dropdown")) {
        toggleInfo(false);
      }
    });
  }

  const ub = $("#user-btn");
  if (ub) wireUserMenu(ub);
}

const markSvg = () => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg>`;

function wireUserMenu(btn) {
  const menu = $("#user-menu");
  const close = (refocus) => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); if (refocus) btn.focus(); };
  btn.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) $("a,button", menu)?.focus();
  });
  menu.addEventListener("keydown", (e) => {
    const items = $$("a,button", menu);
    const i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) close(false); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest(".usermenu")) close(false); });
  $("#logout-btn").addEventListener("click", signOut);
}

async function signOut() {
  await api("/api/auth/logout", { method: "POST" });
  token.clear();
  state.user = null;
  closeDrawer();
  renderHeader();
  location.hash = "#/";
  toast("You are signed out");
}

/* ---------- mobile drawer ---------- */
let drawer = null;
function openDrawer() {
  if (drawer) return;
  const u = state.user;
  const root = document.createElement("div");
  root.id = "drawer-root";
  root.innerHTML = `
    <div class="scrim" data-scrim></div>
    <div class="drawer" role="dialog" aria-modal="true" aria-label="Site menu">
      <div class="drawer-top">
        <a class="brand" href="#/" aria-label="UniFund home"><span class="brand-mark">${markSvg()}</span>UniFund</a>
        <button class="icon-btn" id="drawer-close" aria-label="Close menu">${icon("x")}</button>
      </div>
      <nav class="drawer-body" aria-label="Mobile">
        ${NAV.map(([k, l]) => `<a class="dlink" href="${navHref(k)}" ${current === k || (k === "campaigns" && current === "c") ? 'aria-current="page"' : ""}>${l}${icon("chevron-right")}</a>`).join("")}
        ${u ? accountLinks().map(([h, , l]) => `<a class="dlink" href="${h}">${l}${icon("chevron-right")}</a>`).join("") : ""}
      </nav>
      <div class="drawer-foot">
        ${u
          ? `<div class="drawer-id"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><div><b>${esc(u.name)}</b><span>${esc(ROLE_LABEL[u.role] || "")}</span></div></div>
             <button class="btn sec block" id="drawer-logout">${icon("log-out")}Sign out</button>`
          : `<a class="btn block lg" href="#/signup">Get started free</a>
             <a class="btn sec block lg" href="#/signin">Sign in</a>`}
        <p class="muted center" style="font-size:.8125rem">Sample USD/NGN ${ngn(state.rate)} · sandbox only</p>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.style.overflow = "hidden";
  $("#burger")?.setAttribute("aria-expanded", "true");
  const trap = trapFocus($(".drawer", root), { onClose: closeDrawer });
  drawer = { root, trap };
  $("#drawer-close", root).focus();
  $("[data-scrim]", root).addEventListener("click", closeDrawer);
  $("#drawer-close", root).addEventListener("click", closeDrawer);
  root.addEventListener("click", (e) => { if (e.target.closest("a")) closeDrawer(true); });
  $("#drawer-logout", root)?.addEventListener("click", signOut);
}
function closeDrawer(skipFocus) {
  if (!drawer) return;
  const { root, trap } = drawer;
  drawer = null;
  root.remove();
  document.body.style.overflow = "";
  $("#burger")?.setAttribute("aria-expanded", "false");
  if (skipFocus === true) { trap.release(); $("#main")?.focus({ preventScroll: true }); } else trap.release();
}
addEventListener("resize", () => { if (drawer && innerWidth > 960) closeDrawer(true); });

/* ---------- footer: laid out like a table of contents ---------- */
const TOC = [
  ["Fund", [["campaigns", "Browse campaigns"], ["ledger", "Public ledger"], ["ussd", "Pay by USSD"]]],
  ["Raise", [["start", "Start a campaign"], ["signup", "Create an account"], ["signin", "Sign in"]]],
  ["About", [["how", "How it works"], ["trust", "Trust and security"], ["terms", "Terms"], ["privacy", "Privacy"]]],
];
function renderFooter() {
  let n = 0;
  const toc = TOC.map(([h, items]) => `<div><h3>${h}</h3><ul>${items.map(([r, l]) => `<li><a href="#/${r}">${l}<span>${String(++n).padStart(2, "0")}</span></a></li>`).join("")}</ul></div>`).join("");
  $("#site-footer").innerHTML = `
    <div class="wrap">
      <div class="foot-top">
        <div class="foot-lead">
          <a class="brand" href="#/" aria-label="UniFund home" style="margin-bottom:22px"><span class="brand-mark">${markSvg()}</span>UniFund</a>
          <h2>Student projects deserve a clear record.</h2>
          <p>Explore the campus campaign, committee-review and audit-trail prototype. Payments are simulated.</p>
          <a class="btn" href="#/campaigns" style="margin-top:24px">Browse campaigns</a>
        </div>
        <nav class="toc" aria-label="Footer">${toc}</nav>
      </div>
      <div class="foot-bar">
        <div class="live" id="foot-live" aria-label="Prototype status">
          <span>Sample USD/NGN <span class="mono">${ngn(state.rate)}</span></span>
          <span id="foot-records">Ledger <span class="mono">loading…</span></span>
        </div>
        <span>© ${new Date().getFullYear()} UniFund · Built for Nigerian university student groups</span>
      </div>
    </div>`;
  loadLedger().then((l) => {
    const el = $("#foot-records");
    if (el && l) {
      const sampleUsd = l.filter((x) => x.status === "verified").reduce((s, x) => s + (x.amount_usd || 0), 0);
      el.innerHTML = `Sandbox ledger <span class="mono">${l.length} sample records · ${usd(sampleUsd)} seeded</span>`;
    }
    else if (el) el.textContent = "Ledger unavailable";
  });
}

/* ---------- router ---------- */
function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  // If the hash starts with an in-page anchor like #home-campaigns or #home-trust
  if (raw.startsWith("home-") || raw.startsWith("#home-")) {
    const anchor = raw.replace(/^#/, "");
    return { key: "", parts: [], query: new URLSearchParams(), anchor };
  }
  const [path, qs] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { key: parts[0] || "", parts: parts.slice(1), query: new URLSearchParams(qs || "") };
}

async function route() {
  const { key, parts, query, anchor } = parse();
  const id = ++renderId;
  closeDrawer(true);
  stopHero();
  closeModal();
  document.body.style.overflow = "";
  current = key;
  renderHeader();
  const main = $("#main");
  const fn = ROUTES[key];
  let title;
  if (!fn) title = pub.notFound(main);
  else title = await fn(main, { parts, query, isStale: () => id !== renderId });
  if (id !== renderId) return;
  setTitle(title);
  
  if (anchor) {
    setTimeout(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }, 100);
  } else {
    window.scrollTo(0, 0);
  }

  if (!first) {
    const h = main.querySelector("h1") || main;
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: true });
    announce(title || "UniFund");
  }
  first = false;
}

addEventListener("hashchange", route);
addEventListener("uf:auth", () => { renderHeader(); });
addEventListener("uf:rate", renderFooter);

(async function boot() {
  $("#main").innerHTML = `<div class="page"><div class="wrap"><div class="skeleton" aria-busy="true" aria-label="Loading"></div></div></div>`;
  await Promise.all([loadRate(), loadSession()]);
  renderHeader();
  renderFooter();
  route();
})();
