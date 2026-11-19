// Shared HTML builders
import { esc, icon, usd, ngn, pct, progressBar, CATS } from "./core.js?v=15";

export const loading = (main, label = "Loading") => {
  main.innerHTML = `<div class="page"><div class="wrap"><div class="skeleton" role="status" aria-busy="true" aria-label="${esc(label)}"></div></div></div>`;
};

export const offline = (main, msg) => {
  main.innerHTML = `<div class="page"><div class="narrow"><div class="empty">${icon("triangle-alert")}<h1 style="font-size:1.5rem;color:var(--ink)">Something is not connecting</h1><p>${esc(msg || "We could not reach the UniFund server.")}</p><button class="btn" id="retry">Try again</button></div></div></div>`;
  main.querySelector("#retry").addEventListener("click", () => dispatchEvent(new Event("uf:route")));
};

export const pageHead = (title, lead, eyebrow) =>
  `<div class="page-head">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}<h1>${esc(title)}</h1>${lead ? `<p>${lead}</p>` : ""}</div>`;

export const empty = (ic, title, text, action) =>
  `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3><p>${text}</p>${action || ""}</div>`;

export function campaignCard(c, lvl = 3) {
  const p = pct(c);
  return `
  <a class="card" href="/c/${c.id}" aria-label="${esc(c.title)}, ${p}% of example goal">
    <div class="card-top">
      <span class="card-campus-badge">${esc(c.campus)}</span>
      <span class="card-cat-badge">${esc(CATS[c.category] || "Initiative")}</span>
    </div>
    <div class="card-org-sub">${esc(c.org)}</div>
    <h${lvl}>${esc(c.title)}</h${lvl}>
    <p class="desc">${esc(c.about)}</p>
    ${progressBar(c, `${c.title} funding progress`)}
    <div class="card-stats">
      <div><strong>${usd(c.raised_usd)}</strong><span>example amount · ${ngn(c.raised_ngn)}</span></div>
      <div><strong>${p}% of ${usd(c.goal_usd)}</strong><span>example progress · ${c.days}-day campaign</span></div>
    </div>
  </a>`;
}

export const FAQ = [
  ["Who can start a campaign?", "Student organizations can create a campaign and send it for committee review. UniFund does not verify student identity yet."],
  ["Can I make a real payment?", "No. The payment screen is a walkthrough only. It does not open a wallet, send a payment, or save a contribution."],
  ["Will UniFund ask for my PIN?", "No. Never share your bank PIN, password or wallet recovery phrase."],
  ["What is in the public ledger?", "It includes example entries and saved test records. It does not show verified payments."],
  ["Do I need an account?", "No account is needed to explore campaigns, the payment walkthrough, or the public ledger. An account is needed to submit a campaign or report spending."],
];

export const faq = (items = FAQ) =>
  `<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><div>${esc(a)}</div></details>`).join("")}</div>`;
