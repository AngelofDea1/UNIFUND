// Shared HTML builders
import { esc, icon, usd, ngn, pct, progressBar, CATS } from "./core.js";

export const loading = (main, label = "Loading") => {
  main.innerHTML = `<div class="page"><div class="wrap"><div class="skeleton" role="status" aria-busy="true" aria-label="${esc(label)}"></div></div></div>`;
};

export const offline = (main, msg) => {
  main.innerHTML = `<div class="page"><div class="narrow"><div class="empty">${icon("triangle-alert")}<h1 style="font-size:1.5rem;color:var(--ink)">Something is not connecting</h1><p>${esc(msg || "We could not reach the UniFund server.")}</p><button class="btn" id="retry">Try again</button></div></div></div>`;
  main.querySelector("#retry").addEventListener("click", () => dispatchEvent(new HashChangeEvent("hashchange")));
};

export const pageHead = (title, lead, eyebrow) =>
  `<div class="page-head">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1>${esc(title)}</h1>${lead ? `<p>${lead}</p>` : ""}</div>`;

export const empty = (ic, title, text, action) =>
  `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${text}</p>${action || ""}</div>`;

export function campaignCard(c, lvl = 3) {
  const p = pct(c);
  return `
  <a class="card" href="#/c/${c.id}" aria-label="${esc(c.title)}, ${p}% funded">
    <div class="card-top">
      <span class="card-campus-badge">${esc(c.campus)}</span>
      <span class="card-cat-badge">${esc(CATS[c.category] || "Initiative")}</span>
    </div>
    <div class="card-org-sub">${esc(c.org)}</div>
    <h${lvl}>${esc(c.title)}</h${lvl}>
    <p class="desc">${esc(c.about)}</p>
    ${progressBar(c, `${c.title} funding progress`)}
    <div class="card-stats">
      <div><strong>${usd(c.raised_usd)}</strong><span>${ngn(c.raised_ngn)}</span></div>
      <div><strong>${p}% of ${usd(c.goal_usd)}</strong><span>${c.days} days left</span></div>
    </div>
  </a>`;
}

export const FAQ = [
  ["Who can start a campaign?", "Student organizations with a UniFund account. Every campaign is reviewed by the audit committee before it appears in the directory"],
  ["What can I pay with?", "No live payment methods are connected yet. This hackathon prototype can create simulated USDT and naira receipts; no money moves."],
  ["Does UniFund ever ask for my bank PIN?", "Never. Payment integrations are not enabled in this prototype. Do not enter a PIN, real transfer reference, wallet seed phrase or private key."],
  ["How do I know my contribution was recorded?", "Sandbox entries are labeled as simulations in the prototype ledger. They are not verified payments."],
  ["Do I need an account to contribute?", "No. You can contribute without signing in. Create a backer account if you want a history of your receipts"],
];

export const faq = (items = FAQ) =>
  `<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}</div>`;
