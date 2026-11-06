// Campaign detail page plus the contribute, share, receipt and spending dialogs
import {
  $, $$, state, esc, icon, api, usd, ngn, pct, short, toast, copyText, openModal, setModalBody, closeModal,
  setFieldError, validate, serverError, busy, qrSvg, progressBar, statusTag, CATS, CHANNEL_LABEL, DEMO, announce,
} from "./core.js";
import { loading, offline, empty } from "./components.js";

export const fmtDate = (sec) =>
  sec ? new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const amountOf = (r) => (r.currency === "USD" ? usd(r.amount_usd) : ngn(r.amount_ngn));

/* ---------- detail page ---------- */
export async function detail(main, ctx) {
  const id = ctx.parts[0];
  loading(main, "Loading campaign");
  const r = await api(`/api/campaigns/${encodeURIComponent(id)}`);
  if (ctx.isStale()) return;
  if (r.status === 0) { offline(main, r.data.error); return "Campaign"; }
  const c = r.ok ? r.data.campaign : null;
  const u = state.user;
  const owner = !!(u && c && (u.id === c.user_id || u.role === "admin"));
  if (!c || (c.status !== "approved" && !owner)) {
    main.innerHTML = `<div class="page"><div class="narrow">${empty("search", "Campaign not found", "It may have been removed, or it is still waiting for review.", `<a class="btn" href="#/campaigns">Browse campaigns</a>`)}</div></div>`;
    return "Campaign not found";
  }

  const spend = c.spending_reports || [];
  const conts = c.contributions || [];
  const totalSpent = spend.reduce((s, x) => s + (x.currency === "USD" ? x.amount : x.amount / state.rate), 0);

  main.innerHTML = `
  <div class="page"><div class="narrow">
    <a class="back" href="#/campaigns">${icon("arrow-left", "sm")}All campaigns</a>
    ${c.status !== "approved" ? `<div class="notice warn" role="status">${icon("info")}<div><b>${c.status === "pending" ? "Awaiting review" : "Declined"}.</b> Only you and the audit committee can see this page${c.approval_notes ? `. Note: ${esc(c.approval_notes)}` : ""}</div></div>` : ""}
    <header class="detail-head">
      <div class="meta"><span class="tag ok">${icon("shield-check")}Approved in demo workflow</span><span class="tag">${esc(CATS[c.category] || "Initiative")}</span></div>
      <h1>${esc(c.title)}</h1>
      <p class="muted" style="margin-top:12px">by ${esc(c.org)}</p>
    </header>

    <section class="panel funds" aria-labelledby="funds-h">
      <div class="notice warn">${icon("info")}<div>Sample campaign data. Demo payment receipts are simulations and do not increase these totals.</div></div>
      <h2 id="funds-h" class="sr">Funding status</h2>
      <div class="big">${usd(c.raised_usd)}</div>
      <p class="of">${ngn(c.raised_ngn)} raised of ${usd(c.goal_usd)} goal (${ngn(c.goal_ngn)})</p>
      ${progressBar(c, "Funding progress")}
      <div class="facts"><span><strong>${c.backers_count}</strong> backers</span><span><strong>${pct(c)}%</strong> funded</span><span><strong>${c.days}</strong> days left</span></div>
      <div class="actions">
        <button class="btn lg" id="contribute">Try demo contribution</button>
        <button class="btn sec lg" id="share">${icon("link")}Share</button>
      </div>
    </section>

    <section class="panel" aria-labelledby="about-h">
      <div class="panel-head"><h2 id="about-h">About this campaign</h2></div>
      <p class="muted" style="white-space:pre-line">${esc(c.about)}</p>
    </section>

    ${c.budget_breakdown ? `<section class="panel" aria-labelledby="bud-h"><div class="panel-head"><h2 id="bud-h">Budget breakdown</h2></div>${budget(c.budget_breakdown)}</section>` : ""}

    <section class="panel" aria-labelledby="sp-h">
      <div class="panel-head"><h2 id="sp-h">Spending log</h2>${owner && c.status === "approved" ? `<button class="btn sm sec" id="add-exp">${icon("plus", "sm")}Add expense</button>` : ""}</div>
      ${spend.length
        ? `<div class="rows">${spend.map((s) => `<div><span>${esc(s.title)}<span class="sub">${esc(s.vendor)} · ${esc(s.date_spent)}${s.notes ? " · " + esc(s.notes) : ""}</span></span><span class="amt">${s.currency === "USD" ? usd(s.amount) : ngn(s.amount)}</span></div>`).join("")}</div>
           <p class="hint" style="margin-top:16px">Total logged: about ${usd(totalSpent)}</p>`
        : `<p class="muted">No spending has been logged yet. Organizers post each expense here so backers can follow the money.</p>`}
    </section>

    <section class="panel" aria-labelledby="con-h">
      <div class="panel-head"><h2 id="con-h">Recent contributions</h2><a class="link-btn" href="#/ledger">Full ledger</a></div>
      ${conts.length
        ? `<div class="rows">${conts.map((x) => `<div><span>${esc(x.donor_name)}<span class="sub">${x.status === "simulated" ? "Simulation · not paid · " : "Sample data · "}${esc(CHANNEL_LABEL[x.channel] || x.channel)} · <span class="mono">${esc(x.ref)}</span> · ${fmtDate(x.created_at)}</span></span><span class="amt">${amountOf(x)}</span></div>`).join("")}</div>`
        : `<p class="muted">No contributions yet. Be the first to back this campaign.</p>`}
    </section>

    <section class="panel" aria-labelledby="w-h">
      <div class="panel-head"><h2 id="w-h">Payment setup</h2></div>
      <p class="muted">Live Cleva settlement and on-chain USDT verification are not connected in this hackathon prototype. Do not send funds; no wallet or bank account is configured.</p>
    </section>
  </div></div>`;

  $("#contribute", main).addEventListener("click", () => openContribute(c));
  $("#share", main).addEventListener("click", () => openShare(c));
  $("#add-exp", main)?.addEventListener("click", () => openSpending(c));
  $("#copy-wallet", main)?.addEventListener("click", () => copyText(c.wallet_address || "", "Wallet address copied"));
  return c.title;
}

export function budget(text) {
  const rows = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.match(/^(.*?):\s*\$?\s*([\d,]+(?:\.\d+)?)$/));
  if (rows.length && rows.every(Boolean)) {
    const total = rows.reduce((s, m) => s + Number(m[2].replace(/,/g, "")), 0);
    return `<div class="tbl-wrap"><table class="budget"><thead><tr><th scope="col">Item</th><th scope="col">Cost</th></tr></thead><tbody>${rows.map((m) => `<tr><td>${esc(m[1])}</td><td>${usd(Number(m[2].replace(/,/g, "")))}</td></tr>`).join("")}<tr><th scope="row">Total</th><th>${usd(total)}</th></tr></tbody></table></div>`;
  }
  return `<p class="muted" style="white-space:pre-line">${esc(text)}</p>`;
}

/* ---------- contribute ---------- */
const HEX64 = /^(0x)?[a-fA-F0-9]{64}$/;

function openContribute(c) {
  const u = state.user;
  const S = { rail: "usdt", usd: 25, ngn: 25000 };
  const html = `
    <p class="lede">${esc(c.title)}</p>
    <form id="pay-form" novalidate>
      <div data-summary class="err-summary" tabindex="-1"></div>
      <div class="tabs" role="tablist" aria-label="Payment method">
        <button type="button" role="tab" id="tab-usdt" aria-selected="true" aria-controls="panel-usdt">Tether USDT (TRC-20)</button>
        <button type="button" role="tab" id="tab-ngn" aria-selected="false" aria-controls="panel-ngn" tabindex="-1">Cleva USD / Naira</button>
      </div>

      <div role="tabpanel" id="panel-usdt" aria-labelledby="tab-usdt">
        <fieldset><legend class="legend">Amount in USD</legend>
          <div class="chips" role="group" aria-label="Quick amounts">${[10, 25, 50, 100].map((v) => `<button type="button" class="chip" data-usd="${v}" aria-pressed="${v === 25}">$${v}</button>`).join("")}</div>
        </fieldset>
        <div class="field"><label for="amt-usd">Custom amount (USD)</label><input class="input" id="amt-usd" type="number" inputmode="decimal" min="1" step="any" value="25"><span class="hint" id="eq-usd"></span></div>
        <div class="box" style="text-align:center">
          <p class="muted" style="margin-bottom:10px">Sandbox only. Do not send tokens or money. Live TRON verification is not configured.</p>
        </div>
        <div class="field"><label for="txid">Sample transaction hash</label><input class="input mono" id="txid" autocomplete="off" spellcheck="false" placeholder="64-character sample hash" aria-describedby="txid-h"><span class="hint" id="txid-h">This is only a format example; no blockchain transaction is checked</span>
          ${DEMO ? `<button type="button" class="link-btn" id="sample">Use a sample hash (test mode)</button>` : ""}</div>
      </div>

      <div role="tabpanel" id="panel-ngn" aria-labelledby="tab-ngn" hidden>
        <fieldset><legend class="legend">Amount in naira</legend>
          <div class="chips" role="group" aria-label="Quick amounts">${[5000, 15000, 35000, 75000].map((v) => `<button type="button" class="chip" data-ngn="${v}" aria-pressed="false">${ngn(v)}</button>`).join("")}</div>
        </fieldset>
        <div class="field"><label for="amt-ngn">Custom amount (NGN, minimum ₦500)</label><input class="input" id="amt-ngn" type="number" inputmode="numeric" min="500" step="any" value="25000"><span class="hint" id="eq-ngn"></span></div>
        <div class="box"><p class="muted">Cleva is not connected yet. No account number is available, and no transfer should be made.</p></div>
        <div class="field"><label for="nref">Sandbox reference</label><input class="input mono" id="nref" autocomplete="off" placeholder="demo-ref-123" aria-describedby="nref-h"><span class="hint" id="nref-h">Use a made-up demo reference; do not enter a real payment reference</span></div>
      </div>

      <div class="field"><label for="dname">Name on the ledger <span class="opt">(optional)</span></label><input class="input" id="dname" autocomplete="name" maxlength="60" placeholder="Anonymous" value="${esc(u ? u.name : "")}"></div>
      ${DEMO ? `<div class="notice warn">${icon("info")}<div>Simulation only: no money moves, no payment is verified, and simulated entries do not increase campaign totals.</div></div>` : ""}
      <button class="btn lg block" id="pay-go" type="submit">Create demo receipt</button>
    </form>`;
  const dlg = openModal(html, { label: "Try a demo contribution", focus: "#amt-usd" });
  const form = $("#pay-form", dlg);
  const usdIn = $("#amt-usd", dlg), ngnIn = $("#amt-ngn", dlg);

  const eq = () => {
    $("#eq-usd", dlg).textContent = `About ${ngn((+usdIn.value || 0) * state.rate)} at ₦${state.rate.toLocaleString()} per $1`;
    $("#eq-ngn", dlg).textContent = `About ${usd((+ngnIn.value || 0) / state.rate)}`;
  };
  eq();
  const setPressed = (sel, attr, v) => $$(sel, dlg).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset[attr] === v)));
  $$("[data-usd]", dlg).forEach((b) => b.addEventListener("click", () => { usdIn.value = b.dataset.usd; S.usd = +b.dataset.usd; setPressed("[data-usd]", "usd", S.usd); eq(); }));
  $$("[data-ngn]", dlg).forEach((b) => b.addEventListener("click", () => { ngnIn.value = b.dataset.ngn; S.ngn = +b.dataset.ngn; setPressed("[data-ngn]", "ngn", S.ngn); eq(); }));
  usdIn.addEventListener("input", () => { S.usd = +usdIn.value; setPressed("[data-usd]", "usd", S.usd); eq(); });
  ngnIn.addEventListener("input", () => { S.ngn = +ngnIn.value; setPressed("[data-ngn]", "ngn", S.ngn); eq(); });

  const tabs = [$("#tab-usdt", dlg), $("#tab-ngn", dlg)];
  const pick = (i, focus) => {
    S.rail = i === 0 ? "usdt" : "ngn";
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
    $("#panel-usdt", dlg).hidden = i !== 0;
    $("#panel-ngn", dlg).hidden = i !== 1;
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => pick(i));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        pick(e.key === "ArrowLeft" || e.key === "Home" ? 0 : 1, true);
      }
    });
  });
  $("#sample", dlg)?.addEventListener("click", () => { $("#txid", dlg).value = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usdRail = S.rail === "usdt";
    const rules = usdRail
      ? {
          "amt-usd": (v) => (!(+v >= 1) ? "Enter an amount of at least $1" : ""),
          txid: (v) => (!v ? "Enter a sample transaction hash" : !HEX64.test(v) ? "A transaction hash is 64 letters and numbers (0 to 9, a to f)" : ""),
        }
      : {
          "amt-ngn": (v) => (!(+v >= 500) ? "The minimum is ₦500" : ""),
          nref: (v) => (!v ? "Enter a made-up sandbox reference" : v.length < 6 ? "That reference looks too short" : ""),
        };
    if (!validate(form, rules, "[data-summary]")) return;
    // read everything before the form is replaced by the progress view
    const donor_name = $("#dname", dlg).value.trim() || "Anonymous Backer";
    const payload = usdRail
      ? { path: "/api/payments/verify-usdt", body: { tx_hash: $("#txid", dlg).value.trim(), campaign_id: c.id, donor_name, amount_usd: +usdIn.value } }
      : { path: "/api/payments/verify-naira", body: { provider_reference: $("#nref", dlg).value.trim(), campaign_id: c.id, donor_name, amount_ngn: +ngnIn.value } };
    setModalBody(`<div class="center" role="status"><div class="spin" aria-hidden="true"></div><p class="muted">Saving a sandbox simulation…</p></div>`, "Please wait");
    const res = await api(payload.path, { method: "POST", body: payload.body });
    if (!res.ok) {
      const d = setModalBody(
        `<div class="notice bad" role="alert">${icon("triangle-alert")}<div>${esc(res.data.error || "We could not record that contribution.")}</div></div>
         <div class="modal-foot"><button class="btn sec" id="again">Go back</button><button class="btn" data-close2>Close</button></div>`,
        "Contribution not recorded"
      );
      $("#again", d).addEventListener("click", () => openContribute(c));
      $("[data-close2]", d).addEventListener("click", () => closeModal());
      $("#again", d).focus();
      return;
    }
    const d = res.data;
    state.ledger = null;
    showReceipt({
      ref: d.reference, donor_name, campaign_title: c.title, campaign_org: c.org,
      amount_usd: d.amount_usd, amount_ngn: d.amount_ngn,
      channel: usdRail ? "USDT_TRC20" : "NAIRA_TRANSFER", currency: usdRail ? "USD" : "NGN",
      receipt_hash: d.receipt_hash, status: d.status, created_at: Math.floor(Date.now() / 1000),
    }, true);
    announce("Demo receipt created; no payment was made");
  });
}

/* ---------- receipt ---------- */
export function showReceipt(x, fresh = false) {
  const rows = [
    ["Reference", `<span class="mono">${esc(x.ref)}</span>`],
    x.status ? ["Record status", x.status === "simulated" ? "Sandbox simulation · not a payment" : "Sample/demo record"] : null,
    ["Campaign", esc(x.campaign_title || "Campaign")],
    ["Contributor", esc(x.donor_name)],
    ["Amount", `${usd(x.amount_usd)} (${ngn(x.amount_ngn)})`],
    ["Method", esc(CHANNEL_LABEL[x.channel] || x.channel)],
    x.network ? ["Network", esc(x.network)] : null,
    x.tx_hash ? ["Transaction", `<span class="mono">${esc(short(x.tx_hash, 22))}</span>`] : null,
    x.block_height ? ["Block", `<span class="mono">${esc(x.block_height)}</span>`] : null,
    ["Date", fmtDate(x.created_at) || "Today"],
    ["Ledger seal", `<span class="mono">${esc(short(x.receipt_hash, 22))}</span>`],
  ].filter(Boolean);
  const d = openModal(
    `<p class="lede">${x.status === "simulated" ? "Simulation only  -  this is not a payment receipt. No funds moved or were verified." : fresh ? "Your contribution is on the public ledger. Keep this reference for your records." : "A sealed record from the public ledger."}</p>
     <dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
     <div class="modal-foot no-print"><button class="btn sec" id="rc-copy">${icon("copy")}Copy reference</button><button class="btn sec" id="rc-print">${icon("printer")}Print or save PDF</button></div>
     <div class="modal-foot one no-print"><button class="btn" id="rc-done">Done</button></div>`,
    { label: x.status === "simulated" ? "Demo receipt · not paid" : fresh ? "Sample record created" : "Sample receipt", printable: true, focus: "#rc-done" }
  );
  $("#rc-copy", d).addEventListener("click", () => copyText(x.ref, "Reference copied"));
  $("#rc-print", d).addEventListener("click", () => window.print());
  $("#rc-done", d).addEventListener("click", () => { closeModal(); if (fresh) dispatchEvent(new HashChangeEvent("hashchange")); });
}

/* ---------- share ---------- */
function openShare(c) {
  const url = location.origin + location.pathname + "#/c/" + c.id;
  const text = `${c.title} is raising money on UniFund`;
  const d = openModal(
    `<p class="lede">Send this campaign to alumni, friends and supporters.</p>
     <div class="qr">${qrSvg(url, "QR code linking to this campaign")}</div>
     <div class="mono box" style="text-align:center">${esc(url)}</div>
     <div class="two" style="gap:10px">
       <a class="btn sec" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}">WhatsApp</a>
       <a class="btn sec" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
       <a class="btn sec" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}">X</a>
       <button class="btn" id="sh-copy">${icon("copy")}Copy link</button>
     </div>`,
    { label: "Share this campaign", focus: "#sh-copy" }
  );
  $("#sh-copy", d).addEventListener("click", () => copyText(url, "Link copied"));
}

/* ---------- spending log ---------- */
function openSpending(c) {
  const d = openModal(
    `<p class="lede">Every expense is public, so backers can follow the money.</p>
     <form id="sp-form" novalidate>
       <div data-summary class="err-summary"></div>
       <div class="field"><label for="sp-title">What was it for</label><input class="input" id="sp-title" maxlength="120" placeholder="Carbon propellers"></div>
       <div class="two">
         <div class="field"><label for="sp-amt">Amount</label><input class="input" id="sp-amt" type="number" min="1" step="any" inputmode="decimal"></div>
         <div class="field"><label for="sp-cur">Currency</label><select class="input" id="sp-cur"><option value="USD">USD</option><option value="NGN">NGN</option></select></div>
       </div>
       <div class="field"><label for="sp-vendor">Vendor</label><input class="input" id="sp-vendor" maxlength="120" placeholder="Robocore Electronics"></div>
       <div class="field"><label for="sp-notes">Invoice reference <span class="opt">(optional)</span></label><input class="input" id="sp-notes" maxlength="160" placeholder="Invoice RC-99120"></div>
       <button class="btn lg block" id="sp-go" type="submit">Publish expense</button>
     </form>`,
    { label: "Add an expense", focus: "#sp-title" }
  );
  const form = $("#sp-form", d);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ok = validate(form, {
      "sp-title": (v) => (v.length < 3 ? "Say what the money was spent on" : ""),
      "sp-amt": (v) => (!(+v > 0) ? "Enter an amount greater than zero" : ""),
      "sp-vendor": (v) => (!v ? "Enter the vendor or supplier" : ""),
    }, "[data-summary]");
    if (!ok) return;
    const btn = $("#sp-go", d);
    busy(btn, true, "Publishing…");
    const r = await api("/api/campaigns/spending", { method: "POST", body: {
      campaign_id: c.id, title: $("#sp-title", d).value.trim(), amount: +$("#sp-amt", d).value, currency: $("#sp-cur", d).value,
      vendor: $("#sp-vendor", d).value.trim(), notes: $("#sp-notes", d).value.trim() } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not publish that expense.");
    closeModal();
    toast("Expense published");
    dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
