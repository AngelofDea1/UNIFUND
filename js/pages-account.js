// Account pages: sign in, sign up, start a campaign, organization dashboard, backer history, audit panel
import {
  $, $$, state, esc, icon, api, token, usd, ngn, pct, toast, announce, busy, validate, serverError, setFieldError,
  progressBar, statusTag, CATS, CHANNEL_LABEL, ROLE_LABEL, openModal, closeModal, formatUsdt,
} from "./core.js?v=26";
import { loading, offline, pageHead, empty } from "./components.js?v=26";
import { showReceipt, fmtDate, budget } from "./pages-campaign.js?v=26";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const roleHome = (u) => (u.role === "admin" ? "/admin" : u.role === "student_org" ? "/dashboard" : "/donor");
const navigate = (path) => dispatchEvent(new CustomEvent("uf:navigate", { detail: path }));

function setSession(data) {
  token.set(data.token);
  state.user = data.user;
  dispatchEvent(new Event("uf:auth"));
}

function pwField(id, label, autocomplete, hint) {
  return `<div class="field"><label for="${id}">${label}</label>
    <div class="pw"><input class="input" id="${id}" type="password" autocomplete="${autocomplete}" maxlength="128" required ${hint ? `aria-describedby="${id}-h"` : ""}>
      <button type="button" data-toggle="${id}" aria-label="Show password" aria-pressed="false">${icon("eye")}</button></div>
    ${hint ? `<span class="hint" id="${id}-h">${hint}</span>` : ""}</div>`;
}
function wirePw(root) {
  $$("[data-toggle]", root).forEach((b) => b.addEventListener("click", () => {
    const i = $("#" + b.dataset.toggle, root);
    const show = i.type === "password";
    i.type = show ? "text" : "password";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
    b.innerHTML = icon(show ? "eye-off" : "eye");
  }));
}

function gate(main, { title, text, actions }) {
  main.innerHTML = `<div class="page"><div class="narrow"><div class="panel center">${icon("lock")}<h1 style="font-size:1.6rem;margin:14px 0 8px">${esc(title)}</h1><p class="muted">${text}</p><div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px">${actions}</div></div></div></div>`;
}
const needSignIn = (main, why, next) => {
  gate(main, { title: "Sign in to continue", text: why, actions: `<a class="btn" href="/signin?next=${encodeURIComponent(next)}">Sign in</a><a class="btn sec" href="/signup">Create an account</a>` });
  return "Sign in to continue";
};

/* ---------- sign in ---------- */
export function signin(main, ctx) {
  if (state.user) {
    gate(main, { title: `You are signed in`, text: `Signed in as ${esc(state.user.name)}.`, actions: `<a class="btn" href="${roleHome(state.user)}">Go to my account</a><a class="btn sec" href="/campaigns">Browse campaigns</a>` });
    return "Sign in";
  }
  const next = ctx.query.get("next");
  main.innerHTML = `
  <div class="page auth-page"><div class="form-w">
    ${pageHead("Sign in to UniFund", "Manage campaigns or view saved records.")}
    <form class="panel" id="si-form" novalidate>
      <div data-summary class="err-summary"></div>
      <div class="field"><label for="si-email">Email address</label><input class="input" id="si-email" type="email" autocomplete="email" inputmode="email" required></div>
      ${pwField("si-pw", "Password", "current-password")}
      <button class="btn lg block" id="si-go" type="submit">Sign in</button>
    </form>
    <p class="form-foot">New to UniFund? <a href="/signup">Create an account</a></p>
    ${state.demoAccountsAllowed ? `<details class="panel" style="margin-top:20px;padding:20px"><summary style="cursor:pointer;font-weight:600">Demo accounts (local test mode only)</summary>
      <div class="rows" style="margin-top:14px">
        ${[["Audit committee", "committee@example.test", "admin123"], ["Student organization", "organizer@example.test", "student123"], ["Backer", "backer@example.test", "donor123"]].map(([l, e, p]) => `<div><span>${l}<span class="sub mono">${e}</span></span><button type="button" class="btn sm sec" data-fill="${e}|${p}">Fill in</button></div>`).join("")}
      </div></details>` : ""}
  </div></div>`;
  wirePw(main);
  const form = $("#si-form");
  $$("[data-fill]").forEach((b) => b.addEventListener("click", () => { const [e, p] = b.dataset.fill.split("|"); $("#si-email").value = e; $("#si-pw").value = p; $("#si-go").focus(); }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate(form, {
      "si-email": (v) => (!v ? "Enter your email address" : !EMAIL.test(v) ? "That does not look like an email address" : ""),
      "si-pw": (v) => (!v ? "Enter your password" : ""),
    }, "[data-summary]")) return;
    const btn = $("#si-go");
    busy(btn, true, "Signing in…");
    const r = await api("/api/auth/login", { method: "POST", auth: false, body: { email: $("#si-email").value.trim(), password: $("#si-pw").value } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.status === 401 ? "That email and password do not match. Check them and try again." : r.data.error);
    setSession(r.data);
    toast(`Welcome back, ${r.data.user.name.split(" ")[0]}`);
    navigate(next && next.startsWith("/") ? next : roleHome(r.data.user));
  });
  return "Sign in";
}

/* ---------- sign up ---------- */
const strength = (p) => [p.length >= 8, /[a-z]/.test(p) && /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p) || p.length >= 12].filter(Boolean).length;

export function signup(main) {
  if (state.user) {
    gate(main, { title: "You already have an account", text: `Signed in as ${esc(state.user.name)}.`, actions: `<a class="btn" href="${roleHome(state.user)}">Go to my account</a>` });
    return "Create an account";
  }
  main.innerHTML = `
  <div class="page auth-page"><div class="form-w" style="max-width:600px">
    ${pageHead("Create an account", "Choose how you’ll use UniFund.")}
    <form class="panel" id="su-form" novalidate>
      <div data-summary class="err-summary"></div>
      <fieldset><legend class="legend">I am signing up as</legend>
        <div class="choices">
          <label class="choice"><input type="radio" name="role" value="student_org" checked><span><b>Student organization</b><span>Create campaigns and record spending.</span></span></label>
          <label class="choice"><input type="radio" name="role" value="donor"><span><b>Backer</b><span>Follow campaigns and keep contribution records.</span></span></label>
        </div>
      </fieldset>
      <div class="field"><label for="su-name">Your full name</label><input class="input" id="su-name" autocomplete="name" maxlength="80" required></div>
      <div class="field"><label for="su-email">Email address</label><input class="input" id="su-email" type="email" maxlength="254" autocomplete="email" inputmode="email" required></div>
      <div id="org-fields">
        <div class="field"><label for="su-org">Organization name</label><input class="input" id="su-org" autocomplete="organization" maxlength="80" placeholder="Robotics and Embedded Systems Society" required></div>
        <div class="field"><label for="su-campus">Campus code</label><input class="input" id="su-campus" maxlength="12" autocapitalize="characters" placeholder="UNILAG" aria-describedby="su-campus-h" required><span class="hint" id="su-campus-h">Your university's short name. UniFund does not verify campus affiliation yet.</span></div>
      </div>
      ${pwField("su-pw", "Password", "new-password", "At least 8 characters. A longer phrase is stronger")}
      <div class="strength" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="field" style="margin-top:20px"><div class="check"><input type="checkbox" id="su-terms" aria-describedby="su-terms-err" required><label for="su-terms" style="font-weight:400;margin:0">I agree to the <a href="/terms" target="_blank" rel="noopener">terms</a> and <a href="/privacy" target="_blank" rel="noopener">privacy notice</a></label></div><div class="err" id="su-terms-err"></div></div>
      <button class="btn lg block" id="su-go" type="submit">Create account</button>
    </form>
    <p class="form-foot">Already have an account? <a href="/signin">Sign in</a></p>
  </div></div>`;
  wirePw(main);
  const form = $("#su-form");
  const isOrg = () => form.elements.role.value === "student_org";
  const sync = () => {
    const show = isOrg();
    $("#org-fields").hidden = !show;
    $$("#org-fields input").forEach((input) => { input.required = show; });
  };
  $$("input[name=role]").forEach((r) => r.addEventListener("change", sync));
  $("#su-pw").addEventListener("input", (e) => { const n = strength(e.target.value); $$(".strength i").forEach((b, i) => b.classList.toggle("on", i < n)); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rules = {
      "su-name": (v) => (v.length < 2 ? "Enter your full name" : ""),
      "su-email": (v) => (!v ? "Enter your email address" : !EMAIL.test(v) ? "That does not look like an email address" : ""),
      "su-pw": (v) => (v.length < 8 ? "Use at least 8 characters" : ""),
      "su-terms": (v, el) => (!el.checked ? "Please accept the terms to continue" : ""),
    };
    if (isOrg()) Object.assign(rules, {
      "su-org": (v) => (v.length < 3 ? "Enter your organization's name" : ""),
      "su-campus": (v) => (!v ? "Enter your campus code" : ""),
    });
    // order the rules by their position on the page so focus goes to the first problem
    const order = ["su-name", "su-email", "su-org", "su-campus", "su-pw", "su-terms"];
    const sorted = Object.fromEntries(order.filter((k) => rules[k]).map((k) => [k, rules[k]]));
    if (!isOrg()) ["su-org", "su-campus"].forEach((k) => setFieldError($("#" + k), ""));
    if (!validate(form, sorted, "[data-summary]")) return;
    const btn = $("#su-go");
    busy(btn, true, "Creating account…");
    const role = form.elements.role.value;
    const r = await api("/api/auth/register", { method: "POST", auth: false, body: {
      name: $("#su-name").value.trim(), email: $("#su-email").value.trim(), password: $("#su-pw").value, role,
      org_name: isOrg() ? $("#su-org").value.trim() : "", campus: isOrg() ? $("#su-campus").value.trim() : "" } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not create your account.");
    setSession(r.data);
    main.innerHTML = `<div class="page"><div class="narrow"><div class="panel center">${icon("circle-check")}<h1 style="font-size:1.75rem;margin:14px 0 10px">Welcome, ${esc(r.data.user.name.split(" ")[0])}</h1>
      <p class="muted">${role === "student_org" ? "Your account is ready. Launch a campaign immediately — payouts require co-signer escrow approval." : "Your account is ready. Browse campaigns and save a contribution record."}</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px">${role === "student_org" ? `<a class="btn lg" href="/start">Start a campaign</a><a class="btn sec lg" href="/dashboard">Go to dashboard</a>` : `<a class="btn lg" href="/campaigns">Browse campaigns</a>`}</div></div></div></div>`;
    main.querySelector("h1").setAttribute("tabindex", "-1");
    main.querySelector("h1").focus();
    announce("Account created");
  });
  return "Create an account";
}

/* ---------- start a campaign ---------- */
export function start(main) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in with your student organization account to start a campaign.", "/start");
  if (u.role === "donor") {
    gate(main, { title: "Organization accounts only", text: "Backer accounts cannot start campaigns. Create a student organization account to raise funds.", actions: `<a class="btn" href="/donor">My contributions</a><a class="btn sec" href="/signup">Create an organization account</a>` });
    return "Start a campaign";
  }
  main.innerHTML = `
  <div class="page"><div class="form-w campaign-form">
    ${pageHead("Start a campaign", "Tell people what you need and how you’ll use it.")}
    <div class="notice">${icon("shield-check")}<div>${u.role === "admin" ? "Campaigns you create go live straight away." : `Posting as <b>${esc(u.org_name || u.name)}</b>. Your campaign goes live immediately — all payout withdrawals require co-signer escrow approval.`}</div></div>
    <form class="panel" id="cp-form" novalidate>
      <div data-summary class="err-summary"></div>
      <p class="hint">All fields are required unless marked optional.</p>
      <h2 style="font-size:1.125rem;margin-bottom:18px">The basics</h2>
      <div class="field"><label for="cp-title">Campaign name</label><input class="input" id="cp-title" maxlength="90" aria-describedby="cp-title-h" placeholder="Solar charger for our campus" required><span class="hint" id="cp-title-h"><span id="cp-title-n">0</span> / 90 characters</span></div>
      <div class="field">
        <label for="cp-category">Campaign category</label>
        <div class="select-wrap">
          <select class="input" id="cp-category" name="category" required style="font-weight:600">
            ${Object.entries(CATS).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="cp-days">Campaign duration</label>
        <input type="hidden" id="cp-days" name="days" value="30">
        <div class="chips duration-chips" role="group" aria-label="Campaign duration" style="grid-template-columns:repeat(4,1fr)">
          ${[14, 30, 45, 60].map((d) => `<button type="button" class="chip duration-chip" data-days="${d}" aria-pressed="${d === 30}">${d} days</button>`).join("")}
        </div>
        <span class="hint">Recommended duration for active student projects is 30 days.</span>
      </div>
      <h2 style="font-size:1.125rem;margin:28px 0 18px">The money</h2>
      <div class="two">
        <div class="field"><label for="cp-goal">Funding goal (USD)</label><input class="input" id="cp-goal" type="number" min="50" step="any" value="1200" aria-describedby="cp-goal-h" required><span class="hint" id="cp-goal-h">Minimum $50 · About <b id="cp-ngn">${ngn(1200 * state.rate)}</b></span></div>
        <div class="field"><label for="cp-wallet">Treasury wallet address <span class="opt">(optional TRON)</span></label><input class="input mono" id="cp-wallet" placeholder="T... destination wallet for disbursements"><span class="hint">Organization address for dual-custody payouts.</span></div>
      </div>
      <h2 style="font-size:1.125rem;margin:28px 0 18px">The story</h2>
      <div class="field"><label for="cp-about">What are you building, and who benefits</label><textarea class="input" id="cp-about" rows="5" aria-describedby="cp-about-h" placeholder="Describe the goal, the students it helps and your timeline" required></textarea><span class="hint" id="cp-about-h"><span id="cp-about-n">0</span> characters, at least 20</span></div>
      
      <div class="field">
        <label>Itemized budget plan</label>
        <span class="hint" style="margin-bottom:12px">Add specific expense items and their costs in USD. Total calculates automatically.</span>
        <div class="budget-builder" id="budget-builder">
          <div class="budget-builder-rows" id="bb-rows">
            <div class="bb-row" style="display:grid;grid-template-columns:1fr 140px 36px;gap:8px;margin-bottom:8px">
              <input class="input bb-name" placeholder="Item (e.g. Solar panels)" value="Equipment & Components">
              <input class="input bb-cost" type="number" min="0" step="any" placeholder="Cost ($)" value="700">
              <button type="button" class="btn sec bb-del" style="padding:0;display:flex;align-items:center;justify-content:center" title="Remove item">${icon("x", "sm")}</button>
            </div>
            <div class="bb-row" style="display:grid;grid-template-columns:1fr 140px 36px;gap:8px;margin-bottom:8px">
              <input class="input bb-name" placeholder="Item (e.g. Battery pack)" value="Hardware & Logistics">
              <input class="input bb-cost" type="number" min="0" step="any" placeholder="Cost ($)" value="500">
              <button type="button" class="btn sec bb-del" style="padding:0;display:flex;align-items:center;justify-content:center" title="Remove item">${icon("x", "sm")}</button>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
            <button type="button" class="btn sm sec" id="bb-add">${icon("plus", "sm")}Add line item</button>
            <div class="bb-sum" style="font-weight:700;font-size:0.95rem">
              <span>Total: </span><span class="mono" id="bb-total" style="color:var(--acc)">$1,200</span>
            </div>
          </div>
        </div>
        <input type="hidden" id="cp-budget" name="budget_breakdown">
      </div>
      <button class="btn lg block" id="cp-go" type="submit">Publish campaign</button>
    </form>
  </div></div>`;
  const form = $("#cp-form");
  $("#cp-title").addEventListener("input", (e) => ($("#cp-title-n").textContent = e.target.value.length));
  $("#cp-about").addEventListener("input", (e) => ($("#cp-about-n").textContent = e.target.value.trim().length));
  $("#cp-goal").addEventListener("input", (e) => ($("#cp-ngn").textContent = ngn((+e.target.value || 0) * state.rate)));
  $$(".duration-chip", form).forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = btn.dataset.days;
      $("#cp-days").value = d;
      $$(".duration-chip", form).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    });
  });

  // Dynamic budget rows
  const syncBudget = () => {
    const rows = $$(".bb-row", form);
    let total = 0;
    const lines = [];
    rows.forEach((r) => {
      const name = $(".bb-name", r)?.value.trim() || "";
      const cost = Math.max(0, +$(".bb-cost", r)?.value || 0);
      if (name && cost > 0) {
        lines.push(`${name}: $${cost.toLocaleString("en-US")}`);
        total += cost;
      }
    });
    $("#bb-total", form).textContent = `$${total.toLocaleString("en-US")}`;
    $("#cp-budget", form).value = lines.join("\n");
  };

  $("#bb-rows", form).addEventListener("input", syncBudget);
  $("#bb-rows", form).addEventListener("click", (e) => {
    const delBtn = e.target.closest(".bb-del");
    if (delBtn) {
      const rows = $$(".bb-row", form);
      if (rows.length > 1) {
        delBtn.closest(".bb-row").remove();
        syncBudget();
      } else {
        toast("You must have at least one budget item", "bad");
      }
    }
  });

  $("#bb-add", form).addEventListener("click", () => {
    const container = $("#bb-rows", form);
    const div = document.createElement("div");
    div.className = "bb-row";
    div.style.cssText = "display:grid;grid-template-columns:1fr 140px 36px;gap:8px;margin-bottom:8px";
    div.innerHTML = `
      <input class="input bb-name" placeholder="Item name">
      <input class="input bb-cost" type="number" min="0" step="any" placeholder="Cost ($)">
      <button type="button" class="btn sec bb-del" style="padding:0;display:flex;align-items:center;justify-content:center" title="Remove item">${icon("x", "sm")}</button>
    `;
    container.appendChild(div);
    div.querySelector(".bb-name").focus();
    syncBudget();
  });
  syncBudget();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate(form, {
      "cp-title": (v) => (v.length < 5 ? "Campaign name must be at least 5 characters" : v.length > 90 ? "Keep the campaign name under 90 characters" : ""),
      "cp-days": (v) => (!(+v >= 1 && +v <= 90) ? "Choose between 1 and 90 days" : ""),
      "cp-goal": (v) => (!(+v >= 50) ? "The minimum goal is $50" : ""),
      "cp-about": (v) => (v.length < 20 ? "Describe the project in at least 20 characters" : ""),
    }, "[data-summary]")) return;
    const btn = $("#cp-go");
    busy(btn, true, "Submitting…");
    const r = await api("/api/campaigns", { method: "POST", body: {
      title: $("#cp-title").value.trim(), category: form.elements.category.value, days: +$("#cp-days").value, goal_usd: +$("#cp-goal").value,
      about: $("#cp-about").value.trim(), budget_breakdown: $("#cp-budget").value.trim(),
      wallet_address: $("#cp-wallet") ? $("#cp-wallet").value.trim() : "" } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not submit your campaign.");
    state.campaigns = null;
    const live = r.data.status === "approved";
    main.innerHTML = `<div class="page"><div class="narrow"><div class="panel center">${icon("circle-check")}<h1 style="font-size:1.75rem;margin:14px 0 10px">${live ? "Your campaign is live" : "Submitted for review"}</h1>
      <p class="muted">${live ? "It now appears in the directory." : "The audit committee will review it. You can follow its status on your dashboard, and it appears in the directory once approved."}</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px"><a class="btn lg" href="${live ? "/c/" + r.data.id : "/dashboard"}">${live ? "View campaign" : "Go to dashboard"}</a><a class="btn sec lg" href="/start">Start another</a></div></div></div></div>`;
    const h = main.querySelector("h1"); h.tabIndex = -1; h.focus();
    announce(live ? "Campaign published" : "Campaign submitted for review");
  });
  return "Start a campaign";
}

/* ---------- organization dashboard ---------- */
export async function dashboard(main, ctx) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in to see your campaigns.", "/dashboard");
  if (u.role === "donor") { navigate("/donor"); return "Dashboard"; }
  loading(main, "Loading your campaigns");
  const r = await api("/api/campaigns?status=mine");
  if (ctx.isStale()) return;
  if (!r.ok) { offline(main, r.data.error); return "Dashboard"; }
  const list = r.data.campaigns || [];
  const raised = list.reduce((s, c) => s + c.raised_usd, 0), backers = list.reduce((s, c) => s + c.backers_count, 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Organization dashboard", esc(u.org_name || u.name) + (u.campus ? ` · ${esc(u.campus)}` : ""))}
    ${u.role === "student_org" && !u.is_verified ? `<div class="notice warn" style="max-width:760px;margin:0 auto 24px">${icon("clock")}<div><b>Organization identity is not verified.</b> Your campaigns go live immediately, and all payout withdrawals require co-signer escrow approval.</div></div>` : ""}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto">    <div><b>${list.length}</b><span>campaigns</span></div><div><b>${usd(raised)}</b><span>example amount</span></div><div><b>${backers}</b><span>example backers</span></div></div>
    <section class="panel" style="max-width:760px;margin:0 auto" aria-labelledby="my-h">
      <div class="panel-head"><h2 id="my-h">Your campaigns</h2><a class="btn sm" href="/start">${icon("plus", "sm")}New campaign</a></div>
      ${list.length ? `<div class="rows">${list.map((c) => `<div style="align-items:flex-start;flex-wrap:wrap">
          <span style="flex:1;min-width:220px"><a href="/c/${c.id}" style="font-weight:650;color:var(--ink)">${esc(c.title)}</a>
            <span class="sub">${statusTag(c.status)} ${c.status === "rejected" && c.approval_notes ? `<span>${esc(c.approval_notes)}</span>` : ""}</span>
            <span class="sub" style="margin-top:10px">${progressBar(c, c.title + " progress")}</span></span>
          <span class="amt">${usd(c.raised_usd)}<span class="sub">of ${usd(c.goal_usd)} · ${c.backers_count} backers</span>
            <button class="link-btn" data-payout="${c.id}" style="margin-top:6px;display:block">Treasury / Payout</button>
          </span></div>`).join("")}</div>`
        : empty("file-text", "No campaigns yet", "Start your first campaign and share it with your supporters.", `<a class="btn" href="/start">Start a campaign</a>`, 2)}
    </section>
  </div></div>`;
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-payout]");
    if (b) openPayoutModal(+b.dataset.payout);
  });
  return "Organization dashboard";
}

/* ---------- payout / treasury modal ---------- */
async function openPayoutModal(campaignId) {
  const d = openModal(`<div class="center" style="padding:24px">${loading(null, "Loading treasury…")}</div>`, { label: "Campaign Treasury & Payout" });
  const r = await api(`/api/campaigns/${campaignId}/payout-summary`);
  if (!r.ok) {
    d.innerHTML = `<div class="notice bad">${icon("triangle-alert")}<div>${esc(r.data.error || "Unable to load payout details")}</div></div>`;
    return;
  }
  const data = r.data;
  const drawContent = () => {
    d.innerHTML = `
      <p class="lede">Manage student organization treasury and withdrawal requests for this campaign.</p>
      <div class="notice" style="margin-bottom:16px">${icon("shield-check")}<div><b>UniFund Dual-Custody Simulation:</b> Backer contributions are escrowed in the UniFund treasury. Organizations submit withdrawal requests with expense justification, which the audit committee reviews before fund release.</div></div>
      <dl class="kv" style="margin-bottom:16px">
        <div><dt>Confirmed testnet total</dt><dd>${formatUsdt(data.confirmed_testnet_usd)}</dd></div>
        <div><dt>Reserved / requested</dt><dd>${formatUsdt(data.reserved_testnet_usd)}</dd></div>
        <div><dt>Available to withdraw</dt><dd><b>${formatUsdt(data.available_testnet_usd)}</b></dd></div>
        <div><dt>Organization wallet</dt><dd class="mono">${esc(data.destination_address || "Not set")}</dd></div>
      </dl>

      <form id="w-form" class="panel" style="margin-bottom:18px" novalidate>
        <h3 style="font-size:1.05rem;margin-bottom:10px">Request payout / disbursement</h3>
        <div data-summary class="err-summary"></div>
        <div class="two">
          <div class="field"><label for="w-amt">Amount (USD)</label><input class="input" id="w-amt" type="number" step="any" min="1" max="${data.available_testnet_usd}" value="${Math.min(data.available_testnet_usd, 500) || 1}" required></div>
          <div class="field"><label for="w-addr">TRON recipient address</label><input class="input mono" id="w-addr" value="${esc(data.destination_address || "")}" placeholder="T..." required></div>
        </div>
        <div class="field"><label for="w-notes">Justification, vendor &amp; invoice reference</label><input class="input" id="w-notes" placeholder="Batch 1: 500 item tags · Vendor: CKS Print (Quote #INV-104)" required></div>
        <button class="btn block" id="w-go" type="submit" ${data.available_testnet_usd <= 0 ? "disabled" : ""}>Submit withdrawal request</button>
      </form>

      <h3 style="font-size:1.05rem;margin-bottom:10px">Withdrawal request history</h3>
      ${data.withdrawals && data.withdrawals.length ? `
        <div class="rows" style="max-height:200px;overflow-y:auto">${data.withdrawals.map((w) => `
          <div><span><b>${formatUsdt(w.amount_usd)}</b> · <span class="mono">${esc(w.destination_address.slice(0, 10))}...</span><br><span class="sub">${esc(w.notes || "No notes")} · ${statusTag(w.status)}</span></span>
          <span class="sub">${fmtDate(w.requested_at)}<br>${w.tx_hash ? `<a class="mono" href="https://nile.tronscan.org/#/transaction/${esc(w.tx_hash)}" target="_blank" rel="noopener">Nile Tx</a>` : ""}</span></div>
        `).join("")}</div>
      ` : `<p class="muted">No withdrawal requests filed for this campaign yet.</p>`}
    `;

    const form = $("#w-form", d);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const amt = +$("#w-amt", d).value;
      const addr = $("#w-addr", d).value.trim();
      const notes = $("#w-notes", d).value.trim();
      if (!addr || !notes || !(amt > 0)) {
        toast("Please provide an amount, address, and notes", "bad");
        return;
      }
      const btn = $("#w-go", d);
      busy(btn, true, "Submitting…");
      const res = await api("/api/campaigns/withdraw", {
        method: "POST",
        body: { campaign_id: campaignId, amount_usd: amt, destination_address: addr, notes },
      });
      busy(btn, false);
      if (!res.ok) {
        toast(res.data.error || "Withdrawal request failed", "bad");
        return;
      }
      toast("Withdrawal request submitted");
      closeModal();
    });
  };
  drawContent();
}

/* ---------- backer history ---------- */
export async function donor(main, ctx) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in to see your saved contribution records.", "/donor");
  loading(main, "Loading your contributions");
  const r = await api("/api/donor/history");
  if (ctx.isStale()) return;
  if (!r.ok) { offline(main, r.data.error); return "My contributions"; }
  const list = r.data.donations || [];
  const total = list.reduce((s, x) => s + x.amount_usd, 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("My records", `Saved contribution records for ${esc(u.name.split(" ")[0])}.`)}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto"><div><b>${list.length}</b><span>records</span></div><div><b>${usd(total)}</b><span>recorded value · not paid</span></div><div><b>${new Set(list.map((x) => x.campaign_id)).size}</b><span>campaigns</span></div></div>
    <section class="panel" style="max-width:760px;margin:0 auto" aria-labelledby="h-h">
      <div class="panel-head"><h2 id="h-h">Saved contribution records</h2></div>
      ${list.length ? `<div class="rows">${list.map((x) => `<div><span>${esc(x.campaign_title)}<span class="sub">${esc(CHANNEL_LABEL[x.channel] || x.channel)} · <span class="mono">${esc(x.ref)}</span> · ${fmtDate(x.created_at)}</span></span><span class="amt">${x.currency === "USD" ? usd(x.amount_usd) : ngn(x.amount_ngn)}<br><button class="link-btn" data-ref="${esc(x.ref)}" aria-label="View record ${esc(x.ref)}">View record</button></span></div>`).join("")}</div>`
        : empty("receipt", "No records yet", "No account-linked contributions yet. Testnet records are public but are not associated with a UniFund account.", `<a class="btn" href="/campaigns">Browse campaigns</a>`, 2)}
    </section>
  </div></div>`;
  main.addEventListener("click", (e) => { const b = e.target.closest("[data-ref]"); if (b) showReceipt(list.find((x) => x.ref === b.dataset.ref)); });
  return "My contributions";
}

/* ---------- audit panel ---------- */
export async function admin(main, ctx) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in with an audit committee account.", "/admin");
  if (u.role !== "admin") {
    gate(main, { title: "Audit committee only", text: "This area is for the audit committee.", actions: `<a class="btn" href="${roleHome(u)}">Back to my account</a>` });
    return "Audit panel";
  }

  loading(main, "Loading review queue");
  const [p, a, w] = await Promise.all([
    api("/api/campaigns?status=pending"),
    api("/api/campaigns?status=all"),
    api("/api/admin/withdrawals"),
  ]);
  if (ctx.isStale()) return;
  if (!p.ok || !a.ok) { offline(main, (p.data || a.data).error); return "Audit panel"; }
  let pending = p.data.campaigns || [];
  const all = a.data.campaigns || [];
  let withdrawals = w.ok ? w.data.withdrawals || [] : [];
  main.innerHTML = `
  <div class="page"><div class="wrap" style="max-width:860px">
    ${pageHead("Audit panel", "Review campaigns before they reach the public directory")}
    <h2 style="font-size:1.25rem;margin-bottom:16px" id="q-h">Waiting for review (<span id="q-n">${pending.length}</span>)</h2>
    <div id="queue" aria-labelledby="q-h"></div>

    <h2 style="font-size:1.25rem;margin:48px 0 16px" id="w-h">Treasury disbursement requests (<span id="w-n">${withdrawals.length}</span>)</h2>
    <div id="w-queue" aria-labelledby="w-h"></div>

    <h2 style="font-size:1.25rem;margin:48px 0 16px">All campaigns</h2>
    <div class="tbl-wrap" tabindex="0" role="region" aria-label="All campaigns, scrollable"><table class="resp"><caption class="sr">All campaigns</caption>
      <thead><tr><th scope="col">Campaign</th><th scope="col">Group</th><th scope="col">Goal</th><th scope="col">Status</th></tr></thead>
      <tbody>${all.map((c) => `<tr><td data-label="Campaign"><a href="/c/${c.id}">${esc(c.title)}</a></td><td data-label="Group">${esc(c.org)} · ${esc(c.campus)}</td><td data-label="Goal">${usd(c.goal_usd)}</td><td data-label="Status">${statusTag(c.status)}</td></tr>`).join("")}</tbody></table></div>
  </div></div>`;
  const q = $("#queue");
  const wq = $("#w-queue");

  const drawWithdrawals = () => {
    $("#w-n").textContent = withdrawals.length;
    wq.innerHTML = withdrawals.length ? withdrawals.map((item) => `
      <article class="panel" data-wid="${item.id}" style="margin-bottom:16px">
        <div class="panel-head" style="align-items:flex-start"><div><h3>${esc(item.campaign_title)}</h3><p class="muted" style="font-size:.875rem;margin-top:4px">${esc(item.organization)} · Destination: <span class="mono">${esc(item.destination_address)}</span></p></div>${statusTag(item.status)}</div>
        <dl class="kv" style="margin-bottom:12px"><div><dt>Amount requested</dt><dd><b>${formatUsdt(item.amount_usd)}</b> (${ngn(item.amount_ngn)})</dd></div><div><dt>Justification</dt><dd>${esc(item.notes || "None provided")}</dd></div><div><dt>Audit hash</dt><dd class="mono" style="font-size:.75rem">${esc(item.receipt_hash.slice(0, 24))}...</dd></div></dl>
        ${item.status === "requested" ? `
          <div class="two" style="gap:10px">
            <button class="btn danger sec" data-wact="reject" data-wid="${item.id}">${icon("circle-x")}Decline payout</button>
            <button class="btn" data-wact="approve" data-wid="${item.id}">${icon("circle-check")}Dual-approve payout</button>
          </div>
        ` : item.status === "approved" ? `
          <div class="field"><label for="tx${item.id}">Nile Transaction Hash (optional on-chain settlement confirmation)</label><input class="input mono" id="tx${item.id}" placeholder="0x... or 64 hex characters"></div>
          <button class="btn block" data-wact="complete" data-wid="${item.id}">Mark disbursed / verified</button>
        ` : `<p class="muted" style="font-size:.875rem">Completed · ${item.tx_hash ? `<a class="mono" href="https://nile.tronscan.org/#/transaction/${esc(item.tx_hash)}" target="_blank" rel="noopener">TronScan</a>` : "Settled off-chain"}</p>`}
      </article>
    `).join("") : empty("wallet", "No disbursement requests", "Treasury payout requests filed by student organizations will appear here for audit signoff.", "", 2);
  };
  drawWithdrawals();

  wq.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-wact]");
    if (!b) return;
    const wid = +b.dataset.wid;
    const action = b.dataset.wact;
    const txInput = $("#tx" + wid);
    const txId = txInput ? txInput.value.trim() : null;
    busy(b, true, "Processing…");
    const r = await api(`/api/admin/withdrawals/${wid}/review`, {
      method: "POST",
      body: { action, tx_id: txId, notes: `Reviewed by audit admin (${action})` },
    });
    busy(b, false);
    if (!r.ok) {
      toast(r.data.error || "Review update failed", "bad");
      return;
    }
    const idx = withdrawals.findIndex((x) => x.id === wid);
    if (idx !== -1) {
      withdrawals[idx].status = r.data.status;
      withdrawals[idx].tx_hash = r.data.tx_hash;
    }
    drawWithdrawals();
    toast(`Disbursement ${action}d`);
  });
  const drawQueue = () => {
    $("#q-n").textContent = pending.length;
    q.innerHTML = pending.length ? pending.map((c) => `
      <article class="panel" data-id="${c.id}" aria-labelledby="t${c.id}">
        <div class="panel-head" style="align-items:flex-start"><div><h3 id="t${c.id}">${esc(c.title)}</h3><p class="muted" style="font-size:.875rem;margin-top:4px">${esc(c.org)} · ${esc(c.campus)} · ${esc(CATS[c.category] || c.category)}</p></div>${statusTag("pending")}</div>
        <dl class="kv" style="margin-bottom:16px"><div><dt>Goal</dt><dd>${usd(c.goal_usd)} (${ngn(c.goal_ngn)})</dd></div><div><dt>Duration</dt><dd>${c.days} days</dd></div><div><dt>Payments</dt><dd>Not connected</dd></div></dl>
        <p class="muted" style="white-space:pre-line;margin-bottom:16px">${esc(c.about)}</p>
        ${c.budget_breakdown ? `<div style="margin-bottom:16px">${budget(c.budget_breakdown)}</div>` : ""}
        <div class="field"><label for="n${c.id}">Note to the organizers <span class="opt">(required to decline)</span></label><input class="input" id="n${c.id}" maxlength="200" placeholder="Add a review note"></div>
        <div class="two"><button class="btn danger sec" data-act="reject" data-id="${c.id}">${icon("circle-x")}Decline</button><button class="btn" data-act="approve" data-id="${c.id}">${icon("circle-check")}Approve</button></div>
      </article>`).join("")
      : empty("circle-check", "The queue is clear", "New campaigns waiting for review will show up here.", "", 2);
  };
  drawQueue();
  q.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = +b.dataset.id, action = b.dataset.act;
    const note = $("#n" + id);
    if (action === "reject" && !note.value.trim()) { setFieldError(note, "Add a short note so the organizers know why"); note.focus(); return; }
    setFieldError(note, "");
    busy(b, true, action === "approve" ? "Approving…" : "Declining…");
    const r = await api(`/api/admin/campaigns/${id}/review`, { method: "POST", body: { action, notes: note.value.trim() } });
    if (!r.ok) { busy(b, false); toast(r.data.error || "That did not work", "bad"); return; }
    const c = pending.find((x) => x.id === id);
    pending = pending.filter((x) => x.id !== id);
    state.campaigns = null;
    drawQueue();
    toast(`${c ? c.title : "Campaign"} ${action === "approve" ? "approved" : "declined"}`);
    announce(`Campaign ${action === "approve" ? "approved" : "declined"}. ${pending.length} waiting.`);
  });
  return "Audit panel";
}

export function deleteAccount() {
  if (!state.user || state.user.role === "admin") return;

  const dlg = openModal(`
    <p class="lede">This permanently removes your account, your campaigns and their spending reports, and related test contribution records. These records are not payments. This cannot be undone.</p>
    <form id="delete-account-form" novalidate>
      <div data-summary class="err-summary"></div>
      <div class="field">
        <label for="delete-account-password">Your current password</label>
        <input class="input" id="delete-account-password" type="password" autocomplete="current-password" maxlength="128">
      </div>
      <div class="modal-foot">
        <button class="btn sec" type="button" data-cancel>Keep my account</button>
        <button class="btn danger" id="delete-account-submit" type="submit">Delete my account</button>
      </div>
    </form>`, { label: "Delete your account", focus: "#delete-account-password" });
  const form = $("#delete-account-form", dlg);
  $("[data-cancel]", dlg).addEventListener("click", () => closeModal());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validate(form, {
      "delete-account-password": (_value, input) => input.value.length ? "" : "Enter your current password",
    }, "[data-summary]")) return;

    const submit = $("#delete-account-submit", dlg);
    busy(submit, true, "Deleting account…");
    const result = await api("/api/account/delete", {
      method: "POST",
      body: { password: $("#delete-account-password", dlg).value },
    });
    busy(submit, false);
    if (!result.ok) return serverError(form, result.data.error || "We could not delete your account. Please try again.");

    closeModal();
    token.clear();
    state.user = null;
    state.campaigns = null;
    state.ledger = null;
    dispatchEvent(new Event("uf:auth"));
    toast("Your account and records were deleted");
    navigate("/");
  });
}
