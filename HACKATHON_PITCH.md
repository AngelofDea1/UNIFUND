# UniFund Project Blueprint

Project presentation documentation for the Cleva x Tether Future of Payments Hackathon (UNIUYO Edition).

## Executive Summary

- **Project Name**: UniFund
- **Primary Goal**: Verified crowdfunding and milestone expenditure tracking for collegiate technical societies in Nigeria.
- **Sponsors**: Cleva and Tether
- **Focus Area**: Cross-border student funding, stablecoin settlement, and transparent fiscal governance.

## Problem Statement

Nigerian university engineering and research teams face two distinct challenges:
1. Long procurement delays for critical components (avionics, telemetry units, laboratory sensors).
2. Friction for international alumni who want to sponsor specific collegiate teams but lack secure, low-fee remittance channels with auditable proof of work.

## Solution

UniFund links international donors and verified student teams:
1. **Settlement**: International backers use Tether USDT (TRC-20) for low-cost settlement; domestic donors use Cleva USD / Naira virtual collection accounts.
2. **Accountability**: All disbursements require campus audit committee verification before funds are released, with receipts published to the public ledger.

## Technical Architecture

```
[International Backer] -> Tether USDT (TRC-20) -\
                                                 +-> [UniFund Ledger] -> [Cleva Student Org Account] -> [Suppliers]
[Domestic Backer]      -> Cleva USD / Naira    -/
```

## Presentation Outline

1. **Problem**: Prototype funding bottlenecks in Nigerian universities.
2. **Current Workarounds**: Unverified GoFundMe campaigns, personal account transfers with zero expenditure tracking.
3. **UniFund Workflow**: Institutional verification, multi-rail funding, and transparent expense reporting.
4. **Implementation**: Live prototype demonstrated with the UNIUYO Robotics and AI Lab drone campaign.
5. **Impact**: Accelerating university hardware and software projects across Africa.
