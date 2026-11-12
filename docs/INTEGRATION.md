# OpenLedgerApp integration

What Ledger publishes for OpenAppHub and the other apps (SHARED-SPEC §3.6). Everything here is a
**read-only view** in schema `ledger`, created `with (security_invoker = true)`: it runs with the
caller's own row security, so a person sees exactly the rows they could read in Ledger itself
(members of the organization, viewers included; nobody else; signed-out visitors nothing).

Rules for consumers:

- **Feature-detect.** On a database without Ledger (or before migration `0002`), and in the
  desktop edition, the views don't exist. Treat "relation does not exist" (PostgREST `42P01` /
  `PGRST205`) as "Ledger isn't here" and hide the integration.
- **Never write.** A change in Ledger would go through a `security invoker` RPC documented here.
- **Columns are stable.** New columns are added at the end; none is removed or renamed.
- **Money is in cents** (`bigint`), in the organization's currency.

Migration: [`db/migrations/0002_integration_views.sql`](../db/migrations/0002_integration_views.sql).
Tests: [`db/tests/70_integration_views.sql`](../db/tests/70_integration_views.sql).

## `ledger.api_budgets`

One row per budgeted account and period (a year or a month), optionally for one fund or project.

| Column         | Type        | Meaning                                                          |
| -------------- | ----------- | ---------------------------------------------------------------- |
| `id`           | uuid        | The budget row                                                   |
| `org_id`       | uuid        | The OpenAppHub organization                                      |
| `account_id`   | uuid        |                                                                  |
| `account_name` | text        |                                                                  |
| `account_type` | text        | `revenue` or `expense` in practice (any account type is allowed) |
| `period_type`  | text        | `year` or `month`                                                |
| `period_start` | date        | First day of the period                                          |
| `period_end`   | date        | Last day of the period                                           |
| `amount_cents` | bigint      | The budgeted amount (never negative)                             |
| `fund_id`      | uuid        | Null for the whole organization                                  |
| `project_id`   | uuid        | Null for the whole organization                                  |
| `updated_at`   | timestamptz |                                                                  |

## `ledger.api_period_summaries`

Money in and out per calendar month, from posted transactions. Same rules as Ledger's income
statement: revenue and expense accounts only, voided transactions and year-end closing entries
left out. Months without transactions have no row.

| Column              | Type   | Meaning                                        |
| ------------------- | ------ | ---------------------------------------------- |
| `org_id`            | uuid   | The OpenAppHub organization                    |
| `month`             | date   | First day of the month                         |
| `currency`          | text   | The organization's currency, for example `USD` |
| `revenue_cents`     | bigint | Revenue (positive)                             |
| `expense_cents`     | bigint | Expenses (positive)                            |
| `net_cents`         | bigint | Revenue minus expenses                         |
| `transaction_count` | int    | Posted transactions in the month               |

Example (the hub's dashboard: this year so far):

```sql
select sum(revenue_cents) as revenue, sum(expense_cents) as expenses, sum(net_cents) as net
from ledger.api_period_summaries
where org_id = :org and month >= date_trunc('year', current_date);
```
