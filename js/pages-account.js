// Account pages: sign in, sign up, start a campaign, organization dashboard, backer history, audit panel
import {
  $, $$, state, esc, icon, api, token, usd, ngn, pct, toast, announce, busy, validate, serverError, setFieldError,
  progressBar, statusTag, CATS, CHANNEL_LABEL, ROLE_LABEL, DEMO, openModal, closeModal,
} from "./core.js";
import { loading, offline, pageHead, empty } from "./components.js";
import { showReceipt, fmtDate, budget } from "./pages-campaign.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const roleHome = (u) => (u.role === "admin" ? "#/admin" : u.role === "student_org" ? "#/dashboard" : "#/donor");

function setSession(data) {
  token.set(data.token);
  state.user = data.user;
  dispatchEvent(new Event("uf:auth"));
}

function pwField(id, label, autocomplete, hint) {
  return `<div class="field"><label for="${id}">${label}</label>
    <div class="pw"><input class="input" id="${id}" type="password" autocomplete="${autocomplete}" ${hint ? `aria-describedby="${id}-h"` : ""}>
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
  gate(main, { title: "Sign in to continue", text: why, actions: `<a class="btn" href="#/signin?next=${encodeURIComponent(next)}">Sign in</a><a class="btn sec" href="#/signup">Create an account</a>` });
  return "Sign in to continue";
};

/* ---------- sign in ---------- */
export function signin(main, ctx) {
  if (state.user) {
    gate(main, { title: `You are signed in`, text: `Signed in as ${esc(state.user.name)}.`, actions: `<a class="btn" href="${roleHome(state.user)}">Go to my account</a><a class="btn sec" href="#/campaigns">Browse campaigns</a>` });
    return "Sign in";
  }
  const next = ctx.query.get("next");
  main.innerHTML = `
  <div class="page"><div class="form-w">
    ${pageHead("Sign in to UniFund", "Welcome back.<br>Manage your student campaigns or view your receipt history.")}
    <form class="panel" id="si-form" novalidate>
      <div data-summary class="err-summary"></div>
      <div class="field"><label for="si-email">Email address</label><input class="input" id="si-email" type="email" autocomplete="email" inputmode="email"></div>
      ${pwField("si-pw", "Password", "current-password")}
      <button class="btn lg block" id="si-go" type="submit">Sign in</button>
    </form>
    <p class="form-foot">New to UniFund? <a href="#/signup">Create an account</a></p>
    ${DEMO ? `<details class="panel" style="margin-top:20px;padding:20px"><summary style="cursor:pointer;font-weight:600">Demo accounts (test mode)</summary>
      <div class="rows" style="margin-top:14px">
        ${[["Audit committee", "admin@unifund.org", "admin123"], ["UNIUYO Student Org", "robotics@uniuyo.edu.ng", "student123"], ["Backer (Diaspora)", "donor@alumni.org", "donor123"]].map(([l, e, p]) => `<div><span>${l}<span class="sub mono">${e}</span></span><button type="button" class="btn sm sec" data-fill="${e}|${p}">Fill in</button></div>`).join("")}
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
    location.hash = next && next.startsWith("/") ? "#" + next : roleHome(r.data.user);
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
  <div class="page"><div class="form-w" style="max-width:600px">
    ${pageHead("Create your Account", "Choose how you would like to participate in the UniFund prototype.<br>Explore sample campaigns or try the organization workflow.")}
    <form class="panel" id="su-form" novalidate>
      <div data-summary class="err-summary"></div>
      <fieldset><legend class="legend">I am signing up as</legend>
        <div class="choices">
          <label class="choice"><input type="radio" name="role" value="student_org" checked><span><b>A student organization</b><span>Start campaigns and log expenses. The audit committee reviews your group</span></span></label>
          <label class="choice"><input type="radio" name="role" value="donor"><span><b>A backer</b><span>Contribute and keep a history of your receipts</span></span></label>
        </div>
      </fieldset>
      <div class="field"><label for="su-name">Your full name</label><input class="input" id="su-name" autocomplete="name" maxlength="80"></div>
      <div class="field"><label for="su-email">Email address</label><input class="input" id="su-email" type="email" autocomplete="email" inputmode="email"></div>
      <div id="org-fields">
        <div class="field"><label for="su-org">Organization name</label><input class="input" id="su-org" autocomplete="organization" maxlength="80" placeholder="Robotics and Embedded Systems Society"></div>
        <div class="two">
          <div class="field"><label for="su-campus">Campus code</label><input class="input" id="su-campus" maxlength="12" autocapitalize="characters" placeholder="UNILAG" aria-describedby="su-campus-h"><span class="hint" id="su-campus-h">Your university's short name</span></div>
          <div class="field"><label for="su-matric">Matric number</label><input class="input" id="su-matric" maxlength="30" placeholder="ENG/20/4819" autocomplete="off"></div>
        </div>
      </div>
      ${pwField("su-pw", "Password", "new-password", "At least 8 characters. A longer phrase is stronger")}
      <div class="strength" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="field" style="margin-top:20px"><div class="check"><input type="checkbox" id="su-terms" aria-describedby="su-terms-err"><label for="su-terms" style="font-weight:400;margin:0">I agree to the <a href="#/terms" target="_blank" rel="noopener">terms</a> and <a href="#/privacy" target="_blank" rel="noopener">privacy policy</a></label></div><div class="err" id="su-terms-err"></div></div>
      <button class="btn lg block" id="su-go" type="submit">Create account</button>
    </form>
    <p class="form-foot">Already have an account? <a href="#/signin">Sign in</a></p>
  </div></div>`;
  wirePw(main);
  const form = $("#su-form");
  const isOrg = () => form.elements.role.value === "student_org";
  const sync = () => { $("#org-fields").hidden = !isOrg(); };
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
      "su-matric": (v) => (v.length < 4 ? "Enter your matric number" : ""),
    });
    // order the rules by their position on the page so focus goes to the first problem
    const order = ["su-name", "su-email", "su-org", "su-campus", "su-matric", "su-pw", "su-terms"];
    const sorted = Object.fromEntries(order.filter((k) => rules[k]).map((k) => [k, rules[k]]));
    if (!isOrg()) ["su-org", "su-campus", "su-matric"].forEach((k) => setFieldError($("#" + k), ""));
    if (!validate(form, sorted, "[data-summary]")) return;
    const btn = $("#su-go");
    busy(btn, true, "Creating account…");
    const role = form.elements.role.value;
    const r = await api("/api/auth/register", { method: "POST", auth: false, body: {
      name: $("#su-name").value.trim(), email: $("#su-email").value.trim(), password: $("#su-pw").value, role,
      org_name: isOrg() ? $("#su-org").value.trim() : "", campus: isOrg() ? $("#su-campus").value.trim() : "", matric_number: isOrg() ? $("#su-matric").value.trim() : "" } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not create your account.");
    setSession(r.data);
    main.innerHTML = `<div class="page"><div class="narrow"><div class="panel center">${icon("circle-check")}<h1 style="font-size:1.75rem;margin:14px 0 10px">Welcome, ${esc(r.data.user.name.split(" ")[0])}</h1>
      <p class="muted">${role === "student_org" ? "Your account is ready. You can draft a campaign for the demo committee-review workflow." : "Your account is ready. Browse sample campaigns and try the sandbox receipt flow."}</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px">${role === "student_org" ? `<a class="btn lg" href="#/start">Start a campaign</a><a class="btn sec lg" href="#/dashboard">Go to dashboard</a>` : `<a class="btn lg" href="#/campaigns">Browse campaigns</a>`}</div></div></div></div>`;
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
    gate(main, { title: "Organization accounts only", text: "Backer accounts cannot start campaigns. Create a student organization account to raise funds.", actions: `<a class="btn" href="#/donor">My contributions</a><a class="btn sec" href="#/signup">Create an organization account</a>` });
    return "Start a campaign";
  }
  main.innerHTML = `
  <div class="page"><div class="form-w" style="max-width:640px">
    ${pageHead("Start a Campaign", "Tell backers what you are building and what it costs.<br>Submit your campaign for committee audit and transparent milestone tracking.")}
    <div class="notice">${icon("shield-check")}<div>${u.role === "admin" ? "Campaigns you create as the audit committee go live straight away." : `Posting as <b>${esc(u.org_name || u.name)}</b>. The audit committee reviews your campaign before it appears in the directory.`}</div></div>
    <form class="panel" id="cp-form" novalidate>
      <div data-summary class="err-summary"></div>
      <h2 style="font-size:1.125rem;margin-bottom:18px">The basics</h2>
      <div class="field"><label for="cp-title">Campaign title</label><input class="input" id="cp-title" maxlength="90" aria-describedby="cp-title-h" placeholder="Portable solar storage unit"><span class="hint" id="cp-title-h"><span id="cp-title-n">0</span> of 90 characters, at least 5</span></div>
      <div class="two">
        <div class="field"><label for="cp-cat">Category</label><select class="input" id="cp-cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div class="field"><label for="cp-days">Days to run</label><input class="input" id="cp-days" type="number" min="1" max="90" value="30" aria-describedby="cp-days-h"><span class="hint" id="cp-days-h">Between 1 and 90</span></div>
      </div>
      <h2 style="font-size:1.125rem;margin:28px 0 18px">The money</h2>
      <div class="two">
        <div class="field"><label for="cp-goal">Goal in USD</label><input class="input" id="cp-goal" type="number" min="50" step="any" value="1200" aria-describedby="cp-goal-h"><span class="hint" id="cp-goal-h">Minimum $50. About <b id="cp-ngn">${ngn(1200 * state.rate)}</b></span></div>
        <div class="field"><label>Payment integration</label><p class="hint">Cleva and USDT settlement are not connected in this prototype. Do not send funds.</p></div>
      </div>
      <h2 style="font-size:1.125rem;margin:28px 0 18px">The story</h2>
      <div class="field"><label for="cp-about">What are you building, and who benefits</label><textarea class="input" id="cp-about" rows="5" aria-describedby="cp-about-h" placeholder="Describe the goal, the students it helps and your timeline"></textarea><span class="hint" id="cp-about-h"><span id="cp-about-n">0</span> characters, at least 20</span></div>
      <div class="field"><label for="cp-budget">Budget breakdown <span class="opt">(optional)</span></label><textarea class="input mono" id="cp-budget" rows="4" aria-describedby="cp-budget-h" placeholder="Motors and ESCs: $1,400&#10;Carbon frame: $900"></textarea><span class="hint" id="cp-budget-h">One item per line, written as Item: $amount. We turn it into a table</span></div>
      <button class="btn lg block" id="cp-go" type="submit">${u.role === "admin" ? "Publish campaign" : "Submit for review"}</button>
    </form>
  </div></div>`;
  const form = $("#cp-form");
  $("#cp-title").addEventListener("input", (e) => ($("#cp-title-n").textContent = e.target.value.length));
  $("#cp-about").addEventListener("input", (e) => ($("#cp-about-n").textContent = e.target.value.trim().length));
  $("#cp-goal").addEventListener("input", (e) => ($("#cp-ngn").textContent = ngn((+e.target.value || 0) * state.rate)));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate(form, {
      "cp-title": (v) => (v.length < 5 ? "The title needs at least 5 characters" : v.length > 90 ? "Keep the title under 90 characters" : ""),
      "cp-days": (v) => (!(+v >= 1 && +v <= 90) ? "Choose between 1 and 90 days" : ""),
      "cp-goal": (v) => (!(+v >= 50) ? "The minimum goal is $50" : ""),
      "cp-about": (v) => (v.length < 20 ? "Describe the project in at least 20 characters" : ""),
    }, "[data-summary]")) return;
    const btn = $("#cp-go");
    busy(btn, true, "Submitting…");
    const r = await api("/api/campaigns", { method: "POST", body: {
      title: $("#cp-title").value.trim(), category: $("#cp-cat").value, days: +$("#cp-days").value, goal_usd: +$("#cp-goal").value,
      about: $("#cp-about").value.trim(), budget_breakdown: $("#cp-budget").value.trim() } });
    busy(btn, false);
    if (!r.ok) return serverError(form, r.data.error || "We could not submit your campaign.");
    state.campaigns = null;
    const live = r.data.status === "approved";
    main.innerHTML = `<div class="page"><div class="narrow"><div class="panel center">${icon("circle-check")}<h1 style="font-size:1.75rem;margin:14px 0 10px">${live ? "Your campaign is live" : "Submitted for review"}</h1>
      <p class="muted">${live ? "It now appears in the directory." : "The audit committee will review it. You can follow its status on your dashboard, and it appears in the directory once approved."}</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:24px"><a class="btn lg" href="${live ? "#/c/" + r.data.id : "#/dashboard"}">${live ? "View campaign" : "Go to dashboard"}</a><a class="btn sec lg" href="#/start" onclick="location.reload()">Start another</a></div></div></div></div>`;
    const h = main.querySelector("h1"); h.tabIndex = -1; h.focus();
    announce(live ? "Campaign published" : "Campaign submitted for review");
  });
  return "Start a campaign";
}

/* ---------- organization dashboard ---------- */
export async function dashboard(main, ctx) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in to see your campaigns.", "/dashboard");
  if (u.role === "donor") { location.hash = "#/donor"; return "Dashboard"; }
  loading(main, "Loading your campaigns");
  const r = await api("/api/campaigns?status=mine");
  if (ctx.isStale()) return;
  if (!r.ok) { offline(main, r.data.error); return "Dashboard"; }
  const list = r.data.campaigns || [];
  const raised = list.reduce((s, c) => s + c.raised_usd, 0), backers = list.reduce((s, c) => s + c.backers_count, 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("Organization dashboard", esc(u.org_name || u.name) + (u.campus ? ` · ${esc(u.campus)}` : ""))}
    ${u.role === "student_org" && !u.is_verified ? `<div class="notice warn" style="max-width:760px;margin:0 auto 24px">${icon("clock")}<div><b>Demo review pending.</b> This prototype does not independently verify organization identity. You can draft campaigns for the committee-review flow.</div></div>` : ""}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto"><div><b>${list.length}</b><span>campaigns</span></div><div><b>${usd(raised)}</b><span>raised</span></div><div><b>${backers}</b><span>backers</span></div></div>
    <section class="panel" style="max-width:760px;margin:0 auto" aria-labelledby="my-h">
      <div class="panel-head"><h2 id="my-h">Your campaigns</h2><a class="btn sm" href="#/start">${icon("plus", "sm")}New campaign</a></div>
      ${list.length ? `<div class="rows">${list.map((c) => `<div style="align-items:flex-start;flex-wrap:wrap">
          <span style="flex:1;min-width:220px"><a href="#/c/${c.id}" style="font-weight:650;color:var(--ink)">${esc(c.title)}</a>
            <span class="sub">${statusTag(c.status)} ${c.status === "rejected" && c.approval_notes ? `<span>${esc(c.approval_notes)}</span>` : ""}</span>
            <span class="sub" style="margin-top:10px">${progressBar(c, c.title + " progress")}</span></span>
          <span class="amt">${usd(c.raised_usd)}<span class="sub">of ${usd(c.goal_usd)} · ${c.backers_count} backers</span></span></div>`).join("")}</div>`
        : empty("file-text", "No campaigns yet", "Start your first campaign and share it with your supporters.", `<a class="btn" href="#/start">Start a campaign</a>`)}
    </section>
  </div></div>`;
  return "Organization dashboard";
}

/* ---------- backer history ---------- */
export async function donor(main, ctx) {
  const u = state.user;
  if (!u) return needSignIn(main, "Sign in to see your contributions and receipts.", "/donor");
  loading(main, "Loading your contributions");
  const r = await api("/api/donor/history");
  if (ctx.isStale()) return;
  if (!r.ok) { offline(main, r.data.error); return "My contributions"; }
  const list = r.data.donations || [];
  const total = list.reduce((s, x) => s + x.amount_usd, 0);
  main.innerHTML = `
  <div class="page"><div class="wrap">
    ${pageHead("My contributions", `Receipts for everything you have backed, ${esc(u.name.split(" ")[0])}`)}
    <div class="summary" style="max-width:760px;margin-left:auto;margin-right:auto"><div><b>${list.length}</b><span>contributions</span></div><div><b>${usd(total)}</b><span>given in USD</span></div><div><b>${new Set(list.map((x) => x.campaign_id)).size}</b><span>campaigns backed</span></div></div>
    <section class="panel" style="max-width:760px;margin:0 auto" aria-labelledby="h-h">
      <div class="panel-head"><h2 id="h-h">Receipts</h2></div>
      ${list.length ? `<div class="rows">${list.map((x) => `<div><span>${esc(x.campaign_title)}<span class="sub">${esc(CHANNEL_LABEL[x.channel] || x.channel)} · <span class="mono">${esc(x.ref)}</span> · ${fmtDate(x.created_at)}</span></span><span class="amt">${x.currency === "USD" ? usd(x.amount_usd) : ngn(x.amount_ngn)}<br><button class="link-btn" data-ref="${esc(x.ref)}" aria-label="View receipt ${esc(x.ref)}">Receipt</button></span></div>`).join("")}</div>`
        : empty("receipt", "No contributions yet", "When you back a campaign while signed in, your receipt shows up here.", `<a class="btn" href="#/campaigns">Browse campaigns</a>`)}
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
  const [p, a] = await Promise.all([api("/api/campaigns?status=pending"), api("/api/campaigns?status=all")]);
  if (ctx.isStale()) return;
  if (!p.ok || !a.ok) { offline(main, (p.data || a.data).error); return "Audit panel"; }
  let pending = p.data.campaigns || [];
  const all = a.data.campaigns || [];
  main.innerHTML = `
  <div class="page"><div class="wrap" style="max-width:860px">
    ${pageHead("Audit panel", "Review campaigns before they reach the public directory")}
    <h2 style="font-size:1.25rem;margin-bottom:16px" id="q-h">Waiting for review (<span id="q-n">${pending.length}</span>)</h2>
    <div id="queue" aria-labelledby="q-h"></div>
    <h2 style="font-size:1.25rem;margin:48px 0 16px">All campaigns</h2>
    <div class="tbl-wrap" tabindex="0" role="region" aria-label="All campaigns, scrollable"><table class="resp"><caption class="sr">All campaigns</caption>
      <thead><tr><th scope="col">Campaign</th><th scope="col">Group</th><th scope="col">Goal</th><th scope="col">Status</th></tr></thead>
      <tbody>${all.map((c) => `<tr><td data-label="Campaign"><a href="#/c/${c.id}">${esc(c.title)}</a></td><td data-label="Group">${esc(c.org)} · ${esc(c.campus)}</td><td data-label="Goal">${usd(c.goal_usd)}</td><td data-label="Status">${statusTag(c.status)}</td></tr>`).join("")}</tbody></table></div>
  </div></div>`;
  const q = $("#queue");
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
      : empty("circle-check", "The queue is clear", "New campaigns waiting for review will show up here.");
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
