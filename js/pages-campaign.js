// Campaign detail page plus the contribute, share, receipt and spending dialogs
import {
  $, $$, state, esc, icon, api, usd, ngn, pct, short, toast, copyText, openModal, setModalBody, closeModal,
  setFieldError, validate, serverError, busy, qrSvg, progressBar, statusTag, CATS, CHANNEL_LABEL, announce,
} from "./core.js?v=26";
import { loading, offline, empty } from "./components.js?v=26";

export const fmtDate = (sec) =>
  sec ? new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

const formatUsdt = (amount) => `${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT`;
const amountOf = (r) => r.status === "testnet_confirmed"
  ? formatUsdt(r.amount_usd)
  : r.currency === "USD" ? usd(r.amount_usd) : ngn(r.amount_ngn);
const tokenUnits = (value, decimals) => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[2] || "").length > decimals) return null;
  const fractional = (match[2] || "").padEnd(decimals, "0") || "0";
  return (BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fractional)).toString();
};

/* ---------- detail page ---------- */
export async function detail(main, ctx) {
  const id = ctx.parts[0];
  loading(main, "Loading campaign");
  const [r, paymentConfig] = await Promise.all([
    api(`/api/campaigns/${encodeURIComponent(id)}`),
    api("/api/payments/config", { auth: false }),
  ]);
  if (ctx.isStale()) return;
  if (r.status === 0) { offline(main, r.data.error); return "Campaign"; }
  if (!r.ok && r.status >= 500) { offline(main, r.data.error); return "Campaign"; }
  const c = r.ok ? r.data.campaign : null;
  const u = state.user;
  const owner = !!(u && c && (c.is_owner || u.role === "admin"));
  if (!c || (c.status !== "approved" && !owner)) {
    main.innerHTML = `<div class="page"><div class="narrow">${empty("search", "Campaign not found", "It may have been removed or declined.", `<a class="btn" href="/campaigns">Browse campaigns</a>`, 1)}</div></div>`;
    return "Campaign not found";
  }

  const spend = c.spending_reports || [];
  const conts = c.contributions || [];
  const totalSpent = spend.reduce((s, x) => s + (x.currency === "USD" ? x.amount : x.amount / state.rate), 0);

  main.innerHTML = `
  <div class="page"><div class="narrow">
    <a class="back" href="/campaigns">${icon("arrow-left", "sm")}All campaigns</a>
    ${c.status !== "approved" ? `<div class="notice warn" role="status">${icon("info")}<div><b>${c.status === "pending" ? "Awaiting review" : "Declined"}.</b> Only you and the audit committee can see this page${c.approval_notes ? `. Note: ${esc(c.approval_notes)}` : ""}</div></div>` : ""}
    <header class="detail-head">
      <div class="meta"><span class="tag">${esc(CATS[c.category] || "Project")}</span></div>
      <h1>${esc(c.title)}</h1>
      <p class="muted" style="margin-top:12px">by ${esc(c.org)}</p>
    </header>

    <section class="panel funds" aria-labelledby="funds-h">
      <p class="prototype-disclosure">Illustrative campaign, organization, and funding details; not a verified institutional project. Nile testnet transfers are separate and have no real value.</p>
      <h2 id="funds-h" class="sr">Funding status</h2>
      <div class="big">${usd(c.raised_usd)}</div>
      <p class="of">Example amount · goal ${usd(c.goal_usd)}</p>
      ${progressBar(c, "Funding progress")}
      <div class="facts"><span><strong>${c.backers_count}</strong> example backers</span><span><strong>${pct(c)}%</strong> example progress</span><span><strong>${c.days} days</strong> campaign length</span></div>
      <div class="actions">
        <button class="btn lg" id="contribute">${icon("wallet", "sm")}Contribute (USDT / Cleva)</button>
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
      <div class="panel-head"><h2 id="con-h">Recent records</h2><a class="link-btn" href="/ledger">View ledger</a></div>
      ${conts.length
      ? `<div class="rows">${conts.map((x) => `<div><span>${esc(x.donor_name)}<span class="sub">${x.status === "testnet_confirmed" ? "TRON Nile testnet · verified · no real value · " : x.status === "simulated" ? "Simulation · not paid · " : "Sample data · "}${esc(CHANNEL_LABEL[x.channel] || x.channel)} · <span class="mono">${esc(x.ref)}</span> · ${fmtDate(x.created_at)}${x.tx_hash ? ` · <a href="https://nile.tronscan.org/#/transaction/${encodeURIComponent(x.tx_hash)}" target="_blank" rel="noopener">View testnet transaction</a>` : ""}</span></span><span class="amt">${amountOf(x)}</span></div>`).join("")}</div>`
      : `<p class="muted">No records yet.</p>`}
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
    return `
      <div class="budget-card">
        <div class="budget-list">
          ${rows.map((m) => `
            <div class="budget-row">
              <span class="budget-name">${esc(m[1])}</span>
              <span class="budget-val mono">${usd(Number(m[2].replace(/,/g, "")))}</span>
            </div>
          `).join("")}
        </div>
        <div class="budget-total">
          <span>Total estimated budget</span>
          <span class="budget-total-val mono">${usd(total)}</span>
        </div>
      </div>
    `;
  }
  return `<p class="muted" style="white-space:pre-line">${esc(text)}</p>`;
}

/* ---------- contribute ---------- */
async function openContribute(c) {
  const configResponse = await api("/api/payments/config", { auth: false });
  if (!configResponse.ok) {
    toast(configResponse.data.error || "Payment configuration is unavailable.", "bad");
    return;
  }
  const testnetConfig = configResponse.data.mode === "tron-testnet" ? configResponse.data : null;
  const receiverAddr = testnetConfig?.receiver_address || "TNo8zm9LYgVeJZPyspseugpzFKqqMcJ7jk";
  const tokenContract = testnetConfig?.token_contract || "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
  const html = `
    <p class="lede">${esc(c.title)}</p>
    <form id="pay-form" novalidate>
      <div data-summary class="err-summary" tabindex="-1"></div>
      <div class="tabs" role="tablist" aria-label="Payment method">
        <button type="button" role="tab" id="tab-usdt" aria-selected="true" aria-controls="panel-usdt">USDT · TRON</button>
        <button type="button" role="tab" id="tab-ngn" aria-selected="false" aria-controls="panel-ngn" tabindex="-1">Cleva · Naira</button>
      </div>

      <div role="tabpanel" id="panel-usdt" aria-labelledby="tab-usdt">
        <fieldset><legend class="legend">Quick amount</legend>
          <div class="chips" role="group" aria-label="Quick amounts">${[10, 25, 50, 100].map((v) => `<button type="button" class="chip" data-usd="${v}" aria-pressed="${v === 25}">$${v}</button>`).join("")}</div>
        </fieldset>
        <div class="field"><label for="amt-usd">Amount in USDT</label><input class="input" id="amt-usd" type="number" inputmode="decimal" min="1" step="any" value="25" required><span class="hint" id="eq-usd"></span></div>

        <!-- Direct Wallet Transfer or Browser Wallet -->
        <div class="panel" style="background:var(--sunk);border:1px solid var(--line);margin:16px 0;padding:16px;border-radius:var(--r-lg)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:600;font-size:0.875rem">Deposit Address (TRC-20)</span>
            <button type="button" class="btn sm sec" id="copy-receiver-btn" style="padding:0 10px;height:32px;min-height:32px">${icon("copy", "sm")}Copy</button>
          </div>
          <div class="mono" id="disp-receiver-addr" style="font-size:0.8125rem;word-break:break-all;background:var(--surface);padding:10px 12px;border-radius:var(--r);border:1px solid var(--line);margin-bottom:12px;user-select:all">${esc(receiverAddr)}</div>
          
          <div class="field" style="margin-bottom:6px">
            <label for="manual-tx-hash" style="font-size:0.8125rem">Transaction Hash (TXID) <span class="opt">(optional if using TronLink)</span></label>
            <input class="input mono" id="manual-tx-hash" placeholder="64-character transaction hash" style="font-size:0.8125rem">
          </div>
          <span class="hint" style="font-size:0.75rem;margin:0">Send USDT from any TRON wallet (Trust Wallet, Binance, etc.), then paste the TXID above to confirm.</span>
        </div>
      </div>

      <div role="tabpanel" id="panel-ngn" aria-labelledby="tab-ngn" hidden>
        <fieldset><legend class="legend">Quick amount</legend>
          <div class="chips" role="group" aria-label="Quick amounts">${[5000, 15000, 35000, 75000].map((v) => `<button type="button" class="chip" data-ngn="${v}" aria-pressed="false">${ngn(v)}</button>`).join("")}</div>
        </fieldset>
        <div class="field"><label for="amt-ngn">Amount in naira</label><input class="input" id="amt-ngn" type="number" inputmode="numeric" min="500" step="any" value="25000" required><span class="hint" id="eq-ngn">Minimum ₦500</span></div>

        <!-- Cleva Dedicated Virtual Account Deposit -->
        <div class="panel" style="background:var(--sunk);border:1px solid var(--line);margin:16px 0;padding:16px;border-radius:var(--r-lg)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-weight:600;font-size:0.875rem">Cleva Dedicated Virtual Account</span>
            <button type="button" class="btn sm sec" id="copy-cleva-btn" style="padding:0 10px;height:32px;min-height:32px">${icon("copy", "sm")}Copy</button>
          </div>
          <div style="background:var(--surface);padding:12px 14px;border-radius:var(--r);border:1px solid var(--line);margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:0.8125rem;color:var(--muted)">Bank Name</span><span style="font-size:0.8125rem;font-weight:600">Wema Bank (Cleva Banking Rails)</span></div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:0.8125rem;color:var(--muted)">Account Number</span><span class="mono" id="disp-cleva-num" style="font-size:0.95rem;font-weight:700;letter-spacing:0.06em">0129481920</span></div>
            <div style="display:flex;justify-content:space-between"><span style="font-size:0.8125rem;color:var(--muted)">Beneficiary</span><span style="font-size:0.8125rem;font-weight:600">UniFund Student Treasury</span></div>
          </div>
          <span class="hint" style="font-size:0.75rem;margin:0">Cleva provides automated local Naira banking rails with instant USD treasury liquidity for student organizations.</span>
        </div>
      </div>

      <button class="btn lg block" id="pay-go" type="submit">Verify & Confirm Contribution</button>
    </form>`;
  const dlg = openModal(html, { label: "Payment options", focus: "#amt-usd" });
  const form = $("#pay-form", dlg);
  const usdIn = $("#amt-usd", dlg), ngnIn = $("#amt-ngn", dlg);

  const eq = () => {
    $("#eq-usd", dlg).textContent = `About ${ngn((+usdIn.value || 0) * state.rate)} using a sample rate`;
    $("#eq-ngn", dlg).textContent = `About ${usd((+ngnIn.value || 0) / state.rate)} using a sample rate`;
  };
  eq();
  const setPressed = (sel, attr, v) => $$(sel, dlg).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset[attr] === v)));
  $$("[data-usd]", dlg).forEach((b) => b.addEventListener("click", () => { usdIn.value = b.dataset.usd; setPressed("[data-usd]", "usd", +b.dataset.usd); eq(); }));
  $$("[data-ngn]", dlg).forEach((b) => b.addEventListener("click", () => { ngnIn.value = b.dataset.ngn; setPressed("[data-ngn]", "ngn", +b.dataset.ngn); eq(); }));
  usdIn.addEventListener("input", () => { setPressed("[data-usd]", "usd", +usdIn.value); eq(); });
  ngnIn.addEventListener("input", () => { setPressed("[data-ngn]", "ngn", +ngnIn.value); eq(); });

  $("#copy-receiver-btn", dlg)?.addEventListener("click", () => copyText(receiverAddr, "Treasury address copied"));
  $("#copy-cleva-btn", dlg)?.addEventListener("click", () => copyText("0129481920", "Cleva account number copied"));

  const tabs = [$("#tab-usdt", dlg), $("#tab-ngn", dlg)];
  let selectedRail = "usdt";
  const updateSubmitLabel = () => {
    const manualTx = $("#manual-tx-hash", dlg)?.value.trim();
    $("#pay-go", dlg).textContent = selectedRail === "usdt"
      ? (manualTx ? "Verify & Record Manual Transfer" : (window.tron ? "Send test USDT via TronLink" : "Verify test USDT transfer"))
      : "Complete Cleva payment session";
  };
  $("#manual-tx-hash", dlg)?.addEventListener("input", updateSubmitLabel);
  const pick = (i, focus) => {
    selectedRail = i === 0 ? "usdt" : "cleva";
    tabs.forEach((t, j) => { t.setAttribute("aria-selected", String(i === j)); t.tabIndex = i === j ? 0 : -1; });
    $("#panel-usdt", dlg).hidden = i !== 0;
    $("#panel-ngn", dlg).hidden = i !== 1;
    updateSubmitLabel();
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
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usdRail = selectedRail === "usdt";
    const rules = usdRail
      ? { "amt-usd": (v) => (!(+v >= 1) ? "Enter an amount of at least 1 USDT" : "") }
      : { "amt-ngn": (v) => (!(+v >= 500) ? "The minimum is ₦500" : "") };
    if (!validate(form, rules, "[data-summary]")) return;
    const amount = usdRail ? testnetConfig ? formatUsdt(usdIn.value) : `${usd(+usdIn.value)} USDT` : ngn(+ngnIn.value);
    if (usdRail) {
      const amountValue = usdIn.value.trim();
      const manualTxId = $("#manual-tx-hash", dlg)?.value.trim();

      // If user provided a manual transaction hash from any wallet (Trust Wallet, Binance, TronLink)
      if (manualTxId) {
        if (!/^[a-f0-9]{64}$/i.test(manualTxId)) {
          return serverError(form, "The transaction hash must be 64 hexadecimal characters.");
        }
        const btn = $("#pay-go", dlg);
        busy(btn, true, "Verifying on TRON Nile testnet…");
        const result = await api("/api/payments/verify-usdt", {
          method: "POST",
          body: {
            campaign_id: c.id,
            amount_usd: amountValue,
            sender_address: receiverAddr, // or any valid base58 sender address verified by server
            tx_id: manualTxId,
            donor_name: state.user ? state.user.name : "Anonymous Backer",
          },
        });
        busy(btn, false);
        if (result.ok) {
          const done = setModalBody(`
            <div class="notice" role="status">${icon("circle-check")}<div><b>Verified on TRON Nile testnet.</b> Transfer solidified and sealed into public ledger.</div></div>
            <dl class="kv">
              <div><dt>Amount</dt><dd><b>${esc(amount)}</b></dd></div>
              <div><dt>Transaction</dt><dd><a class="mono" href="https://nile.tronscan.org/#/transaction/${encodeURIComponent(manualTxId)}" target="_blank" rel="noopener">${esc(manualTxId)}</a></dd></div>
              <div><dt>Solidified block</dt><dd>${esc(result.data.block_height || "Verified")}</dd></div>
              <div><dt>SHA-256 seal</dt><dd class="mono" style="font-size:.75rem">${esc(result.data.receipt_hash || "")}</dd></div>
            </dl>
            <div class="modal-foot"><button class="btn" id="payment-done">Done</button></div>
          `, "Testnet transfer confirmed");
          $("#payment-done", done).addEventListener("click", () => {
            state.ledger = null;
            closeModal();
            dispatchEvent(new Event("uf:route"));
          });
          return;
        } else {
          return serverError(form, result.data.error || "Could not verify that transaction hash on Nile testnet. Ensure the transfer to the treasury address succeeded.");
        }
      }

      // Otherwise attempt TronLink if installed
      const provider = window.tron;
      if (provider && provider.isTronLink === true) {
        const btn = $("#pay-go", dlg);
        busy(btn, true, "Connecting TronLink…");
        try {
          await provider.request({ method: "eth_requestAccounts" });
          const tronWeb = provider.tronWeb;
          if (tronWeb && tronWeb.defaultAddress?.base58) {
            const senderAddress = tronWeb.defaultAddress.base58;
            const token = await tronWeb.contract().at(tokenContract);
            const amountUnits = tokenUnits(amountValue, testnetConfig?.decimals || 6);
            busy(btn, true, "Approve in TronLink…");
            const submitted = await token.transfer(receiverAddr, amountUnits).send({
              feeLimit: 100_000_000,
              callValue: 0,
              shouldPollResponse: false,
            });
            const txId = typeof submitted === "string" ? submitted : submitted?.txid || submitted?.txID;
            if (/^[a-f0-9]{64}$/i.test(txId || "")) {
              busy(btn, true, "Checking solidified receipt…");
              const res = await api("/api/payments/verify-usdt", {
                method: "POST",
                body: { campaign_id: c.id, amount_usd: amountValue, sender_address: senderAddress, tx_id: txId },
              });
              busy(btn, false);
              if (res.ok) {
                const done = setModalBody(`
                  <div class="notice" role="status">${icon("circle-check")}<div><b>Verified on TRON Nile testnet.</b></div></div>
                  <dl class="kv"><div><dt>Amount</dt><dd>${esc(amount)}</dd></div><div><dt>Transaction</dt><dd><a class="mono" href="https://nile.tronscan.org/#/transaction/${encodeURIComponent(txId)}" target="_blank" rel="noopener">${esc(txId)}</a></dd></div></dl>
                  <div class="modal-foot"><button class="btn" id="payment-done">Done</button></div>
                `, "Transfer verified");
                $("#payment-done", done).addEventListener("click", () => { state.ledger = null; closeModal(); dispatchEvent(new Event("uf:route")); });
                return;
              }
            }
          }
        } catch (err) {
          console.warn("TronLink prompt cancelled or failed:", err);
        }
        busy(btn, false);
      }

      // If TronLink is not installed or skipped, prompt user with copyable treasury instructions
      return serverError(form, "Copy the Treasury Deposit Address above, send USDT from any TRON wallet app, then paste your Transaction Hash (TXID) into the box above to verify.");
    }
    if (!usdRail && (!testnetConfig || selectedRail === "cleva")) {
      const btn = $("#pay-go", dlg);
      busy(btn, true, "Simulating Cleva payment session…");
      const r = await api("/api/payments/verify-naira", {
        method: "POST",
        body: {
          campaign_id: c.id,
          amount_ngn: +ngnIn.value,
          donor_name: state.user ? state.user.name : "Anonymous Backer",
        },
      });
      busy(btn, false);
      if (r.ok) {
        const d = setModalBody(`
          <div class="notice" role="status">${icon("circle-check")}<div><b>Cleva Sandbox Payment Recorded.</b> Simulation mode: reference generated and sealed into the cryptographic ledger.</div></div>
          <dl class="kv">
            <div><dt>Amount</dt><dd><b>${ngn(r.data.amount_ngn)}</b> (${usd(r.data.amount_usd)})</dd></div>
            <div><dt>Audit reference</dt><dd class="mono">${esc(r.data.reference)}</dd></div>
            <div><dt>SHA-256 seal</dt><dd class="mono" style="font-size:.75rem">${esc(r.data.receipt_hash.slice(0, 32))}...</dd></div>
          </dl>
          <p class="hint">Recorded in the public audit ledger. In live production, Cleva webhooks automatically settle this into the campaign treasury.</p>
          <div class="modal-foot"><button class="btn" id="payment-done">View in ledger</button></div>
        `, "Cleva sandbox verified");
        $("#payment-done", d).addEventListener("click", () => {
          state.ledger = null;
          closeModal();
          dispatchEvent(new CustomEvent("uf:navigate", { detail: "/ledger" }));
        });
        return;
      }
    }

    const route = usdRail ? {
      name: "USDT on TRON",
      steps: [
        ["Choose a wallet", "The backer connects a TRON wallet such as TronLink."],
        ["Review and approve", "The backer reviews the recipient contract and exact USDT amount."],
        ["Check the transfer", "UniFund verifies the on-chain transfer via TronGrid solidified receipt."],
      ],
      unavailable: "Wallet connection, organization wallet setup, and TRON verification are not connected.",
    } : {
      name: "Cleva · Naira & USD",
      steps: [
        ["Start Cleva checkout", "UniFund requests an authorized payment session from Cleva."],
        ["Approve in Cleva", "The backer authorizes payment via bank transfer, US debit card, or Cleva USD balance."],
        ["Confirm the result", "Cleva webhook triggers dual-custody treasury credit before updating the ledger."],
      ],
      unavailable: "Cleva API access, checkout, and payment confirmation are in sandbox preview.",
    };
    const d = setModalBody(`
      <p class="lede">${esc(c.title)}</p>
      <div class="notice warn" role="status">${icon("info")}<div><b>Preview only.</b> No wallet opened, payment request sent, or contribution saved.</div></div>
      <dl class="kv">
        <div><dt>Payment route</dt><dd>${esc(route.name)}</dd></div>
        <div><dt>Amount</dt><dd>${esc(amount)}</dd></div>
        <div><dt>Treasury address</dt><dd class="mono">${esc(receiverAddr.slice(0, 14))}... <button type="button" class="link-btn" id="preview-copy-wallet">Copy</button></dd></div>
      </dl>
      <ol class="payment-walkthrough">${route.steps.map(([title, detail], i) => `<li><span class="payment-step-number" aria-hidden="true">${i + 1}</span><div><h3>${title}</h3><p>${detail}</p></div></li>`).join("")}</ol>
      <p class="hint" style="margin-top:16px">${esc(route.unavailable)}</p>
      <div class="modal-foot"><button class="btn sec" id="payment-edit">Change amount</button><button class="btn" id="payment-done">Done</button></div>
    `, "How payment would work");
    $("#preview-copy-wallet", d)?.addEventListener("click", () => copyText(receiverAddr, "Treasury address copied"));
    $("#payment-edit", d).addEventListener("click", () => openContribute(c));
    $("#payment-done", d).addEventListener("click", () => closeModal());
    $("#payment-done", d).focus();
    announce("Payment flow preview shown; no payment was sent");
  });
}

/* ---------- receipt ---------- */
export function showReceipt(x, fresh = false) {
  const rows = [
    ["Reference", `<span class="mono">${esc(x.ref)}</span>`],
    x.status ? ["Record status", x.status === "testnet_confirmed" ? "Verified on TRON Nile testnet · test tokens have no real value" : x.status === "simulated" ? "Test record · not a payment" : "Example entry"] : null,
    ["Campaign", esc(x.campaign_title || "Campaign")],
    ["Contributor", esc(x.donor_name)],
    ["Amount", `${x.status === "testnet_confirmed" ? formatUsdt(x.amount_usd) : usd(x.amount_usd)} (${ngn(x.amount_ngn)})`],
    ["Method", esc(CHANNEL_LABEL[x.channel] || x.channel)],
    x.tx_hash ? ["Transaction", `<a class="mono" href="https://nile.tronscan.org/#/transaction/${encodeURIComponent(x.tx_hash)}" target="_blank" rel="noopener">${esc(short(x.tx_hash, 22))}</a>`] : null,
    ["Date", fmtDate(x.created_at) || "Today"],
    ["Record hash", `<span class="mono">${esc(short(x.receipt_hash, 22))}</span>`],
  ].filter(Boolean);
  const d = openModal(
    `    <p class="lede">${x.status === "testnet_confirmed" ? "The transfer was confirmed on Nile testnet. Test tokens have no real value." : x.status === "simulated" ? "Simulation only  -  this is not a payment receipt. No funds moved or were verified." : fresh ? "Your test entry is on the public ledger. Keep this reference for your records." : "A database record from the public ledger."}</p>
     <dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
     <div class="modal-foot no-print"><button class="btn sec" id="rc-copy">${icon("copy")}Copy reference</button><button class="btn sec" id="rc-print">${icon("printer")}Print or save PDF</button></div>
     <div class="modal-foot one no-print"><button class="btn" id="rc-done">Done</button></div>`,
    { label: x.status === "testnet_confirmed" ? "Nile testnet transfer" : x.status === "simulated" ? "Test record · not paid" : fresh ? "Example record created" : "Example record", printable: true, focus: "#rc-done" }
  );
  $("#rc-copy", d).addEventListener("click", () => copyText(x.ref, "Reference copied"));
  $("#rc-print", d).addEventListener("click", () => window.print());
  $("#rc-done", d).addEventListener("click", () => { closeModal(); if (fresh) dispatchEvent(new Event("uf:route")); });
}

/* ---------- share ---------- */
function openShare(c) {
  const url = location.origin + "/c/" + c.id;
  const text = `Example campaign: ${c.title} on UniFund`;
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
       <p class="hint">Purpose, amount, and vendor are required.</p>
       <div class="field"><label for="sp-title">What was it for</label><input class="input" id="sp-title" maxlength="120" placeholder="Carbon propellers" required></div>
       <div class="two">
         <div class="field"><label for="sp-amt">Amount</label><input class="input" id="sp-amt" type="number" min="1" step="any" inputmode="decimal" required></div>
         <div class="field"><label for="sp-cur">Currency</label><select class="input" id="sp-cur"><option value="USD">USD</option><option value="NGN">NGN</option></select></div>
       </div>
       <div class="field"><label for="sp-vendor">Vendor</label><input class="input" id="sp-vendor" maxlength="120" placeholder="Robocore Electronics" required></div>
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
    const r = await api("/api/campaigns/spending", {
      method: "POST", body: {
        campaign_id: c.id, title: $("#sp-title", d).value.trim(), amount: +$("#sp-amt", d).value, currency: $("#sp-cur", d).value,
        vendor: $("#sp-vendor", d).value.trim(), notes: $("#sp-notes", d).value.trim()
      }
    });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not publish that expense.");
    closeModal();
    toast("Expense published");
    dispatchEvent(new Event("uf:route"));
  });
}
