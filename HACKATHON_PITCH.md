# UniFund Project Blueprint

Project presentation notes for the Cleva x Tether Future of Payments Hackathon (UNIUYO Edition).

## Executive Summary

- **Project Name**: UniFund
- **Primary Goal**: Explore a clearer way for Nigerian university project groups to request support and report spending.
- **Sponsors**: Cleva and Tether
- **Focus Area**: Cross-border student funding, stablecoin settlement, and transparent fiscal governance.

## The problem we are exploring

Student groups may have difficulty raising money for project materials and showing supporters what was bought. International supporters may also face friction when sending small amounts across borders. These are the problems UniFund is designed to explore; this prototype does not yet measure their scale or solve payments.

## What UniFund demonstrates today

- Example campaigns from university campuses.
- Account creation and a demo committee-review workflow.
- Sample campaign figures, a non-transactional payment walkthrough, and a public ledger containing example and older test records.
- A spending-report form for campaign owners.
- A hosted API and Neon database for the deployed prototype.

No university identity is independently verified. Cleva, USDT settlement, bank transfers, USSD payments, withdrawals, and fund disbursements are not connected. Existing sample or test records are not evidence that money moved.

## What would come next

1. Work with universities and student groups to validate the need and the review process.
2. Connect a licensed payment provider and verify its payment callbacks before recording real contributions.
3. Define who holds and releases funds, how refunds and disputes work, and who reviews spending.
4. Account deletion is now available for backer and student organization demo accounts. Before a real launch, publish a privacy contact, define how any real payment records must be kept or removed, add operational monitoring and backup/recovery plans, and get the legal policy reviewed.

## Technical Architecture

```
[Browser] -> [UniFund frontend] -> [Vercel API] -> [Neon PostgreSQL]
                 |
                 +-> payment walkthrough only; no provider or payment record
```

The local developer setup uses SQLite. The production database schema is isolated as `unifund` inside Neon.

## Presentation Outline

1. **Problem**: Prototype funding bottlenecks in Nigerian universities.
2. **Problem to validate**: Campaign details, payment status, and spending updates can be hard to follow in one place. We still need to validate this with campus groups.
3. **UniFund workflow**: Campaign submission, committee review, payment walkthrough, public records, and expense reporting.
4. **Current stage**: A working web prototype with example data; payment settlement and identity verification are future work.
5. **Next test**: Validate the workflow with campus groups and payment partners before handling real funds.
