# UniFund · Hackathon pitch

**Cleva x Tether Future of Payments Hackathon · UNIUYO Edition**

## Product overview

Student project teams need a credible way to explain what they are building, what it will cost, and how they used support. UniFund brings the campaign request, committee review, and public spending updates into one workflow. Its optional Nile testnet flow supports test-USDT transfer and receipt verification; the team has not yet completed a real end-to-end Nile transfer, and Cleva and real-value payments are not connected.

## What is different

UniFund is not just a campaign page with a donate button. It is designed around the full accountability loop:

**A student group proposes a project → a committee reviews it → supporters can follow spending updates.**

The request-review-spending workflow is demonstrable today. Validation of the funding problem and review process with student organizations, committees, and supporters remains future work.

## Demonstration workflow

1. A student organization submits a project, goal, and budget.
2. An audit committee account reviews the campaign.
3. The organizer publishes a spending report.
4. If Nile mode is configured, the optional flow can verify a test-USDT transfer; otherwise, the payment interface remains a preview.

Sample totals and simulated entries are illustrative. Database hashes and payment previews are not evidence of real money, verified identity, or blockchain settlement.

## Payment thesis and current boundary

- **Tether USDT (TRC-20):** the proposed cross-border route. The optional Nile testnet flow uses TronLink and records a contribution only after the server verifies a solidified receipt and matching `Transfer` event.
- **Cleva USD and naira:** proposed local payment paths. A real flow would need provider checkout, verified server-side callbacks, reconciliation, and clear refunds/disputes.
- **USSD:** a low-data access concept only; the current code preview is not a valid payment instruction.

No real-value payment provider, mainnet payment, Cleva API, KYC, fund custody, or withdrawal is implemented. Automated receipt-verification tests use mocked responses. Real-value assets are not supported. The testnet demo uses one shared receiver; the campaign association is recorded by UniFund rather than encoded by a campaign contract, so this is not a production funding design.

## Problem, rationale, and limits

**Problem validation:** UniFund explores whether campus groups and supporters benefit from keeping project requests, review decisions, and spending updates together. The problem and impact have not yet been measured.

**Stablecoin rationale:** Stablecoins are a proposed route for diaspora backers to send dollar-denominated support across borders. The prototype does not establish lower cost, faster settlement, or successful real-value payments.

**Trust and misuse:** The prototype provides a committee-review workflow and public spending reports. It does not independently verify campus affiliation, guarantee report accuracy, or control funds.

**Launch requirements:** A real service would require user validation, a licensed payment partner, verified payment events, fund custody and disbursement rules, refunds and disputes, privacy and legal review, and operational safeguards.

## Next milestones

1. User research with student groups, committee members, and local and diaspora supporters to validate required information and review steps.
2. A streamlined campaign submission that gives reviewers enough information without collecting unverified sensitive data.
3. A complete TronLink-to-Nile test transaction, including wrong-network, pending, failed, wrong-amount, and duplicate cases.
4. A production campaign-attribution and custody design, plus documented disbursement, refunds, disputes, data retention, security operations, and legal responsibilities before any real funds are handled.

## Architecture

```text
[Browser] -> [UniFund frontend] -> [Vercel API] -> [Neon PostgreSQL]
                 |
                 +-> TronLink -> TRON Nile testnet; solidified receipt checked by API
```

Local development uses SQLite. The hosted database schema is isolated as `unifund` inside Neon.

## Grand Finale presentation plan

### Timing

Use exactly this 17-minute allocation:

| Time | Section | Presenter |
|---|---|---|
| 0:00-1:30 | Problem and why it matters | Lead / story |
| 1:30-3:30 | UniFund and the accountability loop | Product lead |
| 3:30-8:30 | Live MVP demo | Demo lead |
| 8:30-10:30 | Payment direction and verified MVP boundary | Technical lead |
| 10:30-12:00 | Vision, impact, and next milestones | Lead |
| 12:00-17:00 | Judge and audience questions | All panel members |

Rehearse to finish the first section by 11:30. The stage clock stops at 12:00, and the remaining 5 minutes are for questions.

### Live demo sequence

1. Open the campaigns directory and show one concrete UNIUYO-area campaign.
2. Sign in with the student organization demo account.
3. Submit a short campaign for committee review with the organization's TRON destination wallet address.
4. Switch to the audit committee account and approve the campaign.
5. Demonstrate backer contribution (on Nile testnet with TronLink if available, or simulated preview).
6. Show the public ledger with **SHA-256 Hash-Chain Verification** (live cryptographic audit check).
7. Return as the student organization to the Dashboard: open **Treasury / Payout**, show reserved vs available testnet funds, and submit a withdrawal request.
8. Switch back to the audit committee to demonstrate **Dual-Approval Payout Authorization**, approving and completing the disbursement to the student organization's treasury address.
9. Open the approved campaign and add a verifiable item to the public spending log with invoice references.

Use the prepared accounts and a campaign title that already fits in the screen. Do not type a real wallet key, PIN, bank detail, or sensitive student information during the demo.

### Exactly what to claim

Say that UniFund today provides:

- Campaign creation and committee review.
- Dual-custody treasury management and organization payout requests.
- Audit committee payout dual-approval release workflow.
- SHA-256 chained cryptographic ledger audit verification.
- Public spending reports and invoice logging.
- Account and session controls.
- Public, privacy-filtered records.
- Optional TRON Nile testnet verification of matching solidified backer contributions and treasury payouts.

Do not claim that UniFund has already:

- Connected Cleva or mainnet USDT.
- Verified university affiliation through registrar databases.
- Custodied or withdrawn real fiat or mainnet cryptocurrencies (testnet tokens have zero economic value).
- Proven market demand, lower fees, or improved outcomes through broad user research.

These limits make the prototype credible and show that the team understands the difference between an MVP and production financial infrastructure.

These limits make the prototype credible and show that the team understands the difference between an MVP and production financial infrastructure.

### Final-stage backup plan

Prepare all of the following before leaving for the venue:

- A PDF copy of the deck.
- A 4G hotspot or alternative internet connection.
- Laptop and phone charging equipment.
- A local build run from `python3 server.py`.
- Screenshots or a short offline recording of the Nile testnet and review workflow.
- A shared final presentation link and team contact details.
- All team members' names, roles, and account eligibility documents ready for verification.

If the hosted site or wallet is unavailable, continue with the local app and screenshots. Never use a network failure to imply that a real payment succeeded.

### Submission checklist for Friday, November 27

Complete the Google submission form before 12:00 PM WAT:

- PDF or PowerPoint deck.
- Working hosted demo link.
- Nile testnet demo link or a wallet-free demo link if testnet is not enabled.
- Short demo instructions.
- Contact name and all team member names.
- Optional QR code, testnet transaction link, and public ledger link.

RSVP and invite attendees using the Luma link in the organizer email.

### Priority improvements before the finale

1. Pre-seed one polished campaign that is visually strong and central to the live story.
2. Pre-record a 20-30 second fallback clip for the Nile testnet or any network-dependent step.
3. Add a visible QR code to the deck and campaign page for judge access after the presentation.
4. Print or export a single-page one-line summary of the problem, solution, MVP, and launch boundary.
5. Rehearse account switching and spending-report entry; reduce typing by preparing sample text.
6. Verify the hosted deployment, `/api/health`, admin account, and test campaign 30 minutes before the team goes on stage.

### Stage-day success criteria

The presentation is successful if every judge can answer four questions:

1. What problem does UniFund solve?
2. How does the approval-and-spending workflow work?
3. What is demonstrably implemented versus only planned?
4. What would be required to handle real funds safely?
