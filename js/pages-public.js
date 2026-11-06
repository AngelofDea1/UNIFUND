// Public pages: home, campaigns, how it works, trust, ledger, USSD, legal, 404
import {
  $, $$, state, esc, icon, api, usd, ngn, pct, short, toast, copyText, announce, busy, validate, serverError,
  loadCampaigns, loadLedger, CATS, CHANNEL_LABEL, DEMO,
} from "./core.js";
import { loading, offline, pageHead, empty, campaignCard, faq, FAQ } from "./components.js?v=7";
import { startHero } from "./hero.js";
import { showReceipt, fmtDate } from "./pages-campaign.js";

/* ---------- home ---------- */
export async function home(main, ctx) {
  main.innerHTML = `
  <section class="hero" aria-labelledby="hero-h">
    <canvas id="hero-canvas" aria-hidden="true"></canvas>
    <div class="hero-in">
      <div class="eyebrow hero-pill"><span class="pulse-dot"></span> Verified Campus Crowdfunding · Nigeria</div>
      <h1 id="hero-h">Fund student work,<br>with a public record</h1>
      <p class="hero-lead">Back verified university groups across Nigeria.<br>Pay in naira or USDT, with every contribution sealed on a public ledger anyone can check.</p>
      <div class="hero-cta">
        <a class="btn lg" href="#/campaigns">Browse campaigns</a>
        <a class="btn sec lg" href="#/start">Start a campaign</a>
      </div>
      <div class="hero-trust-badges">
        <span>${icon("shield-check", "sm")} Verified Matric & Groups</span>
        <span>${icon("lock", "sm")} Tether (USDT) on TRON</span>
        <span>${icon("landmark", "sm")} Powered by Cleva USD</span>
        <span>${icon("hash", "sm")} SHA-256 Ledger</span>
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
  <section class="stats" aria-label="Platform totals">
    <div class="stat"><b>${usd(raised)}</b><span>sample USD total</span></div>
    <div class="stat"><b>${ngn(raised * state.rate)}</b><span>sample naira total</span></div>
    <div class="stat"><b>${backers.toLocaleString()}</b><span>sample backers</span></div>
    <div class="stat"><b>${list.length}</b><span>sample campaigns</span></div>
  </section>

  <section class="section" id="home-campaigns" aria-labelledby="feat-h">
    <div class="wrap">
      <div class="sec-head">
        <span class="sec-badge">${icon("shield-check", "sm")} Campus project campaigns</span>
        <h2 id="feat-h">Featured campus campaigns</h2>
        <p>Explore sample initiatives and follow the committee-review workflow.<br>Campaign and payment figures are prototype data, not live fundraising.</p>
      </div>
      ${camps === null ? `<div class="notice bad">${icon("triangle-alert")}<div>We could not load campaigns right now. Please try again shortly.</div></div>`
        : featured.length ? `<div class="grid">${featured.map(campaignCard).join("")}</div>
          <p class="center" style="margin-top:40px"><a class="btn sec" href="#/campaigns">View all ${list.length} campaigns${icon("arrow-right", "sm")}</a></p>`
        : empty("search", "No live campaigns yet", "Be the first group to start one.", `<a class="btn" href="#/start">Start a campaign</a>`)}
    </div>
  </section>

  <section class="section tint" id="home-how" aria-labelledby="how-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="how-h">How UniFund works</h2><p>Three straightforward steps from student innovation<br>to committee review and a transparent project record.</p></div>
      ${stepsHtml()}
    </div>
  </section>

  <section class="section" id="home-pay" aria-labelledby="pay-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="pay-h">Payment pathways we are building</h2><p>Our prototype demonstrates the donor journey; it does not initiate or verify real payments.</p></div>
      ${railsHtml()}
    </div>
  </section>

  <section class="section tint" id="home-trust" aria-labelledby="pledge-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="pledge-h">Designed for accountable funding</h2><p>See how campus review and a public activity record could work<br>before connecting real payment providers.</p></div>
      <ul class="pledge" style="padding:0;margin:0">
        <li>${icon("shield-check")}<h3>Committee review</h3><p>Organizations submit campus details and campaign budgets<br>for review before a campaign is published.</p></li>
        <li>${icon("lock")}<h3>Zero credential risk</h3><p>We never touch your banking password or PIN.<br>USSD payments are authorized directly on your phone.</p></li>
        <li>${icon("hash")}<h3>Transparent audit trail</h3><p>Prototype records receive a database-backed SHA-256 seal.<br>They are not blockchain transactions or immutable storage.</p></li>
      </ul>
    </div>
  </section>

  <section class="section" aria-labelledby="faq-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="faq-h">Frequently asked questions</h2><p>Quick answers to common questions about backing student groups<br>and running verified campus campaigns.</p></div>
      ${faq()}
    </div>
  </section>

  <section class="cta-band" aria-labelledby="cta-h">
    <h2 id="cta-h">Leading a student project or society?</h2>
    <p>Try the campaign review, simulated donor journey and public audit trail.<br>Live payment integrations are not enabled in this prototype.</p>
    <a class="btn lg" href="#/start">Start a campaign</a>
  </section>`;
  return "Student project funding prototype";
}

const stepsHtml = (h = 3) => `
  <ol class="steps" style="padding:0">
    <li class="step"><div class="step-n" aria-hidden="true">1</div><h${h}>Groups apply</h${h}><p>Student organizations sign up with their campus credentials and matric number,<br>submitting a transparent campaign goal and budget breakdown.</p></li>
    <li class="step"><div class="step-n" aria-hidden="true">2</div><h${h}>Backers contribute</h${h}><p>The planned rails are Cleva, USDT on TRON and USSD.<br>The current prototype only creates clearly labeled simulated receipts.</p></li>
    <li class="step"><div class="step-n" aria-hidden="true">3</div><h${h}>Public auditing</h${h}><p>Campaigns display a database-backed activity record and logged expenses.<br>Production settlement and tamper-resistant storage remain future integrations.</p></li>
  </ol>`;

const railsHtml = () => `
  <div class="rails">
    <article class="rail"><div class="badge-ico">${icon("wallet", "")}</div><h3>Tether USDT (TRC-20)</h3><p>Planned for diaspora backers<br>and cross-border supporters.</p>
      <dl><div><dt>Integration</dt><dd>Not connected</dd></div><div><dt>Prototype</dt><dd>Simulated receipt</dd></div><div><dt>Settlement</dt><dd>Not available</dd></div></dl></article>
    <article class="rail"><div class="badge-ico">${icon("landmark", "")}</div><h3>Cleva USD & Naira</h3><p>Planned for local transfers<br>and campus organizations.</p>
      <dl><div><dt>Integration</dt><dd>Awaiting API access</dd></div><div><dt>Prototype</dt><dd>Simulated receipt</dd></div><div><dt>Settlement</dt><dd>Not available</dd></div></dl></article>
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
    ${pageHead("Sample campaigns", "Explore campus projects and the campaign-review workflow.<br>All campaign figures on this page are sample data.")}
    <div class="toolbar" role="search">
      <div class="search"><label class="sr" for="q">Search campaigns</label>${icon("search")}<input class="input" id="q" type="search" placeholder="Search by project, group or campus" autocomplete="off"></div>
      <div><label class="sr" for="sort">Sort by</label><select class="input" id="sort"><option value="close">Closest to goal</option><option value="new">Newest</option><option value="end">Ending soon</option><option value="raised">Most raised</option></select></div>
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
    r.sort((a, b) => s === "new" ? b.id - a.id : s === "end" ? a.days - b.days : s === "raised" ? b.raised_usd - a.raised_usd : pct(b) - pct(a));
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
    ${pageHead("How the prototype works", "From a student idea to a reviewed campaign and a public activity record")}
    ${stepsHtml(2)}
    <div class="sec-head" style="margin-top:80px"><h2>Ways to pay</h2></div>
    ${railsHtml()}
    <div class="sec-head" style="margin-top:80px"><h2>Questions</h2></div>
    ${faq()}
    <p class="center" style="margin-top:48px"><a class="btn lg" href="#/campaigns">Browse campaigns</a></p>
  </div></div>`;
  return "How it works";
}

/* ---------- trust ---------- */
export function trust(main) {
  const block = (ic, h, body) => `<section class="panel"><div class="panel-head"><h2 style="display:flex;gap:12px;align-items:center">${icon(ic)}${h}</h2></div><div class="stack muted">${body}</div></section>`;
  main.innerHTML = `
  <div class="page"><div class="narrow">
    ${pageHead("Trust and security", "What we check, what we publish, and what we will never ask you for")}
    ${block("shield-check", "Committee review", `<p>Student organizations submit campus details and a campaign for review. The prototype supports an approval workflow; it does not independently verify university email addresses, matric numbers or committee identities.</p>`)}
    ${block("hash", "The public ledger", `<p>Prototype records are stored in SQLite and receive a SHA-256 reference seal. This is not a blockchain, does not independently prove a payment, and is not tamper-proof against database access.</p><p><a href="#/ledger">Read the ledger</a> or export the sample records as a CSV.</p>`)}
    ${block("lock", "Your bank details", `<p>UniFund never asks for your bank PIN, card number or password. Payment integrations are not connected in this prototype; never send funds or submit a real payment reference here.</p>`)}
    ${block("file-text", "Following the money", `<p>Organizers log each expense with the vendor and an invoice reference on their campaign page. Backers and the audit committee can see the log at any time.</p>`)}
    ${DEMO ? `<div class="notice warn">${icon("info")}<div><b>Demonstration environment.</b> Sample data is displayed. Contributions and transaction records are authenticated in test mode.</div></div>` : ""}
  </div></div>`;
  return "Trust and security";
}

/* ---------- public ledger ---------- */
export async function ledger(main, ctx) {
  loading(main, "Loading ledger");
  const rows = await loadLedger(true);
  if (ctx.isStale()) return;
  if (rows === null) { offline(main, "We could not load the ledger. Check your connection and try again."); return "Public ledger"; }
  const settled = rows.filter((x) => x.status === "verified");
  const totalUsd = settled.reduce((s, x) => s + (x.amount_usd || 0), 0);
  const totalNgn = settled.reduce((s, x) => s + (x.amount_ngn || 0), 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Public activity ledger", "Inspect sample records and sandbox simulations.<br>These database entries are not blockchain proofs or verified payments.")}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto">
      <div><b>${rows.length}</b><span>sample records</span></div><div><b>${usd(totalUsd)}</b><span>seeded sample USD</span></div><div><b>${ngn(totalNgn)}</b><span>seeded sample NGN</span></div>
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
      <td data-label="Record">${x.status === "simulated" ? "Simulation · not paid" : "Sample data"}</td>
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
    const head = ["reference", "campaign", "contributor", "amount_usd", "amount_ngn", "method", "status", "tx_hash", "seal", "date"];
    const lines = [head, ...rows.map((x) => [x.ref, x.campaign_title || "", x.donor_name, x.amount_usd, x.amount_ngn, x.channel, x.status, x.tx_hash || "", x.receipt_hash, fmtDate(x.created_at)])];
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
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
    ${pageHead("Explore the USSD concept", "Preview the proposed campus payment flow.<br>This prototype does not connect to a bank or telecom provider.")}
    <div class="notice warn">${icon("lock")}<div><b>Demo preview only.</b> Do not dial the generated code or send money. No bank/telecom integration is configured, and UniFund never needs your bank PIN.</div></div>
    ${list && list.length ? `
    <form class="panel" id="ussd-form" novalidate>
      <div data-summary class="err-summary"></div>
      <div class="field"><label for="u-camp">Campaign</label><select class="input" id="u-camp">${list.map((c) => `<option value="${c.id}">${esc(c.campus)} · ${esc(c.title)}</option>`).join("")}</select></div>
      <div class="field"><label for="u-bank">Your bank</label><select class="input" id="u-bank">${BANKS.map(([c, n]) => `<option value="${c}">${n} (*${c}#)</option>`).join("")}</select></div>
      <div class="field"><label for="u-amt">Amount in naira</label><input class="input" id="u-amt" type="number" inputmode="numeric" min="500" step="any" value="2000" aria-describedby="u-amt-h"><span class="hint" id="u-amt-h">Minimum ₦500</span></div>
      <button class="btn lg block" id="u-go" type="submit">Generate my code</button>
    </form>
    <div id="u-out" aria-live="polite"></div>
    <section class="panel" aria-labelledby="u-how"><h2 id="u-how" style="font-size:1.125rem;margin-bottom:12px">How it works</h2>
      <ol class="muted" style="padding-left:20px;margin:0;display:grid;gap:8px"><li>Choose a campaign, bank and amount in the concept demo</li><li>In a future live integration, complete bank authorization through an approved provider</li><li>Provider confirmation would be required before crediting a campaign</li></ol>
    </section>` : empty("search", "No campaigns to fund yet", "Check back soon, or start one yourself.", `<a class="btn" href="#/start">Start a campaign</a>`)}
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
      <section class="panel" aria-labelledby="u-res"><h2 id="u-res" style="font-size:1.125rem;margin-bottom:14px">Your dial code</h2>
        <div class="dial" id="dial">${esc(d.dial_string)}</div>
        <div class="two" style="margin-top:14px"><button class="btn sec" id="u-copy">${icon("copy")}Copy preview</button></div>
        <p class="hint" style="margin-top:14px">Reference ${esc(d.session_ref)} · ${ngn(d.amount_ngn)}</p>
        <div class="notice warn" style="margin:16px 0 0">${icon("info")}<div>Sample dial-code format only. It is not a valid payment instruction. Do not dial it; no funds have moved.</div></div>
      </section>`;
    $("#u-copy").addEventListener("click", () => copyText(d.dial_string, "Code copied"));
    $("#dial").scrollIntoView({ block: "center", behavior: "smooth" });
    announce("Your dial code is ready");
  });
  return "Pay by USSD";
}

/* ---------- legal ---------- */
const legal = (title, intro, sections) => `
  <div class="page"><div class="narrow legal">
    ${pageHead(title, intro)}
    <div class="notice warn">${icon("info")}<div>This is a draft for the test environment. Have a lawyer review it before launch.</div></div>
    ${sections.map(([h, ps]) => `<h2>${h}</h2>${ps.map((p) => (Array.isArray(p) ? `<ul>${p.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<p>${p}</p>`)).join("")}`).join("")}
    <p class="hint" style="margin-top:32px">Last updated 5 November 2026</p>
  </div></div>`;

export function terms(main) {
  main.innerHTML = legal("Terms of use", "The rules for using UniFund", [
    ["Who can use UniFund", ["Anyone can browse campaigns and contribute. Only registered student organizations can start a campaign."]],
    ["Campaigns", ["Organizers must describe their project honestly, set a realistic goal, and log how funds are spent. The audit committee may decline or remove a campaign that breaks these rules."]],
    ["Contributions", ["This prototype creates simulated receipts only; it does not accept or verify payments. Do not send funds or submit real payment references."]],
    ["Your account", ["Keep your password private. You are responsible for activity on your account."]],
    ["Changes", ["We may update these terms. Continued use means you accept the new version."]],
  ]);
  return "Terms of use";
}
export function privacy(main) {
  main.innerHTML = legal("Privacy", "What we collect, and why", [
    ["What we collect", [["Account details: name, email, and for organizations, group name, campus and matric number", "Contribution records: the name you choose, amount, method and reference", "A sign-in token stored in your browser"]]],
    ["What is public", ["A name and sample amount entered in a sandbox are shown in the public prototype ledger. Do not submit sensitive or real payment information."]],
    ["What we never collect", ["We never ask for your bank PIN, card number or wallet seed phrase."]],
    ["Storage and cookies", ["We store a sign-in token and your theme choice in your browser. We do not use advertising trackers."]],
    ["Your choices", ["You can sign out at any time, which removes the token from your browser. This prototype runs on a local SQLite database; its demo data can be reset by deleting the database file."]],
  ]);
  return "Privacy";
}

/* ---------- 404 ---------- */
export function notFound(main) {
  main.innerHTML = `<div class="page"><div class="narrow">${empty("search", "That page does not exist", "The link may be old or mistyped.", `<a class="btn" href="#/">Go home</a>`).replace("<h3>", "<h1 style=\"font-size:1.5rem;color:var(--ink)\">").replace("</h3>", "</h1>")}</div></div>`;
  return "Page not found";
}
