// Public pages: home, campaigns, how it works, trust, ledger, USSD, legal, 404
import {
  $, $$, state, esc, icon, api, usd, ngn, pct, short, toast, copyText, announce, busy, validate, serverError,
  loadCampaigns, loadLedger, CATS, CHANNEL_LABEL,
} from "./core.js?v=15";
import { loading, offline, pageHead, empty, campaignCard, faq, FAQ } from "./components.js?v=15";
import { startHero } from "./hero.js?v=15";
import { showReceipt, fmtDate } from "./pages-campaign.js?v=15";

/* ---------- home ---------- */
export async function home(main, ctx) {
  main.innerHTML = `
  <section class="hero" aria-labelledby="hero-h">
    <canvas id="hero-canvas" aria-hidden="true"></canvas>
    <div class="hero-in">
      <div class="eyebrow hero-pill">Student project funding · Nigeria</div>
      <h1 id="hero-h">Help student teams<br>bring ideas to life</h1>
      <p class="hero-lead">A clearer way for student teams to request support, get reviewed, and report project spending.</p>
      <div class="hero-cta">
        <a class="btn lg" href="/campaigns">Browse campaigns</a>
        <a class="btn sec lg" href="/start">Start a campaign</a>
      </div>
      <div class="hero-trust-badges">
        <span>${icon("shield-check", "sm")} Campaign review</span>
        <span>${icon("wallet", "sm")} Payments planned</span>
        <span>${icon("hash", "sm")} Public records</span>
      </div>
    </div>
  </section>
  <div id="home-rest"><div class="wrap" style="padding:64px 24px"><div class="skeleton" role="status" aria-busy="true" aria-label="Loading"></div></div></div>`;
  startHero();

  const camps = await loadCampaigns(true);
  if (ctx.isStale()) return;
  const list = camps || [];
  const raised = list.reduce((s, c) => s + (c.raised_usd || 0), 0);
  const backers = list.reduce((s, c) => s + (c.backers_count || 0), 0);
  const featured = [...list].sort((a, b) => pct(b) - pct(a)).slice(0, 6);

  $("#home-rest").innerHTML = `
  <section class="stats" aria-label="Campaign examples">
    <div class="stat"><b>${camps === null ? "—" : usd(raised)}</b><span>illustrative USD total</span></div>
    <div class="stat"><b>${camps === null ? "—" : ngn(raised * state.rate)}</b><span>illustrative naira total</span></div>
    <div class="stat"><b>${camps === null ? "—" : backers.toLocaleString()}</b><span>example backers</span></div>
    <div class="stat"><b>${camps === null ? "—" : list.length}</b><span>example campaigns</span></div>
  </section>

  <section class="section" id="home-campaigns" aria-labelledby="feat-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="sec-badge">Campaign examples</span>
        <h2 id="feat-h">Student projects</h2>
        <p>Explore student projects, their budgets, and spending records.<br>Amounts and backer counts are examples.</p>
      </div>
      ${camps === null ? `<div class="notice bad">${icon("triangle-alert")}<div>We could not load campaigns right now. Please try again shortly.</div></div>`
        : featured.length ? `<div class="grid">${featured.map(campaignCard).join("")}</div>
          <p class="center" style="margin-top:40px"><a class="btn sec" href="/campaigns">View all ${list.length} campaigns${icon("arrow-right", "sm")}</a></p>`
        : empty("search", "No campaigns yet", "Be the first group to start one.", `<a class="btn" href="/start">Start a campaign</a>`)}
    </div>
  </section>

  <section class="section tint" id="home-how" aria-labelledby="how-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="how-h">How it works</h2><p>Three steps: submit a campaign, review it and log spending.</p></div>
      ${stepsHtml()}
    </div>
  </section>

  <section class="section" id="home-pay" aria-labelledby="pay-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="pay-h">Payment options</h2><p>USDT and Cleva payments are planned. No payment provider is connected yet.</p></div>
      ${railsHtml()}
    </div>
  </section>

  <section class="section tint" id="home-trust" aria-labelledby="pledge-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="pledge-h">Built for clear records</h2><p>Campaigns go through review, with spending reports visible to supporters.</p></div>
      <ul class="pledge" style="padding:0;margin:0">
        <li>${icon("shield-check")}<h3>Committee review</h3><p>Organizations submit campus details and campaign budgets<br>for review before a campaign is published.</p></li>
        <li>${icon("lock")}<h3>Private payment details</h3><p>Never share a PIN or password.</p></li>
        <li>${icon("hash")}<h3>Transparent audit trail</h3><p>Prototype records receive a database-backed SHA-256 seal.<br>They are not blockchain transactions or immutable storage.</p></li>
      </ul>
    </div>
  </section>

  <section class="section" aria-labelledby="faq-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="faq-h">Questions</h2><p>Quick answers about UniFund.</p></div>
      ${faq()}
    </div>
  </section>

  <section class="cta-band" aria-labelledby="cta-h">
    <h2 id="cta-h">Leading a student project or society?</h2>
    <p>See how a student campaign is submitted, reviewed, and tracked.</p>
    <a class="btn lg" href="/start">Start a campaign</a>
  </section>`;
  return "Student project funding";
}

const stepsHtml = (h = 3) => `
  <ol class="steps" style="padding:0">
    <li class="step"><div class="step-n" aria-hidden="true">1</div><h${h}>Start a campaign</h${h}><p>Describe the project, goal and budget.</p></li>
    <li class="step"><div class="step-n" aria-hidden="true">2</div><h${h}>Get it reviewed</h${h}><p>The committee checks the campaign before it appears.</p></li>
    <li class="step"><div class="step-n" aria-hidden="true">3</div><h${h}>Record spending</h${h}><p>Organizers can add expenses to the public log.</p></li>
  </ol>`;

const csvCell = (value) => {
  const text = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const railsHtml = () => `
  <div class="rails">
    <article class="rail"><div class="badge-ico">${icon("wallet", "")}</div><h3>Tether USDT (TRC-20)</h3><p>Planned for diaspora backers<br>and cross-border supporters.</p>
      <dl><div><dt>Integration</dt><dd>Not connected</dd></div><div><dt>Prototype</dt><dd>Payment walkthrough</dd></div><div><dt>Settlement</dt><dd>Not available</dd></div></dl></article>
    <article class="rail"><div class="badge-ico">${icon("landmark", "")}</div><h3>Cleva USD & Naira</h3><p>Planned for local transfers<br>and campus organizations.</p>
      <dl><div><dt>Integration</dt><dd>Not connected</dd></div><div><dt>Prototype</dt><dd>Payment walkthrough</dd></div><div><dt>Settlement</dt><dd>Not available</dd></div></dl></article>
    <article class="rail"><div class="badge-ico">${icon("smartphone", "")}</div><h3>Offline USSD</h3><p>An access path we intend to explore<br>for students with limited data.</p>
      <dl><div><dt>Integration</dt><dd>Not connected</dd></div><div><dt>Prototype</dt><dd>Dial-code preview only</dd></div><div><dt>Settlement</dt><dd>Not available</dd></div></dl></article>
  </div>`;

/* ---------- campaigns directory ---------- */
export async function campaigns(main, ctx) {
  loading(main, "Loading campaigns");
  const list = await loadCampaigns(true);
  if (ctx.isStale()) return;
  if (list === null) { offline(main, "We could not load campaigns. Check your connection and try again."); return "Campaigns"; }
  let cat = "all";
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Campaign examples", "Explore student projects.<br>All amounts shown are examples.")}
    <div class="toolbar" role="search">
      <div class="search"><label class="sr" for="q">Search campaigns</label>${icon("search")}<input class="input" id="q" type="search" placeholder="Search by project, group or campus" autocomplete="off"></div>
      <div><label class="sr" for="sort">Sort by</label><select class="input" id="sort"><option value="close">Closest to goal</option><option value="new">Newest</option><option value="length">Shortest campaign</option><option value="raised">Largest example amount</option></select></div>
    </div>
    <div class="seg" role="group" aria-label="Filter by category">
      <button type="button" data-cat="all" aria-pressed="true">All</button>
      ${Object.entries(CATS).map(([k, l]) => `<button type="button" data-cat="${k}" aria-pressed="false">${l}</button>`).join("")}
    </div>
    <p class="result-count" id="count" role="status" aria-live="polite"></p>
    <div class="grid" id="grid"></div>
  </div></div>`;
  const grid = $("#grid"), count = $("#count");
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    const s = $("#sort").value;
    let r = list.filter((c) => (cat === "all" || c.category === cat) && (c.title + " " + c.org + " " + c.campus + " " + c.about).toLowerCase().includes(q));
    r.sort((a, b) => s === "new" ? b.id - a.id : s === "length" ? a.days - b.days : s === "raised" ? b.raised_usd - a.raised_usd : pct(b) - pct(a));
    count.textContent = `${r.length} ${r.length === 1 ? "campaign" : "campaigns"}`;
    grid.innerHTML = r.length ? r.map((c) => campaignCard(c, 2)).join("") : empty("search", "No campaigns match", "Try a different word, or clear the filters.", `<button class="btn sec" id="clear">Clear filters</button>`);
    $("#clear")?.addEventListener("click", () => { $("#q").value = ""; cat = "all"; $$("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === "all"))); draw(); });
  };
  $("#q").addEventListener("input", draw);
  $("#sort").addEventListener("change", draw);
  $$("[data-cat]").forEach((b) => b.addEventListener("click", () => { cat = b.dataset.cat; $$("[data-cat]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); }));
  draw();
  return "Campaigns";
}

/* ---------- how it works ---------- */
export function how(main) {
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("How it works", "Submit a campaign. Get it reviewed. Record spending.")}
    ${stepsHtml(2)}
    <div class="sec-head" style="margin-top:80px"><h2>Ways to pay</h2></div>
    ${railsHtml()}
    <div class="sec-head" style="margin-top:80px"><h2>Questions</h2></div>
    ${faq()}
    <p class="center" style="margin-top:48px"><a class="btn lg" href="/campaigns">Browse campaigns</a></p>
  </div></div>`;
  return "How it works";
}

/* ---------- trust ---------- */
export function trust(main) {
  const block = (ic, h, body) => `<section class="panel"><div class="panel-head"><h2 style="display:flex;gap:12px;align-items:center">${icon(ic)}${h}</h2></div><div class="stack muted">${body}</div></section>`;
  main.innerHTML = `
  <div class="page"><div class="narrow">
    ${pageHead("Trust and safety", "What campaign reviews and public records can confirm.")}
    ${block("shield-check", "Campaign review", `<p>Student groups can submit campaigns for review. UniFund does not verify identities yet.</p>`)}
    ${block("hash", "Public records", `<p>The ledger includes example entries and saved test records. It is not a blockchain and does not prove a payment.</p><p><a href="/ledger">View the ledger</a> or download it as a CSV.</p>`)}
    ${block("lock", "Payment safety", `<p>No payment provider is connected yet. Never send money or share your PIN, password or wallet recovery phrase.</p>`)}
    ${block("file-text", "Spending records", `<p>Campaign organizers can post expenses for everyone to see.</p>`)}
  </div></div>`;
  return "Trust and security";
}

/* ---------- public ledger ---------- */
export async function ledger(main, ctx) {
  loading(main, "Loading ledger");
  const rows = await loadLedger(true);
  if (ctx.isStale()) return;
  if (rows === null) { offline(main, "We could not load the ledger. Check your connection and try again."); return "Public ledger"; }
  const examples = rows.filter((x) => x.status === "sample");
  const simulations = rows.filter((x) => x.status === "simulated");
  const exampleUsd = examples.reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  const demoUsd = simulations.reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Public ledger", "Example entries and saved test records.<br>Payments are not verified here.")}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto">
      <div><b>${rows.length}</b><span>records</span></div><div><b>${usd(exampleUsd)}</b><span>example value</span></div><div><b>${usd(demoUsd)}</b><span>test value · not paid</span></div>
    </div>
    <div class="toolbar">
      <div class="search"><label class="sr" for="lq">Search the ledger</label>${icon("search")}<input class="input" id="lq" type="search" placeholder="Search by name, reference or campaign" autocomplete="off"></div>
      <button class="btn sec" id="csv">${icon("download")}Export CSV</button>
    </div>
    <p class="result-count" id="lcount" role="status" aria-live="polite"></p>
    <div class="tbl-wrap" tabindex="0" role="region" aria-label="Ledger table, scrollable">
      <table class="resp"><caption class="sr">Sample contribution records, newest first</caption>
        <thead><tr><th scope="col">Reference</th><th scope="col">Contributor</th><th scope="col">Campaign</th><th scope="col">Method</th><th scope="col">Record</th><th scope="col">Date</th><th scope="col" class="num">Amount</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
        <tbody id="lbody"></tbody>
      </table>
    </div>
  </div></div>`;
  const body = $("#lbody");
  const draw = () => {
    const q = $("#lq").value.trim().toLowerCase();
    const r = rows.filter((x) => (x.ref + x.donor_name + (x.campaign_title || "")).toLowerCase().includes(q));
    $("#lcount").textContent = `${r.length} ${r.length === 1 ? "record" : "records"}`;
    body.innerHTML = r.length ? r.map((x) => `<tr>
      <td data-label="Reference"><span class="mono">${esc(x.ref)}</span></td>
      <td data-label="Contributor">${esc(x.donor_name)}</td>
      <td data-label="Campaign">${esc(x.campaign_title || "")}</td>
      <td data-label="Method">${esc(CHANNEL_LABEL[x.channel] || x.channel)}</td>
      <td data-label="Record">${x.status === "simulated" ? "Test record · not paid" : "Example entry"}</td>
      <td data-label="Date">${fmtDate(x.created_at)}</td>
      <td data-label="Amount" class="num"><b>${x.currency === "USD" ? usd(x.amount_usd) : ngn(x.amount_ngn)}</b></td>
      <td data-label=""><button class="link-btn" data-ref="${esc(x.ref)}" aria-label="View record ${esc(x.ref)}">View</button></td></tr>`).join("")
      : `<tr><td colspan="8">${empty("search", "Nothing matches", "Try a different name or reference.")}</td></tr>`;
  };
  draw();
  $("#lq").addEventListener("input", draw);
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ref]");
    if (b) showReceipt(rows.find((x) => x.ref === b.dataset.ref));
  });
  $("#csv").addEventListener("click", () => {
    const head = ["reference", "campaign", "contributor", "amount_usd", "amount_ngn", "method", "record_status", "record_hash", "date"];
    const recordStatus = (status) => status === "simulated" ? "Test record - not paid" : "Example entry - not paid";
    const lines = [head, ...rows.map((x) => [x.ref, x.campaign_title || "", x.donor_name, x.amount_usd, x.amount_ngn, x.channel, recordStatus(x.status), x.receipt_hash, fmtDate(x.created_at)])];
    const csv = lines.map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "unifund-ledger.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Ledger exported");
  });
  return "Public ledger";
}

/* ---------- USSD ---------- */
const BANKS = [["737", "GTBank"], ["966", "Zenith Bank"], ["919", "UBA"], ["894", "First Bank"], ["901", "Access Bank"], ["7799", "Fidelity Bank"]];
export async function ussd(main, ctx) {
  loading(main, "Loading");
  const list = await loadCampaigns();
  if (ctx.isStale()) return;
  main.innerHTML = `
  <div class="page"><div class="form-w" style="max-width:600px">
    ${pageHead("USSD preview", "See how a future USSD payment could work.")}
    <div class="notice warn">${icon("lock")}<div><b>Preview only.</b> This code is not valid. Do not dial it or send money. Never share your bank PIN.</div></div>
    ${list && list.length ? `
    <form class="panel" id="ussd-form" novalidate>
      <div data-summary class="err-summary"></div>
      <div class="field"><label for="u-camp">Campaign</label><select class="input" id="u-camp">${list.map((c) => `<option value="${c.id}">${esc(c.campus)} · ${esc(c.title)}</option>`).join("")}</select></div>
      <div class="field"><label for="u-bank">Bank for this preview</label><select class="input" id="u-bank">${BANKS.map(([c, n]) => `<option value="${c}">${n}</option>`).join("")}</select></div>
      <div class="field"><label for="u-amt">Amount in naira</label><input class="input" id="u-amt" type="number" inputmode="numeric" min="500" step="any" value="2000" aria-describedby="u-amt-h"><span class="hint" id="u-amt-h">Minimum ₦500</span></div>
      <button class="btn lg block" id="u-go" type="submit">Show preview code</button>
    </form>
    <div id="u-out" aria-live="polite"></div>
    ` : list === null ? `<div class="notice bad">${icon("triangle-alert")}<div>We could not load campaigns. Check your connection and try again.</div></div>` : empty("search", "No campaigns yet", "Start one to explore the campaign process.", `<a class="btn" href="/start">Start a campaign</a>`)}
  </div></div>`;
  const form = $("#ussd-form");
  if (form) form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate(form, { "u-amt": (v) => (!(+v >= 500) ? "The minimum is ₦500" : "") }, "[data-summary]")) return;
    const btn = $("#u-go");
    busy(btn, true, "Generating…");
    const r = await api("/api/payments/ussd-initiate", { method: "POST", auth: false, body: { campaign_id: +$("#u-camp").value, bank_code: $("#u-bank").value, amount_ngn: +$("#u-amt").value } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not generate a code.");
    const d = r.data;
    $("#u-out").innerHTML = `
        <section class="panel" aria-labelledby="u-res"><h2 id="u-res" style="font-size:1.125rem;margin-bottom:14px">Preview code</h2>
        <div class="dial" id="dial">${esc(d.dial_string)}</div>
        <div class="two" style="margin-top:14px"><button class="btn sec" id="u-copy">${icon("copy")}Copy preview</button></div>
        <p class="hint" style="margin-top:14px">Reference ${esc(d.session_ref)} · ${ngn(d.amount_ngn)}</p>
        <div class="notice warn" style="margin:16px 0 0">${icon("info")}<div>Not a valid payment instruction. Do not dial it; no funds have moved.</div></div>
      </section>`;
    $("#u-copy").addEventListener("click", () => copyText(d.dial_string, "Code copied"));
    $("#dial").scrollIntoView({ block: "center", behavior: "smooth" });
    announce("Your dial code is ready");
  });
  return "USSD preview";
}

/* ---------- legal ---------- */
const legal = (title, intro, sections) => `
  <div class="page"><div class="narrow legal">
    ${pageHead(title, intro)}
    <p class="prototype-disclosure">Prototype notice · not a final legal agreement. These pages must be reviewed and completed before public fundraising.</p>
    ${sections.map(([h, ps]) => `<h2>${h}</h2>${ps.map((p) => (Array.isArray(p) ? `<ul>${p.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<p>${p}</p>`)).join("")}`).join("")}
    <p class="hint" style="margin-top:32px">Last updated 19 November 2026</p>
  </div></div>`;

export function terms(main) {
  main.innerHTML = legal("Terms of use", "The rules for using UniFund", [
    ["Who runs this prototype", ["UniFund is operated by the UniFund Project Team. The project has not provided a registered legal entity or a governing-law choice."]],
    ["What UniFund does today", ["UniFund is a demonstration prototype. Campaigns and some ledger entries are examples. The site does not accept money, verify payment, or transfer funds."]],
    ["Accounts and campaigns", ["You may create a test account and submit a campaign for the demo review flow. The site does not independently confirm that a person or organization belongs to a university."]],
    ["Payment preview and test records", ["The payment screen is a walkthrough only: it does not open a wallet, initiate a payment, or create a receipt. Older test entries shown in the ledger are database records only. They are not proof of payment or evidence that funds are held for a campaign. Never send money based on this prototype."]],
    ["Deleting your account", ["Backer and student organization accounts can be deleted from the account menu after confirming the password. Deletion removes the account, its campaigns and spending reports, and associated simulated contribution records. Audit administrator accounts must be removed by the project operator."]],
    ["Using the prototype", ["Use fictional or non-sensitive information. Do not enter bank details, a real payment reference, wallet keys, or sensitive student identification."]],
    ["Before real launch", ["There is no single governing law for all of Africa or the whole world. The project must select a specific governing jurisdiction, publish a support and privacy contact, and get legal advice before launch. This draft is not a final contract."]],
  ]);
  return "Terms of use";
}
export function privacy(main) {
  main.innerHTML = legal("Privacy", "What we collect, and why", [
    ["Who runs this prototype", ["UniFund is operated by the UniFund Project Team. No registered legal entity or privacy contact address has been provided yet."]],
    ["Information stored", [["Account information: name, email, password hash, and—if you register an organization—organization name, campus code and student ID", "Existing test records may include amount, method, campaign, optional public display name, and a generated reference. The current payment walkthrough does not create records", "A sign-in token is kept in your browser and in the server's session table; sessions expire after seven days. Your theme preference is kept in your browser"]]],
    ["What is public", ["The public ledger shows campaign, amount, method, date, generated reference and record hash. The name you enter is public; leave it blank to appear as Anonymous Backer. Expense reports may also show their purpose, amount, vendor, date and notes. Email, account ID, payment references and password hashes are not shown in the public ledger."]],
    ["How data is stored", ["The deployed site stores account and campaign data in a hosted Neon PostgreSQL database and runs on Vercel. Local development uses a SQLite file. The application does not set advertising cookies or use an analytics tracker. Hosting providers may process connection and request data under their own privacy terms."]],
    ["Deleting your account", ["Backer and student organization accounts can be deleted from the account menu after confirming the password. This removes account details, sessions, campaigns created by that account, their spending reports, and associated simulated contribution records. Audit administrator accounts must be removed by the project operator. Anonymous test receipts are not connected to an account and cannot be removed through account deletion; use no real name when trying the demo."]],
    ["Keep real information out", ["Use made-up details. Do not enter real student ID numbers, bank details, real payment references, wallet keys or other sensitive information. UniFund does not ask for a bank PIN or wallet recovery phrase."]],
    ["Before real launch", ["This notice is not a final privacy policy. The project must publish a privacy contact, choose a specific governing jurisdiction, confirm retention and deletion procedures for any future real payments, and obtain legal review before collecting real personal or payment data."]],
  ]);
  return "Privacy";
}

/* ---------- 404 ---------- */
export function notFound(main) {
  main.innerHTML = `<div class="page"><div class="narrow">${empty("search", "That page does not exist", "The link may be old or mistyped.", `<a class="btn" href="/">Go home</a>`).replace("<h3>", "<h1 style=\"font-size:1.5rem;color:var(--ink)\">").replace("</h3>", "</h1>")}</div></div>`;
  return "Page not found";
}
