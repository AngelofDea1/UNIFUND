# UniFund

**The Programmable Treasury & Payment Rails for Campus Micro-Economies.**

UniFund is a payment and treasury infrastructure solution built for the **Cleva × Tether Future of Payments Hackathon (UNIUYO Edition)**. It solves the critical payment bottlenecks faced by student societies, engineering teams, and collaborative groups across African higher institutions.

---

## The Problem

African campuses are thriving innovation hubs with over 30 million students, yet student initiatives face an **Institutional Financial Blockade**:
1. **Cross-Border Inflow Friction**: Diaspora alumni, global mentors, and foreign sponsors face high SWIFT wire fees ($25–$45) and strict FX controls when trying to fund student projects.
2. **The "Lack of Legal Entity" Bottleneck**: Student clubs and research teams are not incorporated corporate entities (CAC), making it impossible to open corporate bank accounts. Funds end up in individual personal accounts, creating single-point-of-failure risks, account freezes, and zero accountability.
3. **Currency Volatility & Inflation**: Hardware projects requiring imported electronics or parts are priced in USD. Local currency devaluation rapidly destroys project purchasing power before milestones can be finished.
4. **The Post-Payment Black Box**: Traditional remittances offer no spending transparency once money leaves the donor's hand.

---

## The UniFund Solution

UniFund introduces an integrated, programmable payment and treasury loop:
- **Tether (USDT on TRON)**: Low-cost, sub-second cross-border settlement rail preserving capital in a stable store of purchasing power.
- **Cleva Integration (Proposed & Sandbox Rails)**: Multi-currency virtual accounts for local Naira on/off-ramps, diaspora USD collection, and bank settlements.
- **Dual-Custody Milestone Escrow**: Group funds sit in a secured treasury. Organizations submit line-item withdrawal requests with expense justifications, which are co-signed and released only upon committee review.
- **Cryptographic SHA-256 Public Ledger**: Every contribution, sandbox settlement, and disbursement request is chained into an unbroken SHA-256 hash sequence verified live on the public ledger.
- **Verified Spending Trail**: Organizations publish itemized vendor expenses with invoice references directly linked to their campaigns.

---

## What Works Today in the Working MVP

- **TRON Nile Testnet USDT Verification**: Backers send test USDT via TronLink directly to the UniFund receiver address. The backend queries official Nile TronGrid RPC, solidifies the receipt, checks contract transfer events, and registers the verified contribution.
- **Organization Treasury & Payout Dashboard**: Organizers configure their TRON payout address, track available vs. reserved funds, and submit withdrawal requests against confirmed testnet receipts.
- **Dual-Approval Governance Engine**: The audit committee reviews withdrawal justifications and co-signs disbursements with optional on-chain Nile transaction verification.
- **Cryptographic SHA-256 Ledger Audit**: A live **"Verify hash chain"** tool audits the entire sequential chain of database audit seals.
- **Cleva Sandbox Inflows**: Backers can walk through a simulated Cleva payment session that returns cryptographic references and logs to the public ledger.
- **Public Spending & Invoice Logs**: Approved campaigns maintain a public, itemized ledger of vendor expenses.
- **Account Controls**: Full registration, session management, and self-service account deletion with cascading record cleanup.

---

## System Architecture

- **Frontend**: Vanilla ES modules with cache-busting versioning, responsive CSS, accessible dialogs, and SVG canvas graphics. Zero external build tooling.
- **Local Backend**: Pure standard-library Python HTTP server (`server.py`).
- **Cloud / Vercel Backend**: FastAPI ASGI adapter (`vercel_app.py` & `app.py`) with PostgreSQL/Neon support.
- **Databases**: SQLite3 for local development; Neon PostgreSQL for production cloud deployment.
- **Test Suite**: 22 automated integration tests verifying authentication, campaign approval, testnet USDT receipt matching, dual-approval payouts, and ledger hash verification.

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

3. Open `http://localhost:3001`. The app creates and seeds `unifund.db` on first run; the local database is ignored by Git.

Routes use clean paths such as `/campaigns`, `/c/1`, and `/signin`. The hosted app and local server return the app shell for these paths so they also work when opened directly.

Environment configuration:
- `PORT`: Server port (default: `3001`).
- `HOST`: Local bind address (default: `127.0.0.1`).
- `DATABASE_PATH`: Custom SQLite file path (default: `unifund.db`).
- `PAYMENTS_MODE`: `sandbox` by default for local development, `disabled`, or explicitly `tron-testnet`. Vercel disables simulated endpoints; Nile testnet mode requires explicit configuration.

### Enable the Nile testnet demo

This mode supports Nile test tokens only. The server restricts RPC access to the official Nile host and never uses or requests a private key. Configuration requires the approved public token contract and receiver address:

```bash
PAYMENTS_MODE=tron-testnet \
TRON_TESTNET_NETWORK=nile \
TRON_TESTNET_RPC_URL=https://nile.trongrid.io \
TRON_TESTNET_TOKEN_CONTRACT=TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj \
TRON_TESTNET_RECEIVER_ADDRESS=YOUR_TEAM_NILE_TEST_WALLET \
python3 server.py
```

The receiver placeholder must be replaced with the team's public Nile address before the command is run. The token contract is pinned to the approved Nile test USDT contract.

The browser flow requires TronLink on Nile, test USDT, and enough test TRX for the network fee. UniFund checks the solidified receipt, token contract, sender, receiver, amount, and transaction ID before adding a `testnet_confirmed` record. Reusing a transaction ID is rejected. Testnet records do not change the sample campaign totals.

### Deploy on Vercel with Neon

The public Vercel site needs both the frontend and an API backend. A database by itself does not provide sign-in or campaign API routes.

1. In Vercel, open the UniFund project and add Neon from the Vercel Marketplace.
2. Connect the Neon project to this Vercel project. Confirm that `DATABASE_URL` is available to the deployment.
3. Configure these environment variables in Vercel Project Settings:
   - `BOOTSTRAP_ADMIN_EMAIL`: email for the first audit administrator.
   - `BOOTSTRAP_ADMIN_PASSWORD`: a new, strong password for that administrator. Store it as a deployment secret, not in version control.
4. Redeploy the project.
5. Open `/api/health` on the deployed site. The API should return `status: ok` and `database: connected`.

The first request creates UniFund's tables in a dedicated `unifund` schema and creates the configured administrator. This keeps UniFund's tables separate from other apps sharing the Neon database. Local demo accounts are not automatically copied into Neon.

Neon stores hosted data independently from the local development machine. On a free plan, an idle database may scale down and take longer to answer its next request. Health checks confirm that the API can query the database, not that it has production-grade uptime, backups, or payment processing.

To load the sample campaigns and sample ledger into a hosted database with no campaigns, set:

- `SEED_DEMO_DATA=true`

Then redeploy. Existing admin accounts are preserved. On a completely fresh database with no users, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` before the first request, whether or not sample data is enabled. Sample student and donor accounts are only created on a completely fresh database and receive random passwords; the public local demo passwords will not work there. Seeding runs only when the campaigns table is empty.

The website's payment popup is a walkthrough preview unless Nile testnet mode is explicitly configured. Local sandbox API endpoints create clearly marked simulated records for development and tests. Vercel disables those endpoints even if `PAYMENTS_MODE=sandbox` is set. Nile mode verifies testnet transactions only; no setting connects a real payment provider.

The hosted testnet flow requires `PAYMENTS_MODE=tron-testnet`, `TRON_TESTNET_NETWORK=nile`, `TRON_TESTNET_RPC_URL=https://nile.trongrid.io`, `TRON_TESTNET_TOKEN_CONTRACT`, and `TRON_TESTNET_RECEIVER_ADDRESS` in Vercel, followed by a redeploy. Mainnet endpoints and real-value tokens are unsupported.

## Local demo data

The local database seeds example campaigns and development-only accounts. Local sign-in shows demo access when the local backend permits it. Development credentials are for local use only; hosted deployments require a separately configured bootstrap administrator. Optional hosted sample accounts use randomly generated passwords.

## Hackathon Details

- **Event**: Cleva x Tether Future of Payments Hackathon (UNIUYO Edition)
- **Track**: Stablecoins, Cross-Border Remittances, and Financial Infrastructure
- **Submission Date**: November 2026

## Tests

Run the backend and deployment-adapter tests:

```bash
python3 -m unittest tests.test_server tests.test_vercel_api
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for terms.
