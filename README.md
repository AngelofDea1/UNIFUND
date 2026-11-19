# UniFund

A prototype that shows how Nigerian university groups could request project support and report spending.

Developed for the Cleva x Tether Future of Payments Hackathon (UNIUYO Edition).

**Payment status:** The payment screen is an explanatory walkthrough only. It does not open a wallet, start a payment, or save a contribution. Cleva, live USDT verification, KYC, and withdrawals are not connected.

## Overview

Student teams can struggle to get project funding and show how it was used. UniFund explores a campaign-review process, possible payment routes, and a public spending record. This app demonstrates the workflow; it does not currently move money.

UniFund explores this with a prototype that includes:
1. **Campaign review workflow**: Student groups submit campus and project details for audit committee review. The prototype does not independently verify identity.
2. **Planned payment routes**:
   - **Tether USDT (TRC-20)** for cross-border support; live transaction verification is not connected.
   - **Cleva USD and Naira** for local payments; Cleva is not connected.
   - **USSD preview**; no bank or telecom payment is initiated.
3. **Public activity record**: The database may contain sample entries and older simulated test records, as well as campaign expense reports. The hosted payment walkthrough does not create contribution records. SHA-256 references are database labels, not blockchain proofs or tamper-proof seals.

## Accounts and data deletion

Backer and student organization accounts can be deleted from the account menu after the user re-enters their password. Deletion removes the account and its sessions, campaigns created by that account, those campaigns' spending reports, and simulated contribution records tied to the account or its campaigns. Audit administrator accounts must be removed by the project operator. Anonymous test receipts are not connected to an account and are not removed by account deletion.

This deletion flow is for prototype data only. It is not a retention policy for real payments. The Terms and Privacy pages remain drafts until the project publishes a privacy contact, selects a governing jurisdiction, and gets legal review.

## System Architecture

- **Frontend**: Standard JavaScript ES modules, custom CSS, HTML5 canvas background. No frontend build toolchain or framework.
- **Local backend**: Python standard library HTTP service (`server.py`).
- **Vercel backend**: FastAPI adapter (`vercel_app.py`) routed to Vercel Python Functions.
- **Local database**: SQLite3 (`unifund.db`).
- **Hosted database**: PostgreSQL through Neon, configured with the `DATABASE_URL` environment variable.
- **Typography**: Bricolage Grotesque for headings, Hanken Grotesk for body text, and JetBrains Mono for references.

## Getting Started

### Prerequisites

- Python 3.8 or newer
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Run locally

1. Clone the repository:
   ```bash
   git clone https://github.com/AngelofDea1/UNIFUND.git
   cd UNIFUND
   ```

2. Start the application:
   ```bash
   python3 server.py
   ```

3. Open the web interface:
   Navigate to `http://localhost:3001` in your browser. The app creates and seeds `unifund.db` on first run; the local database is ignored by Git.

Routes use clean paths such as `/campaigns`, `/c/1`, and `/signin`. The hosted app and local server return the app shell for these paths so they also work when opened directly.

Environment configuration:
- `PORT`: Server port (default: `3001`).
- `DATABASE_PATH`: Custom SQLite file path (default: `unifund.db`).
- `PAYMENTS_MODE`: local API mode, `sandbox` by default or `disabled`. Vercel always disables sandbox payment endpoints.

### Deploy on Vercel with Neon

The public Vercel site needs both the frontend and an API backend. A database by itself does not provide sign-in or campaign API routes.

1. In Vercel, open the UniFund project and add Neon from the Vercel Marketplace.
2. Connect the Neon project to this Vercel project. Confirm that `DATABASE_URL` is available to the deployment.
3. Add these environment variables in Vercel Project Settings. Keep passwords private; do not commit them:
   - `BOOTSTRAP_ADMIN_EMAIL`: email for the first audit administrator.
   - `BOOTSTRAP_ADMIN_PASSWORD`: a new, strong password for that administrator.
4. Redeploy the project.
5. Open `/api/health` on the deployed site. The API should return `status: ok` and `database: connected`.

The first request creates UniFund's tables in a dedicated `unifund` schema and creates the configured administrator. This keeps UniFund's tables separate from other apps sharing the Neon database. Local demo accounts are not automatically copied into Neon.

Neon stores the hosted data independently from your computer; you do not need to keep your laptop online. On a free plan, an idle database may scale down and take longer to answer its next request. Health checks confirm that the API can query the database, not that it has production-grade uptime, backups, or payment processing.

To load the sample campaigns and sample ledger into a hosted database with no campaigns, set:

- `SEED_DEMO_DATA=true`

Then redeploy. Existing admin accounts are preserved. On a completely fresh database with no users, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` before the first request, whether or not sample data is enabled. Sample student and donor accounts are only created on a completely fresh database and receive random passwords; the public local demo passwords will not work there. Seeding runs only when the campaigns table is empty.

The website's payment popup is a walkthrough preview; it does not create a contribution record. Local sandbox API endpoints can create clearly marked simulated records for development and tests. Vercel disables those endpoints even if `PAYMENTS_MODE=sandbox` is set. No setting connects a real payment provider.

## Local demo accounts

The following accounts are for local testing only. Do not use these passwords on the public deployment.

The local database contains pre-configured credentials for testing each system role:

| Role | Email | Password | Scope |
|---|---|---|---|
| Campus Audit Committee | `admin@unifund.org` | `admin123` | Campaign review and approval |
| UNIUYO Student Organization | `robotics@uniuyo.edu.ng` | `student123` | Campaign creation and expense logging |
| Diaspora Backer | `donor@alumni.org` | `donor123` | Demo contribution history |

## Hackathon Details

- **Event**: Cleva x Tether Future of Payments Hackathon (UNIUYO Edition)
- **Track**: Stablecoins, Cross-Border Remittances, and Financial Infrastructure
- **Referral Code**: `UNIUYO`
- **Submission Date**: November 2026

## Tests

Run the backend and deployment-adapter tests:

```bash
python3 -m unittest tests.test_server tests.test_vercel_api
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for terms.
