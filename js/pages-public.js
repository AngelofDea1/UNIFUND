// Public pages: home, campaigns, how it works, trust, ledger, USSD, legal, 404
import {
  $, $$, state, esc, icon, api, usd, ngn, pct, short, toast, copyText, announce, busy, validate, serverError, scrollBehavior,
  loadCampaigns, loadLedger, CATS, CHANNEL_LABEL,
} from "./core.js?v=26";
import { loading, offline, pageHead, empty, campaignCard, faq, FAQ } from "./components.js?v=26";
import { startHero } from "./hero.js?v=26";
import { showReceipt, fmtDate } from "./pages-campaign.js?v=26";

const formatUsdt = (amount) => `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`;

/* ---------- home ---------- */
export async function home(main, ctx) {
  main.innerHTML = `
  <section class="hero" aria-labelledby="hero-h">
    <canvas id="hero-canvas" aria-hidden="true"></canvas>
    <div class="hero-in">
      <div class="eyebrow hero-pill">Campus project funding · Nigeria</div>
      <h1 id="hero-h">Plan the project.<br>Show the spending.</h1>
      <p class="hero-lead">UniFund lets student teams and informal groups launch campaigns in minutes, raise borderless USDT &amp; local funds, and release batch payouts only after co-signer escrow approval.</p>
      <div class="hero-cta">
        <a class="btn lg" href="/campaigns">Browse campaigns</a>
        <a class="btn sec lg" href="/start">Start a campaign</a>
      </div>
      <div class="hero-trust-badges">
        <span>${icon("shield-check", "sm")} Review before listing</span>
        <span>${icon("file-text", "sm")} Public spending log</span>
        <span>${icon("wallet", "sm")} No real-value payments</span>
      </div>
      <p class="prototype-disclosure">Demo prototype: campaign and organization details are illustrative, not verified. Nile testnet tokens have no real value.</p>
    </div>
  </section>
  <div id="home-rest"><div class="wrap" style="padding:64px 24px"><div class="skeleton" role="status" aria-busy="true" aria-label="Loading"></div></div></div>`;
  startHero();

  const [camps, paymentConfig] = await Promise.all([
    loadCampaigns(true),
    api("/api/payments/config", { auth: false }),
  ]);
  if (ctx.isStale()) return;
  const testnetEnabled = paymentConfig.ok && paymentConfig.data.mode === "tron-testnet";
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
        <p>Explore illustrative project details and budgets.<br>Affiliations are not verified; amounts and backer counts are examples.</p>
      </div>
      ${camps === null ? `<div class="notice bad">${icon("triangle-alert")}<div>We could not load campaigns right now. Please try again shortly.</div></div>`
        : featured.length ? `<div class="grid">${featured.map((c) => campaignCard(c, 3)).join("")}</div>
          <p class="center" style="margin-top:40px"><a class="btn sec" href="/campaigns">View all ${list.length} campaigns${icon("arrow-right", "sm")}</a></p>`
        : empty("search", "No campaigns yet", "Be the first group to start one.", `<a class="btn" href="/start">Start a campaign</a>`, 3)}
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
      <div class="sec-head"><h2 id="pay-h">Payment options</h2><p>${testnetEnabled ? "USDT transfers are available on Nile testnet only. Test tokens have no real value; Cleva and real-value payments are not connected." : "USDT and Cleva are planned routes. An optional Nile testnet demo can be enabled; no real-value payments are accepted."}</p></div>
      ${railsHtml(testnetEnabled)}
    </div>
  </section>

  <section class="section tint" id="home-trust" aria-labelledby="pledge-h">
    <div class="wrap">
      <div class="sec-head"><h2 id="pledge-h">More than a funding request</h2><p>Bring the project plan, review decision, and spending updates together for supporters.</p></div>
      <ul class="pledge" style="padding:0;margin:0">
        <li>${icon("shield-check")}<h3>Launch fast, pay safely</h3><p>Organizations launch campaigns immediately. Funds stay in escrow until a co-signer approves each payout batch.</p></li>
        <li>${icon("list-checks")}<h3>Plan and report</h3><p>Show the intended budget, then post expenses so supporters can follow project updates.</p></li>
        <li>${icon("wallet")}<h3>${testnetEnabled ? "Testnet, not real funds" : "Payment paths designed"}</h3><p>${testnetEnabled ? "TronLink transfers can be verified on Nile. Test tokens have no real value; Cleva is not connected." : "USDT and Cleva are planned routes. Optional Nile testnet transfers use tokens with no real value."}</p></li>
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

const railsHtml = (testnetEnabled = false) => `
  <div class="rails">
    <article class="rail"><div class="badge-ico">${icon("wallet", "")}</div><h3>USDT on TRON</h3><p>${testnetEnabled ? "TronLink demo on the Nile testnet." : "Planned for diaspora backers and cross-border supporters."}</p>
      <dl><div><dt>Integration</dt><dd>${testnetEnabled ? "Nile testnet only" : "Optional testnet demo"}</dd></div><div><dt>Prototype</dt><dd>${testnetEnabled ? "Wallet + solidified receipt" : "Payment walkthrough"}</dd></div><div><dt>Value</dt><dd>Test tokens only</dd></div></dl></article>
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
    ${pageHead("Campaigns", "Explore active student projects across Nigerian universities.")}
    <div class="toolbar toolbar-campaigns" role="search">
      <div class="search">
        <label class="sr" for="q">Search campaigns</label>
        ${icon("search")}
        <input class="input" id="q" type="search" placeholder="Search by project, club or university" autocomplete="off">
      </div>
      <div>
        <label class="sr" for="filter-cat">Category</label>
        <select class="input" id="filter-cat" style="font-weight:600">
          <option value="all">All categories</option>
          ${Object.entries(CATS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
        </select>
      </div>
      <div>
        <label class="sr" for="sort">Sort by</label>
        <select class="input" id="sort" style="font-weight:600">
          <option value="close">Closest to goal</option>
          <option value="new">Newest</option>
          <option value="length">Shortest campaign</option>
          <option value="raised">Most funded</option>
        </select>
      </div>
    </div>
    <p class="result-count" id="count" role="status" aria-live="polite" style="margin-bottom:28px"></p>
    <div class="grid" id="grid"></div>
  </div></div>`;
  const grid = $("#grid"), count = $("#count");
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase();
    const s = $("#sort").value;
    const cat = $("#filter-cat").value;
    let r = list.filter((c) => (cat === "all" || c.category === cat) && (c.title + " " + c.org + " " + c.campus + " " + c.about).toLowerCase().includes(q));
    r.sort((a, b) => s === "new" ? b.id - a.id : s === "length" ? a.days - b.days : s === "raised" ? b.raised_usd - a.raised_usd : pct(b) - pct(a));
    count.textContent = `${r.length} ${r.length === 1 ? "campaign" : "campaigns"}`;
    grid.innerHTML = r.length ? r.map((c) => campaignCard(c, 2)).join("") : empty("search", "No campaigns match", "Try a different search word, or choose another category.", `<button class="btn sec" id="clear">Reset filters</button>`, 2);
    $("#clear")?.addEventListener("click", () => { $("#q").value = ""; $("#filter-cat").value = "all"; draw(); });
  };
  $("#q").addEventListener("input", draw);
  $("#filter-cat").addEventListener("change", draw);
  $("#sort").addEventListener("change", draw);
  draw();
  return "Campaigns";
}

/* ---------- how it works ---------- */
export async function how(main) {
  const paymentConfig = await api("/api/payments/config", { auth: false });
  const testnetEnabled = paymentConfig.ok && paymentConfig.data.mode === "tron-testnet";
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("How it works", "Submit a campaign. Get it reviewed. Record spending.")}
    ${stepsHtml(2)}
    <div class="sec-head" style="margin-top:80px"><h2>Ways to pay</h2></div>
    ${railsHtml(testnetEnabled)}
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
    ${block("shield-check", "Escrow-gated payouts", `<p>Student groups publish campaigns immediately. Funds stay in escrow until a co-signer approves each payout batch.</p>`)}
    ${block("hash", "Public records", `<p>The ledger is a UniFund database. If Nile mode is enabled, testnet rows link to transfers with solidified receipts; those test tokens have no real value. Sample entries are not proof of payment.</p><p><a href="/ledger">View the ledger</a> or download it as a CSV.</p>`)}
    ${block("lock", "Payment safety", `<p>Only Nile testnet tokens may be used in the demo; they have no real value. No real-value payment provider is connected. Never send real assets or share your PIN, password or wallet recovery phrase.</p>`)}
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
  const testnet = rows.filter((x) => x.status === "testnet_confirmed");
  const exampleUsd = examples.reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  const demoUsd = simulations.reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  const testnetUsd = testnet.reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Public ledger", "Example and simulated records, plus Nile testnet transfers if enabled.<br>Testnet tokens have no real value; real-value payments are not accepted.")}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto">
      <div><b>${rows.length}</b><span>records</span></div><div><b>${usd(exampleUsd)}</b><span>example value</span></div><div><b>${usd(demoUsd)}</b><span>simulated · not paid</span></div><div><b>${formatUsdt(testnetUsd)}</b><span>Nile test tokens · no value</span></div>
    </div>
    <div class="toolbar">
      <div class="search"><label class="sr" for="lq">Search the ledger</label>${icon("search")}<input class="input" id="lq" type="search" placeholder="Search by name, reference or campaign" autocomplete="off"></div>
      <div class="toolbar-actions">
        <button class="btn sec" id="verify-chain">${icon("shield-check")}Verify hash chain</button>
        <button class="btn sec" id="csv">${icon("download")}Export CSV</button>
      </div>
    </div>
    <div id="verify-box" style="margin-bottom:16px" aria-live="polite"></div>
    <p class="result-count" id="lcount" role="status" aria-live="polite"></p>
    <div class="tbl-wrap" tabindex="0" role="region" aria-label="Ledger table, scrollable">
      <table class="resp"><caption class="sr">Example, simulated and Nile testnet records, newest first</caption>
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
      <td data-label="Record">${x.status === "testnet_confirmed" ? "Nile testnet · verified · no real value" : x.status === "simulated" ? "Test record · not paid" : "Example entry · not paid"}</td>
      <td data-label="Date">${fmtDate(x.created_at)}</td>
      <td data-label="Amount" class="num"><b>${x.status === "testnet_confirmed" ? formatUsdt(x.amount_usd) : x.currency === "USD" ? usd(x.amount_usd) : ngn(x.amount_ngn)}</b></td>
      <td data-label=""><button class="link-btn" data-ref="${esc(x.ref)}" aria-label="View record ${esc(x.ref)}">View</button></td></tr>`).join("")
      : `<tr><td colspan="8">${empty("search", "Nothing matches", "Try a different name or reference.", "", 2)}</td></tr>`;
  };
  draw();
  $("#lq").addEventListener("input", draw);
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ref]");
    if (b) showReceipt(rows.find((x) => x.ref === b.dataset.ref));
  });
  $("#csv").addEventListener("click", () => {
    const head = ["reference", "campaign", "contributor", "amount_usd", "amount_ngn", "method", "record_status", "transaction_id", "block_height", "record_hash", "date"];
    const recordStatus = (status) => status === "testnet_confirmed" ? "Verified on TRON Nile testnet; no real value" : status === "simulated" ? "Test record - not paid" : "Example entry - not paid";
    const lines = [head, ...rows.map((x) => [x.ref, x.campaign_title || "", x.donor_name, x.amount_usd, x.amount_ngn, x.channel, recordStatus(x.status), x.tx_hash || "", x.block_height || "", x.receipt_hash, fmtDate(x.created_at)])];
    const csv = lines.map((r) => r.map(csvCell).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "unifund-ledger.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Ledger exported");
  });

  const vBtn = $("#verify-chain");
  if (vBtn) {
    vBtn.addEventListener("click", async () => {
      busy(vBtn, true, "Auditing hashes…");
      const r = await api("/api/ledger/verify", { auth: false });
      busy(vBtn, false);
      const vb = $("#verify-box");
      if (!r.ok) {
        vb.innerHTML = `<div class="notice bad">${icon("triangle-alert")}<div><b>Audit check failed.</b> ${esc(r.data.error || "Unable to verify ledger hash-chain.")}</div></div>`;
        return;
      }
      const d = r.data;
      if (d.valid) {
        vb.innerHTML = `<div class="notice" style="background:rgba(16,185,129,.08);border-color:var(--ok)">${icon("circle-check")}<div><b>Ledger integrity verified:</b> All ${d.records_checked} sequential database audit hashes form an unbroken chain. <span class="muted" style="font-size:.85rem;display:block;margin-top:4px">${esc(d.notice)}</span></div></div>`;
      } else {
        vb.innerHTML = `<div class="notice bad">${icon("triangle-alert")}<div><b>Hash chain anomaly detected:</b> Broken link at references: ${esc(d.broken_references.join(", "))}.</div></div>`;
      }
    });
  }
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
    ` : list === null ? `<div class="notice bad">${icon("triangle-alert")}<div>We could not load campaigns. Check your connection and try again.</div></div>` : empty("search", "No campaigns yet", "Start one to explore the campaign process.", `<a class="btn" href="/start">Start a campaign</a>`, 2)}
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
        <div style="margin-top:14px"><button class="btn sec block" id="u-copy">${icon("copy")}Copy preview</button></div>
        <p class="hint" style="margin-top:14px">Reference ${esc(d.session_ref)} · ${ngn(d.amount_ngn)}</p>
        <div class="notice warn" style="margin:16px 0 0">${icon("info")}<div>Not a valid payment instruction. Do not dial it; no funds have moved.</div></div>
      </section>`;
    $("#u-copy").addEventListener("click", () => copyText(d.dial_string, "Code copied"));
    $("#dial").scrollIntoView({ block: "center", behavior: scrollBehavior() });
    announce("Your dial code is ready");
  });
  return "USSD preview";
}

/* ---------- legal ---------- */
const legal = (title, intro, sections) => `
  <div class="page"><div class="narrow legal">
    ${pageHead(title, intro)}
    <p class="prototype-disclosure">Prototype notice · not a final legal agreement. Nile testnet tokens have no real value; do not send real assets.</p>
    ${sections.map(([h, ps]) => `<h2>${h}</h2>${ps.map((p) => (Array.isArray(p) ? `<ul>${p.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<p>${p}</p>`)).join("")}`).join("")}
    <p class="hint" style="margin-top:32px">Last updated 22 November 2026</p>
  </div></div>`;

export function terms(main) {
  main.innerHTML = legal("Terms of use", "The rules for using UniFund", [
    ["Who runs this prototype", ["UniFund is operated by the UniFund Project Team. The project has not provided a registered legal entity or a governing-law choice."]],
    ["What UniFund does today", ["UniFund is a demonstration prototype. Campaigns and some ledger entries are examples. The optional Nile mode can transfer and verify test tokens only; no real-value funds are accepted or transferred."]],
    ["Accounts and campaigns", ["You may create a test account and submit a campaign for the demo review flow. The site does not independently confirm that a person or organization belongs to a university."]],
    ["Payment preview and test records", ["Unless Nile testnet mode is explicitly enabled, the payment screen is a walkthrough only. In testnet mode, TronLink can send test USDT on Nile and UniFund records it only after checking a solidified receipt. Test tokens have no real value. Sample and simulated entries are not proof that real funds were paid or held for a campaign. Never send real assets based on this prototype."]],
    ["Deleting your account", ["Backer and student organization accounts can be deleted from the account menu after confirming the password. Deletion removes the account, its campaigns and spending reports, and associated simulated and testnet contribution records. It cannot remove a transaction from the public Nile testnet. Audit administrator accounts must be removed by the project operator."]],
    ["Using the prototype", ["Use fictional or non-sensitive information. Do not enter bank details, a real payment reference, wallet keys, or sensitive student identification."]],
    ["Before real launch", ["There is no single governing law for all of Africa or the whole world. The project must select a specific governing jurisdiction, publish a support and privacy contact, and get legal advice before launch. This draft is not a final contract."]],
  ]);
  return "Terms of use";
}
export function privacy(main) {
  main.innerHTML = legal("Privacy", "What we collect, and why", [
    ["Who runs this prototype", ["UniFund is operated by the UniFund Project Team. No registered legal entity or privacy contact address has been provided yet."]],
    ["Information stored", [["Account information: name, email, password hash, and—if you register an organization—organization name and campus code. Signup does not request student IDs; older demo records may retain a value entered under an earlier version", "Example, simulated, and optional Nile testnet records may include amount, method, campaign, public display name, transaction ID, and a generated reference. No real payment details are collected", "A sign-in token is kept in your browser and in the server's session table; sessions expire after seven days. Your theme preference is kept in your browser"]]],
    ["What is public", ["The public ledger shows campaign, amount, method, date, generated reference and record hash. For a testnet transfer, the transaction ID links to public Nile data, which may reveal the sending wallet address and cannot be deleted from the chain. The name you enter is public; leave it blank to appear as Anonymous Backer. Expense reports may also show their purpose, amount, vendor, date and notes. Email, account ID, provider credentials and password hashes are not shown in the public ledger."]],
    ["How data is stored", ["The deployed site stores account and campaign data in a hosted Neon PostgreSQL database and runs on Vercel. Local development uses a SQLite file. The application does not set advertising cookies or use an analytics tracker. Hosting providers may process connection and request data under their own privacy terms."]],
    ["Deleting your account", ["Backer and student organization accounts can be deleted from the account menu after confirming the password. This removes account details, sessions, campaigns created by that account, their spending reports, and associated simulated and testnet contribution records. It cannot remove a transaction from the public Nile testnet. Audit administrator accounts must be removed by the project operator. Anonymous simulated receipts are not connected to an account and cannot be removed through account deletion; use no real name when trying the demo."]],
    ["Keep real information out", ["Use made-up details. Do not enter real student ID numbers, bank details, real payment references, wallet keys or other sensitive information. UniFund does not ask for a bank PIN or wallet recovery phrase."]],
    ["Before real launch", ["This notice is not a final privacy policy. The project must publish a privacy contact, choose a specific governing jurisdiction, confirm retention and deletion procedures for any future real payments, and obtain legal review before collecting real personal or payment data."]],
  ]);
  return "Privacy";
}

/* ---------- 404 ---------- */
export function notFound(main) {
  main.innerHTML = `<div class="page"><div class="narrow">${empty("search", "That page does not exist", "The link may be old or mistyped.", `<a class="btn" href="/">Go home</a>`, 1)}</div></div>`;
  return "Page not found";
}
