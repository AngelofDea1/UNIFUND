# UniFund

A verified collegiate crowdfunding platform built for Nigerian university student organizations, using Cleva USD virtual accounts and Tether USDT on TRON.

Developed for the Cleva x Tether Future of Payments Hackathon (UNIUYO Edition).

## Overview

Student technical societies, robotics clubs, and academic engineering teams frequently design functional prototypes, but their development cycles stall when university disbursements are delayed. International alumni and diaspora backers who want to fund specific student initiatives face high wire fees, unfavorable remittance rates, and a complete absence of expenditure tracking.

UniFund addresses this by providing:
1. **Institutional Verification**: Student organizations register using university credentials, faculty advisor endorsement, and departmental matriculation verification.
2. **Dual-Rail Payments**:
   - **Tether USDT (TRC-20)**: Fast cross-border contributions with sub-dollar network fees and on-chain transaction hash verification.
   - **Cleva USD and Naira**: Dedicated virtual collection accounts for transparent fiat conversion and student organization balance management.
   - **Offline USSD Simulation**: Conceptual fallback for micro-contributions on campus without internet connectivity.
3. **Public Ledger**: Every contribution and expense report is published to an append-only ledger sealed with SHA-256 chained hashes.

## System Architecture

- **Frontend**: Standard ES modules, custom CSS design system, HTML5 canvas background. No external build toolchain or client framework dependencies.
- **Backend**: Python standard library HTTP service (`server.py`) exposing REST endpoints.
- **Database**: SQLite3 (`unifund.db`) with foreign key constraints, session tables, and cryptographic seal calculation.
- **Typography**: Space Grotesk for headings and numerical metrics; Plus Jakarta Sans for UI elements and prose.

## Getting Started

### Prerequisites

- Python 3.8 or newer
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Local Execution

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
   Navigate to `http://localhost:3001` in your browser.

Environment configuration:
- `PORT`: Server port (default: `3001`).
- `DATABASE_PATH`: Custom SQLite file path (default: `unifund.db`).

## Pre-Seeded Accounts for Evaluation

The local database contains pre-configured credentials for testing each system role:

| Role | Email | Password | Scope |
|---|---|---|---|
| Campus Audit Committee | `admin@unifund.org` | `admin123` | Campaign review, approval, rejection, and audit oversight |
| UNIUYO Student Organization | `robotics@uniuyo.edu.ng` | `student123` | Campaign creation, milestone tracking, expense logging |
| Diaspora Backer | `donor@alumni.org` | `donor123` | Public ledger receipts and contribution history |

## Hackathon Details

- **Event**: Cleva x Tether Future of Payments Hackathon (UNIUYO Edition)
- **Track**: Stablecoins, Cross-Border Remittances, and Financial Infrastructure
- **Referral Code**: `UNIUYO`
- **Submission Date**: November 2026

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for terms.
