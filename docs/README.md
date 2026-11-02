# branchwise-app2 docs

A desktop app for a Myanmar retail business with one wholesale branch and three retail branches. Electron + React frontend, FastAPI backend, Neon Auth for login and Postgres on Neon for the database.

Docs are split the same way the codebase is: shared docs here at the top level, retail-specific docs under [`retail/`](./retail/), wholesale-specific docs under [`wholesale/`](./wholesale/). Those are **developer references** (endpoints, tables, code names). What the assistant reads, and what the owner and staff would read, is a separate set of plain-language guides under [`guide/`](./guide/) (`retail/`, `wholesale/`, `common/`): see [Knowledge](./knowledge.md). [Where each calculation lives in the code](./calculation-sources.md) links the calculation guides back to the code.

## Shared

- [Setup](./setup.md) — getting the app running locally
- [Releasing](./releasing.md) — how to publish a new desktop version
- [Architecture](./architecture.md) — how the pieces fit together
- [Database schema](./database-schema.md) — tables, columns, relationships (both businesses — they share `branches`/`users` but no other tables)
- [Auth & accounts](./auth-and-accounts.md) — how login works, roles, seeded accounts, admin's User Management page
- [UI overview](./ui-overview.md) — design system and component conventions
- [Known limitations](./known-limitations.md) — gaps that are known and deliberately deferred (both businesses)

## Retail

- [Data import pipeline](./retail/data-import.md) — cleaning and persisting POS exports
- [Retail dashboard](./retail/dashboard.md) — the per-branch Revenue/Cost/Inventory/Customer tabs and how each number is computed
- [Business alerts](./guide/retail/business-alerts.md) — every alert condition in plain language, with a worked example for each
- [How every retail number is worked out](./guide/retail/how-the-numbers-are-worked-out.md) — an index to the one reference for every retail calculation, one page per topic (in `guide/retail/numbers/`) with the reasons behind it (periods and comparisons, each Dashboard tab, how a sale is costed, stock health, the Health score with every weight and points table, every Business Alert rule, the Warning checks, the reorder list, import rules), written from the code and guarded by `backend/tests/test_calculation_docs.py`
- [Branch health score](./retail/branch_health.md) — the Overview tab's 0-100 score per dimension, its weight/band table, and how it handles data it can't measure
- [Import health](./retail/import_health.md) — checks on whether an import's cleaning/confirm step behaved correctly
- [Checking](./retail/checking.md) — the physical stock audit — now shown as an alert on Business Alerts; the standalone page is no longer in the app
- [Knowledge](./knowledge.md) — teaching the assistant about the business: notes, pinned rules, other words, review, and meaning search
- [The assistant](./assistant.md) — the read-only chat assistant: who can use it, its tools, how sources and failed answers work
- [User guide](./retail/help.md) — the plain-language reference for staff (written for the in-app Help page, which has since been removed; kept as documentation and as the source material for the chat assistant)

## Wholesale

- [Overview](./wholesale/README.md) — the whole pipeline, and the shared conventions (pairs/colours/money/references/audit/lifecycle) every screen below uses
- [Shipments (Delivery)](./wholesale/shipments.md) — the freight journey and the "can't send more than a stop received" rule
- [Receiving](./wholesale/receiving.md) — counting packages at the gate; opening one is what makes it real stock
- [Supplier Vouchers](./wholesale/supplier-vouchers.md) — the commercial document a shipment/receiving fulfills
- [Customer Orders](./wholesale/customer-orders.md) — allocation, delivery, and the caps that keep both honest
- [Inventory / Stock Records](./wholesale/inventory.md) — the whole pipeline, including stock that hasn't arrived yet
- [Finance](./wholesale/finance.md) — receivables, payables, shipment costs
- [How every wholesale number is worked out](./guide/wholesale/how-the-numbers-are-worked-out.md) — an index to the one reference for every wholesale calculation, one page per topic (in `guide/wholesale/numbers/`) with the reasons behind it (pairs/sets/colors, money and currency, every status, shipment package maths, stock by place, allocation and delivery rules, Stock Records, what to buy, Today, Finance, every Dashboard tab, the Wholesale health score), written from the code and guarded by `backend/tests/test_calculation_docs.py`
- [Monitoring](./wholesale/monitoring.md) — the wholesale Dashboard (Summary, Revenue, Cost, Customer, Inventory) and Excel/CSV export
- [Master Data](./wholesale/master-data.md) — products, suppliers, customers, and the other reference lists
- [Write-offs](./wholesale/write-offs.md) — the shared "explain the mismatch" mechanism used by Shipments, Vouchers, and Orders

For day-to-day dev commands (running tests, migrations, the dev server), see [`CLAUDE.md`](../CLAUDE.md) at the repo root.
