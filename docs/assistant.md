# The assistant

A floating chat button (`frontend/.../features/chat/`) backed by `POST /api/chat`
(`backend/app/retail/routers/chat.py`). It is **read-only for the business** (it never changes an order, stock, payment or setting) and answers three kinds of question. The one thing it writes is its own memory of decisions (`assistant_decisions`, see "Following up on decisions"):
numbers ("which branch sold most this month?"), why/what-needs-attention ("why is Branch X's
health low?"), and how-to ("how do I fix a wrong purchase import?").

## Which model

DeepSeek and OpenAI share one API, so both go through the same client (`chat/llm.py::resolve_llm`).
DeepSeek (`deepseek-chat`) is used when `DEEPSEEK_API_KEY` is set; otherwise OpenAI. `CHAT_PROVIDER=openai`
or `deepseek` forces one when both keys are present. The model that answered is saved on each
`assistant_runs` row. Whatever model is used, run the evaluation (below) after switching: models differ
in how well they pick tools and write SQL.

## Who can use it

`admin` and `development` only — `require_assistant_access` (`app/retail/routers/common.py`) on
every `/api/chat` route. Other roles get 403; hiding the button is not the control.

## How a turn works

1. The panel sends `conversation_id` (or none for a new thread), the message and the thread's
   context (branch, date range, page). The server loads the thread's recent messages itself
   (`MAX_HISTORY_MESSAGES`, `agent.py`) — the browser never sends history.
2. The question is saved **before** the model runs. If the answer then fails, the thread keeps
   the question and an `assistant_runs` row with `status = "failed"`; the panel shows the reason
   and a Retry button, which resends with `retry: true` so the question is not added twice.
3. `agent.py::stream_chat` runs a LangGraph tool-calling agent over the tools below, one tool at a
   time, and says what it is doing as it goes (see "Live progress"). The system prompt requires
   every figure to come from a tool and says to answer "can't tell" when a tool returns nothing.
4. The answer, its run (model, duration, tokens) and its sources are saved together.

## Figures need a lookup

The prompt says every number must come from a tool, but a model sometimes answers from nothing: once
it showed a table of invented zeros for a branch that had sold every day, in two seconds, with no source
saved. A prompt rule can't stop that, so `chat/grounding.py` checks the answer in code. If a turn gave
figures (not dates, not the numbers of a list of steps) and called no tool that looks at figures
(`describe_data`, `report_gap` and `show_chart` don't count), the reply is dropped, the panel shows
"Checking the figures against the data", and the agent is asked once more to call the right tool.
If it still looks nothing up, the reply says it couldn't check the data and gives no figures. Only
this turn's lookups count. The evaluation's `g-figures-need-a-lookup` is the follow-up shape that
failed in real use.

**Every figure must be one a tool returned.** The same module checks each number in the reply against
the numbers in this turn's tool results and what the model was told in words (the pinned notes and the
conversation so far). A number matches at the precision it is written at ("46" matches 46.4; "649,592"
matches 649592.40). Dates, years, the numbers of a list of steps and small whole numbers (counts, ranks,
days of the month, up to 31) are not checked, except a percentage. A figure that matches nothing, such as
a share or a total the model worked out by hand, sends the agent back once ("Checking the figures against
the data") to get it from a query; if it still matches nothing, the reply ends with
"(Worked out by the assistant, not read from the data: 61%)". It is a note, never a refusal, so a check
that is wrong costs a line of text, not a correct answer. The tools print their own totals (`TOTAL qty`
in the sales and purchases summaries) so the model has no reason to add rows up. The evaluation prints how
many answers were sent back and fails an answer that ends with such a note.

## Live progress

The panel calls `POST /api/chat/stream`, which sends server-sent events instead of waiting for the
whole answer: `meta` (the conversation id, once the question is saved), a `status` line per step
("Reading your question", "Checking sales", "Running a query", "Putting the answer together"), then
`answer` (the saved message with its sources) or `error` (`{detail, code, conversation_id}`, the same
codes as below). A bad request (empty message, unknown conversation, nothing to retry) is an ordinary
HTTP error before the stream starts. `POST /api/chat` still returns the whole answer in one response.

- **One agent path.** `stream_chat` yields `ChatProgress` steps and finally the `ChatRunResult`;
  `run_chat` just drains it, so the evaluation, the plain endpoint and the stream all run the same code.
- **The words** live in `chat/progress.py` (`TOOL_LABELS`). A test fails if a tool has no label, so add
  one when you add a tool.
- **Its own session.** The stream's generator opens its own database session (FastAPI closes the
  request's around when the stream starts) and reloads the user by id.
- **If the connection drops** after `meta`, the panel reloads the thread: the answer may have been saved
  (shown), otherwise the question shows as unanswered with Retry. Closing the panel mid-answer likewise
  leaves the question saved and unanswered.
- The panel reads the stream with `chat/stream.ts` (`EventSource` is GET-only); an event cut off by a
  dropped connection is ignored.

Failures return `{detail, code, conversation_id}`: `not_configured` (500, no `DEEPSEEK_API_KEY` or `OPENAI_API_KEY`),
`ai_unavailable` (502), `timeout` (504, after `MODEL_TIMEOUT_SECONDS`), `error` (500, anything
else). Nothing from the underlying exception reaches the client.

## Tools

Tools live in `backend/app/retail/services/chat/`. Most call the service function the matching
screen calls, so the assistant and the screen agree. Approved metric calculations are a second,
governed path: the assistant chooses a reviewed rule and presentation parameters, while a
deterministic engine performs the calculation.

| Tool | Reads (same as) |
|---|---|
| `get_current_stock`, `get_data_quality_warnings` | Inventory and Warning-page queries (`tools.py`) |
| `get_branch_health`, `get_business_alerts` | `branch_health.build_overview_dashboard` — the Dashboard Overview and Business Alerts |
| `get_decisions_now` | "What needs a decision now": the retail Business Alerts of every branch the account may see, and for wholesale the Today lists, put in one fixed order (Critical business problems, customers waiting or orders ready to deliver, Warnings, money to collect and pay, stock to move or count, heads-up notes, then data to fix), each with its reason and what to do. It works nothing out of its own: the reasons and actions are the alerts' own and the Today rows (`chat/decisions.py`). A suggestion only; the prompt tells the assistant not to add advice of its own |
| `update_decision` | Snooze (hide for some days), dismiss (the owner will not do it) or reopen a decision by its number (#12). It changes only the `assistant_decisions` row, never business data. Used only when the person asks to put one off or drop it |
| `get_alert_products` | The exact products and quantities behind a Business Alert, for a decision: `transfer` (slow stock to move to the branch that sells it), `reorder` (best sellers out of stock, how many to order), `old_stock`, `demand`, `recount`. It prints the alert's own table (up to 25 rows), so it works nothing out of its own (`business_tools.py`) |
| `get_wholesale_buy_plan` | What to buy for wholesale customers waiting for products nothing covers (the Today page's Short list), grouped by the supplier each product was last bought from, with the sets and about what they cost at the latest buying price after the voucher's discount (`wholesale/services/pricing.py::latest_cost`). By product, not by color: the colors are on Suppliers, What to buy |
| `get_wholesale_collection_priorities` | Which customers to ask for money first: money that has waited more than 30 days first (the customer with the most overdue money first), then everyone else by the largest balance. Each customer shows what is left to collect, the orders, the oldest order's age and how much is overdue. It reads the open orders the Revenue tab reads (`wholesale/services/collection.py`) |
| `get_wholesale_price_options` | Prices to choose between for one wholesale product, per set: its cost, the price that earns 10, 15, 20, 25 and 30 percent of the selling price as profit, and how the default and the last quoted price compare (`wholesale/services/pricing.py::price_options`, same cost as the order form's suggestion) |
| `get_dashboard_summary`, `get_revenue_summary`, `get_customer_activity`, `get_cost_and_margin`, `get_inventory_health` | `build_summary_dashboard`, `build_revenue_dashboard`, `build_customer_dashboard`, `build_cost_dashboard`, `build_inventory_dashboard` — the Summary, Revenue, Customer, Cost and Inventory tabs. Conversion rate says "not measured" where no zero-selling records exist, never 0% |
| `get_app_settings` | The business-wide settings as saved right now (`app_settings`, through the same readers the screens and services use: closing time, Warning-page windows, cost-pricing windows, Branch Health weights, reorder buffer months, exchange rates, the wholesale selling price profit), each marked *changed by the owner* or *default*. Read-only: it never saves or backfills a row. The prompt requires it for anything that depends on a setting, because the knowledge base and guides can be out of date about them (`settings_tool.py`; a test fails if a setting has no plain-word entry) |
| `get_import_status` | `import_completeness.build_import_completeness` — missing sales/stock-count days |
| `get_reorder_list` | The Reorder page's list: counts per recommendation, the buffer months in force, and the top products (class, monthly sales, on hand, cover, suggested quantity); `search` looks at one product (`get_purchasing_recommendations`) |
| `get_salaries` | Staff pay from the imported salary tables: per branch and month, people, salary and bonus totals; one branch and month also lists each person (`chat/operations_tools.py`). A sheet whose name is not "Month.Year" is left out and counted |
| `get_daily_costs` | The General File's daily costs per branch: days recorded and the usage, digital income, return and capital totals; one branch also lists its newest days |
| `get_zero_selling` | The zero-selling log: records by branch and category and a few of the reasons written down (the conversion rate is `get_customer_activity`) |
| `get_sales_performance` | The Revenue tab's Sales Performance: revenue, pairs, slips and revenue per pair against the same dates last year, then month by month (`build_revenue_dashboard` / `build_all_revenue_dashboard`) |
| `get_all_branches_summary` | The All Branches Summary: totals, then one line per branch (`build_all_summary_dashboard`) |
| `get_import_history` | The newest confirmed imports: type, file, branch, status, who, when and how many rows each created |
| `get_import_health` | The Import Health checks (`build_import_health`): imports to review with the reason, and sales slips whose lines do not add up to the slip's total |
| `get_stock_audit` | The Physical Stock Audit: whether the sheet is unlocked (after the daily cutoff, with today's sales file and stock count imported) and which products to recount with the system's quantity (`build_checking_items`, the same list as Business Alerts' audit alert) |
| `get_wholesale_next_steps` | What to do next in wholesale, as Today lists it: Deliver, Collect and Pay match its rules exactly; goods to move/count and what is short are described in plain stages (`wholesale/services/next_steps.py`) |
| `get_wholesale_record` | One wholesale order, supplier voucher, shipment or receiving by its reference number, as its page shows it (status, sets, Ks, lines; a voucher also lists its shipments and receivings). It calls the record pages' own list functions (`chat/wholesale_records.py`) |
| `get_wholesale_shipments` | The shipments: how many in each status, then those still on the way with supplier, voucher, carrier, date and packages sent / received / still to come (`wholesale/routers/shipments.py`, `chat/wholesale_logs.py`) |
| `get_wholesale_receivings` | The receivings: how many in each status, then those not fully counted with gate, sets counted against expected, packages opened and cost so far |
| `get_wholesale_write_offs` | The quantities recorded as lost or short, by reason, newest first (a shipment's in packages, a line's in sets) |
| `get_wholesale_contacts` | A customer's or supplier's phone and address from master data |
| `get_wholesale_health` | The Wholesale health score, the same one the Wholesale Dashboard's Health tab shows: the overall figure, how each of its four parts (Orders, Money, Inventory, Profit) scored, and the figures behind each measure; for the period asked (default the last 30 days; the Orders, Money and Inventory parts look at what is open now), and it says when the owner's own weights are in use (`wholesale/services/health.py`); given only to development and admin accounts |
| `get_wholesale_price_suggestion` | The selling price the customer-order form suggests for one product (cost per set from the latest supplier voucher with the product, less its discount, plus that voucher's transport cost per set, plus the profit set in Settings, rounded up to 10 Ks); the rule is in `wholesale/services/pricing.py` and `docs/wholesale/calculations.md`, the same as the form's `priceSuggestion.ts` |
| `get_wholesale_revenue`, `get_wholesale_cost`, `get_wholesale_inventory`, `get_wholesale_customers` | The wholesale Dashboard's Revenue, Cost, Inventory and Customer tabs: each calls the tab's own service (`revenue_dashboard` + `open_revenue_dashboard`, and the matching pairs), so it gives both the period part and the "open" part with no period; quantities in sets, money in Ks, no shortened amounts (`wholesale_tools.py`; given only to accounts the wholesale screens admit) |
| `calculate_metric` | A deterministic calculation over approved, versioned metric rules: `sales_summary`, `top_selling_products`, `purchase_summary`, and wholesale `product_profit`. The assistant can select dates, grouping, filters, measures, sorting and a limit; it cannot supply a formula or executable code. Missing supplier-voucher costs exclude the affected products rather than becoming zero (`metric_calculator.py`, `retail/services/metric_rules.py`, `wholesale/services/metric_rules.py`) |
| `get_wholesale_summary`, `get_wholesale_customers_owing`, `get_wholesale_suppliers_owed` | Wholesale monitoring/revenue services (`business_tools.py`) |
| `get_wholesale_buy_plan_detail`, `get_wholesale_receiving_plan`, `get_wholesale_product_movements` | The Wholesale Suppliers page's colour-by-colour purchase/receiving work and the Products page's stock movement history (`wholesale/services/buy_plan.py`, `inventory.py`) |
| `search_knowledge` | The owner's notes and the written guides, ranked by words and by meaning (`knowledge_search.py`) — see [knowledge.md](./knowledge.md) |
| `describe_data`, `run_query`, `show_chart`, `report_gap` | The fallback for questions no tool answers — query named data views; see "Ad-hoc queries" below (`query_tools.py`, `data_views.py`, `sql_guard.py`) |
| `list_branches` | The retail branch names |

Branch scope is one rule (`scope.py`): a branch-scoped account always gets its own branch;
otherwise the `branch` argument, else the conversation's branch, else every branch. An unknown
name returns the list of real ones.

## Why a repeat question is quick

The tools that read Branch Health and the Business Alerts (`get_branch_health`, `get_business_alerts`,
`get_decisions_now`) do not work the Overview out themselves: they ask `retail/services/overview_cache.py::cached_overview`,
the same cache the Dashboard's Overview and the Business Alerts nav badge fill. A cold branch takes 6 to 15 seconds
against the remote database (measured on 2026-10-09: 34 seconds for the four retail branches), so before this the
assistant paid that on every question and on every follow-up that needed the same numbers. Now whoever asks first pays,
and a repeat or a follow-up is answered from the cache (0.5 seconds for the four branches). The cache key carries the
branch's import data version, the day and the two Settings check windows, so a confirmed import, a revert or a new
day makes the next question work it out afresh; saving the Branch Health weights clears it. The assistant still
remembers only what was *said* in the last 20 messages, not the tool results, so a follow-up that needs numbers asks the
tools again: that is deliberate (the numbers are always today's and match the screens), and it is cheap whenever the cache
holds the answer. The wholesale "Today" lists (`next_steps`, about 5 seconds) are not cached yet.

## How an answer is shown

The model writes light Markdown when it helps (numbered steps, bullets for three or more separate points,
bold figures, and a table for two or more comparable rows with the same fields); one or two connected thoughts stay as plain paragraphs.
Comparable branches, dates, products, or options use a real Markdown table with a header and separator row,
not a list; it keeps only the useful columns so it remains readable in the narrow chat.
`chat/ChatMarkdown.tsx` renders it in the app's own styling. Short answers remain conversational; a longer
or structured answer gets a little more surface and spacing so it can be scanned. Tables keep gridlines and
scroll sideways, and a copy button sits beside the right/wrong buttons. It cannot run anything: HTML in the text is shown as text and a link
is shown as plain words. A bold page name in a step (**Today**, **Customers**, **Suppliers**, **Products**) becomes a button
that opens that page (`chat/pageRoutes.ts`, a fixed list; a test checks each is a real menu item).
Your own messages stay plain text. Saved answers are the raw Markdown, so
copying gives Markdown.

## Charts

When a question is a comparison of three or more things, a trend over time or parts of a whole, the
assistant answers with `run_query` and then calls `show_chart(kind, x, y, title, unit)`, which draws the
rows of that query under the text. The model chooses *how to draw* (`bar`, `hbar`, `line` or `share`, the
label column, the number column or columns); it never supplies a value.

- **The server decides what is honest** (`chat/chart_spec.py`, unit-tested): the columns must exist and
  be numbers; fewer than 3 points, a cut-off query, negatives in a share, or zero totals give no chart
  (the answer stays words); a share of more than 6 parts, a bar chart with long labels or more than 8
  bars becomes horizontal bars; dates become a line in date order; more than 12 categories keep the
  biggest and the chart's caption says "Showing the top 12 of N". Units (`Ks`, `%`, sets, count) are
  guessed from the column name and can be set. At most two charts per answer.
- **A failed or refused query clears the result**, so a chart is never drawn from an older query.
- **Saved with the answer** as a source with `source_name = "chart"` and the spec as JSON in
  `details["chart"]` (no migration). The panel draws it (`chat/ChatChart.tsx`, hand-written SVG in the app's
  colours, exact value on hover, the data again as a hidden table for screen readers) and keeps it out of
  the Sources list. Its source is the ad-hoc query listed under the answer.
- **Analysis** (this month against last, share, trend) is one query that returns the difference or
  percentage, worked out in SQL, never by the model; `describe_data` has examples of each.
- The evaluation's `charts` category checks the kind drawn, that the chart's data holds the truth query's
  figures and labels, and that a single number, a two-item answer and a list of names get no chart.

## Sources

Each tool appends a `ToolSource` (`sources.py`) when it runs: label, branch, date range, the
newest data it saw (`as_of`) and a `route` — a section id the app can open (`dashboard`,
`businessAlerts`, `sales`, `inventory`, `purchase`, `warnings`, `importOverview`, and the wholesale
`monitoring`/`customers`/`suppliers`). Sources therefore come from what the tools queried, never
from the model's own words. They are saved as `assistant_citations.details`; the panel shows them
under each answer and a click opens the page (`App.tsx`'s `handleAssistantNavigate`, which also
switches workspace for a wholesale page).

## Ad-hoc queries (the fallback)

A fixed tool list can't cover every question, so the assistant can also write one SQL `SELECT`
over a small set of business-named **views** — never raw tables. The specific tools above stay the
first choice: they carry rules the views don't (point-in-time cost, health score, alerts) and match
the screens. A figure from a query is shown as "Ad-hoc query, not a dashboard figure".

| View | One row per |
|---|---|
| `v_sales` | sale line (`sale_month`, `weekday`, `branch`, `category`, `net_amount` = revenue) |
| `v_stock_current` | product in each branch's newest whole count (same rule as `retail/services/stock.py`) |
| `v_stock_history` | product in every count |
| `v_purchases` | purchase line (`cost` = quantity x buying price) |
| `v_products`, `v_branches` | product / retail branch |

**Wholesale views (`w_` prefix)** are different, because wholesale amounts and statuses are worked out in
Python (quantities in pairs, prices quoted per pair/set/dozen, an order's status from what was allocated
and delivered, a voucher's received quantity from opened packages, stock from five sources). Re-deriving
them in SQL would disagree with the screens, so each `w_` view is a list of rows built by **the same code
the screens call** (`wholesale/services/query_views.py`: the orders and vouchers routers' own row
builders, `stock_records`, `outgoing_movements`) and handed to the query as a `VALUES` table. Quantities
are in **sets** (6 pairs = 1 set), money in Ks. Only the views a query names are built, and only accounts
the wholesale screens admit (admin, development, wholesale) may use them; wholesale rows follow the
account's branch (admin: all).

| View | One row per |
|---|---|
| `w_orders` | customer order: status, ordered / delivered / left sets, total, paid, left to collect |
| `w_order_lines` | order line: product, group, supplier, sets, price per set, line amount |
| `w_deliveries` | delivery out to a customer (place, product, sets) |
| `w_vouchers` | supplier voucher: status, ordered / received sets, total, paid, left to pay |
| `w_voucher_lines` | voucher line: product, sets, buying price per set, amount |
| `w_payments` | payment, `kind` = customer (received) or supplier (paid out) |
| `w_stock` | product: warehouse, at-gate, set-aside, available, incoming and owed-to-customers sets |
| `w_stock_places` | product at each place that holds some (`is_warehouse`) |

Also exposed: `w_shipments` (a shipment with packages sent / received / lost / left) and
`w_receivings` (a receiving with gate, packages, expected/count sets and cost). Write-offs and
audit logs are not exposed as ad-hoc views.
`tests/test_wholesale_views.py` compares every view with the matching screen's endpoint.

The views are CTEs placed in front of the model's query (`data_views.with_views`), not database
objects: no migration, same behaviour on Postgres and the SQLite tests. `describe_data` generates
what the model sees (columns, meanings, rules, five example queries) from the same definitions, so the
documentation cannot drift from the SQL; a test runs every example.

Safety is code, not prompt:
- `sql_guard.check` (sqlglot): exactly one statement, a plain SELECT (WITH allowed), only the views,
  no unknown functions (`pg_sleep`, `set_config`, ...), no `generate_series`, no INTO/locks, and the
  query that actually runs is the one *regenerated* from the parse, comments removed.
- `query_tools._run_read_only`: its own transaction, `SET TRANSACTION READ ONLY` and a 5 s statement
  timeout on Postgres, at most 200 rows, always rolled back.
- A branch-scoped account's branch filter is written inside every view.
- The SQL and row count are saved with the answer's sources and shown under it.

## Approved metric calculations

The assistant never writes calculation code. For a governed metric it sends only a request such as
`rule_id=product_profit`, dates, grouping, filters, measures, sorting and a limit. The generic
calculator validates those choices against the approved rule, then deterministically filters,
groups, aggregates, derives and ranks already-authorized structured rows. The business definition is
not part of the request and is versioned in the rule registry.

Retail rule version 1 definitions are `sales_summary` (sales, items, revenue and average sale),
`top_selling_products` (product sales ranked by revenue), and `purchase_summary` (quantity and
cost); all default to the prior 30-day window. `product_profit` version 1 means delivered customer revenue minus the discounted supplier-voucher
product cost estimated from the latest voucher on or before delivery. It reports **gross** profit, so
transport is not included. Products with delivered sales but no known supplier-voucher cost are
excluded from a ranking and their affected revenue is reported; unknown cost never silently becomes
zero. The result records the rule version, dates and branch as its source.

`report_gap` records a question nothing could answer as a source with `source_name = 'gap'` (hidden
in the panel). These appear in the **Knowledge** page's inbox of unanswered questions, where the owner
turns them into notes (see [knowledge.md](./knowledge.md)). To list them by hand:
`SELECT label, created_at FROM assistant_citations WHERE source_name = 'gap' ORDER BY created_at DESC;`

Adding a column to a view: change `data_views.py` (the SQL and its `Column` list together), then add it
to the test that compares the view with the matching tool or screen.

## Feedback: right / wrong

Under every answer are two small buttons. **Right** saves at once; **wrong** asks "What was wrong?"
(optional) and saves with the reason; pressing the active one again takes it back. It is one row per
answer in `assistant_feedback` (`PUT` / `DELETE /api/chat/messages/{id}/feedback`, same access rule and
ownership check as the conversation routes; only an answer can be rated).

The point is the loop: real use finds a mistake, the mistake becomes an evaluation question.

```
uv run --directory backend python scripts/review_assistant_feedback.py            # answers marked wrong
uv run --directory backend python scripts/review_assistant_feedback.py --gaps --draft
```

It prints, for each: the question, the answer, the reason, the model, the sources and any ad-hoc SQL
(`--all` adds the "right" ones, `--gaps` adds questions the assistant said it couldn't answer, `--draft`
prints a stub entry). Paste a stub into `backend/tests/eval/questions.json` and add the checks that
say what a right answer is (`truth`, `tools_*`, `contains_any` ...); the script never edits that file.

## The message box

- **Placeholder.** Empty chat: a hint for the branch, or an example from what the person asks about most (`chat/habits.py` reads the tools behind their answers of the last 30 days — at least 3 answers make a habit; `GET /api/chat/frequent-topic`; no model call, nothing new stored). After an answer: a next question written by the model from the question and the answer (`POST /api/chat/next-question`, `chat/follow_up.py`; any failure means no hint and falls back to a fixed line). `Tab` on an empty box takes the hint; Enter and Tab are ignored while an input method (Chinese, Myanmar) is composing — `composerKeys.ts`.
- **Starter chips** on an empty chat are fixed, not model-written: two retail and two wholesale questions, rotated daily (`suggestedQuestions.ts`). Only admin/development can use the assistant, and both see both businesses, so they do not depend on role or page.
- **Message history** sent to the model is capped (`MAX_HISTORY_MESSAGES`); the saved thread is not.

## What the assistant costs

Every model call is counted: chat answers on `assistant_runs`, the next-question hint on `assistant_usage` (token counts, and how many input tokens were cache hits — DeepSeek reports `prompt_cache_hit_tokens`, which LangChain does not map, so `chat/tokens.py` reads it from the raw usage). The pet's right-click menu has a **Usage** button that opens the report inside the chat panel (`GET /api/chat/usage?days=`): totals, by function (Chat / Next question), by Retail / Wholesale, by day, and — for `development` only — by person. Everyone else sees only their own use.

Retail or Wholesale is decided from what the answer's tools looked at (`usage.py::business_of`); a turn that used neither (help, knowledge) or both goes by the screen the chat was opened on.

Money is shown only when prices are set in `backend/.env`: `CHAT_PRICE_INPUT_PER_MILLION`, `CHAT_PRICE_CACHED_INPUT_PER_MILLION` (billed lower; unset = the input price) and `CHAT_PRICE_OUTPUT_PER_MILLION`, per million tokens in the provider's currency. It is an estimate — the provider's bill is the truth. Settings are read once at start, so restart the backend after changing them.

## Evaluating a change

`backend/tests/eval/` holds a fixed list of questions (`questions.json`) asked to the real assistant
over a fixed fake business (`seed.py`, dated relative to today), scored by plain checks: the right
number appears (computed from the raw tables, never typed), the right tool was called, a refusal or
"can't tell" was given when it should be, nothing was written, follow-ups and Chinese work. Run it
after changing the prompt, a tool, a view or the model, and compare with the run before:

```
uv run --directory backend python -m tests.eval.run --save
uv run --directory backend python -m tests.eval.run --only adhoc --repeat 3
uv run --directory backend python -m tests.eval.run --compare tests/eval/reports/<earlier>.json
```

It calls the real model (a few cents a run), so it is a command, not part of `pytest`;
`tests/test_eval_harness.py` does run in pytest and checks the question file, seed and scorer without
a model. Add a question whenever the assistant gets something wrong in real use. Details:
`backend/tests/eval/README.md`.

## Adding a tool

Add it where its data belongs (`tools.py` for retail queries, `business_tools.py` for results the
screens already compute), take a `branch` argument and resolve it through `BranchScope`, append a
`ToolSource` with a real `route`, cap its output, and add a test in `backend/tests/test_chat.py`
that checks its numbers against the matching screen's service. Wording in the output follows the
rest of the app: amounts as `Ks 12,500`, wholesale quantities in sets, no per-day selling rates.

## Not built yet

A screen-aware explain bubble (click a number on any page, get a 2–3 sentence answer from this same assistant): built for the retail Dashboard (`POST /api/chat/explain`, or `POST /api/chat/explain/stream`, which the screen uses to show the steps; an Explain switch beside Refresh). See [assistant-explain.md](./assistant-explain.md).

Shipment and receiving views for ad-hoc queries, a separate read-only database role, the answer's words appearing one by one, a cancel button, model-written conversation titles, a screen inside the app for browsing feedback (the script is enough for now). See [known-limitations.md](./known-limitations.md).

## The pet's personality

The chat sends the pet the person chose (`persona`: `cat` or `robot`, the same choice as the floating pet) with each question, and `agent.py` adds a short "Personality (style only)" block to the system prompt (`persona_prompt`). The cat is warm and gently playful, the robot tidy, calm and a little dry. It is only wording: at most one short touch per reply, never a changed or softened figure or warning, left out when the news is bad, when something failed or when the answer is just a number, no emoji, and a "meow" or "beep" only very rarely. The Explain bubble does not use it: its answers stay neutral. A request with no `persona` (the evaluation, other clients) is exactly the plain assistant.

## Choosing tools and planning (routing and planning)

The assistant is one ReAct agent (LangGraph `create_react_agent`): the model reads the question, calls a tool, reads the result and repeats until it can answer. With forty-odd tools two things can go wrong: it picks the wrong tool (or none), and on a question that needs several lookups it misses one. Two optional layers address them. Both are in the chat panel's own run only (the Explain bubble has its own few tools and step cap), and both are off by default (`ASSISTANT_TOOL_ROUTING`, `ASSISTANT_PLANNING` in `backend/.env`) until `python -m tests.eval.run` shows they help.

**Tool routing** (`chat/routing.py`). Before the run, each tool is scored against the question and the model is shown a shortlist (the best 10, plus the core tools: knowledge, settings, the SQL fallback, `report_gap`, `list_branches`) instead of every tool.

- Two signals are blended: *meaning* (the question and each tool's description as vectors from the same Cloudflare model the knowledge search uses, so a Burmese or Chinese question can match an English description; the tool vectors are computed once per process, and after a failed call it waits five minutes before trying again) and *words* (rare words shared with the tool's name and description, English only).
- It reads the last two things the person said (a follow-up such as "and Downtown?" means nothing alone) and adds a "wholesale" hint when the chat was opened on a wholesale screen.
- It is a shortlist, not a decision: the model still chooses, and a question that needs two different tools gets both while both are close to it. A tool with no score is never in the shortlist.
- Safety nets: with no signal at all (no vectors, a language the word match cannot read) the model gets every tool; if the shortlist ends in `report_gap` ("I can't answer that") the run is repeated once with every tool (`widened`).

**Planning** (`chat/planning.py`). A cheap rule decides first (`should_plan`: "why", "compare", "difference", several questions in one, a long question, in English, Chinese and Burmese), so a simple question costs no extra call. For the rest the model writes a plan of two to five steps from the tools it will see; if it calls the question simple there is no plan. The plan goes into the system message as a checklist, and the same agent follows it, calling the tools each step needs, then writes one answer. It is "plan, then guided execution", not a separate executor per step: the answer's figure check (`grounding.py`) and the streaming of steps stay exactly as they were, and every number still has to come from a tool. The planning call's tokens are added to the turn's usage.

`ChatRunResult` carries `route_method`, `routed_tool_count`, `planned_steps` and `widened` for the evaluation; they are not saved with the conversation.

**What the evaluation showed (2026-10-05, DeepSeek, with the Cloudflare vectors rate-limited, so the router ran on words only).** Both layers are therefore still off by default.

| | passed | input tokens |
|---|---|---|
| neither | 81/84 | 1.90M |
| routing | 81/84 | 1.35M (29% fewer) |
| routing and planning | 81/84 | 1.35M |

- **Routing** saves about a third of the input tokens at the same pass rate. Its first version left the obvious tool out of the shortlist for 7 of 37 questions (a word-only match cannot tell "sell" from "sales", or "owes" from "owing"); stemming, a double weight for words in a tool's name and `ROUTING_HINTS` (how people ask for the older, plainly described tools) brought that to 0 of 37, and `test_the_shortlist_never_leaves_out_a_tool_the_evaluation_questions_expect` keeps it there. Turn it on once the vector signal has been measured too (run the evaluation after the Cloudflare allowance resets).
- **Planning** did not help on this set: the plain agent already combines tools (the `multi` questions, three that need two different tools, pass the same with or without a plan), the plan call adds about a second and a half, and the first version, which also planned "compare" questions, made the agent skip charts (three chart questions failed). It now plans only "why / what changed" questions and several questions in one. Leave it off unless the evaluation gains a diagnosing question it improves.
- `m-owed-both-ways` fails with every setting because the model subtracts the two balances by hand (the answer ends "worked out by the assistant"). The fix is a tool that returns the comparison, not a smarter layer: the assistant is most accurate where a tool does the arithmetic.

## Which business a question is about

The assistant serves a retail business and a separate wholesale one. The system prompt names wholesale's own words (warehouse, gate, place, package, voucher, shipment, receiving, allocated, "sets") and says they mean the wholesale tools: there is no warehouse in retail, so "what stock is in the warehouse?" is `get_wholesale_inventory`. A question that could be about either ("what stock do we have?") is answered for both from one tool each, briefly and labelled, rather than answered with "which one do you mean?". The evaluation's `ws-warehouse-stock` and `ws-either-business-stock` hold this.

## Following up on decisions

`get_decisions_now` remembers what it listed (`models/assistant_decision.py`, `chat/decision_followups.py`), shared by every account that may use the assistant. Each live decision has a stable key (a rule and a branch for a retail alert, or one of the wholesale to-do lists), a number (`#12`), the day it was first seen and the day it was last seen. Each time the list is worked out: what is still there ages ("open for 3 days"); what is no longer raised by the app's own alert or to-do list is marked **resolved** with that day, and the next answer starts with "Cleared since last time"; what is new is remembered from today. A decision counts as cleared only on that evidence; the assistant does not take anyone's word for it.

Only the scopes that were looked at are followed up (one retail branch named: only that branch; wholesale is left out then), so a decision is never called cleared because it was not examined. A snoozed decision is hidden until its day; a dismissed one stays hidden until it clears, and if the same thing comes back it is a new decision. Inside a group of the same importance, the ones open longest come first.

**The note when the chat opens.** `GET /api/chat/decisions/briefing` works the list out again (at most every 15 minutes, with no model call) and returns what is still open and what cleared in the last 3 days. The chat panel shows it as "From last time", but only for decisions that have waited at least a day, or ones that cleared; it can be closed with "Not now" for the rest of the day, and **Show what needs a decision** asks the assistant. It is not a push notification: it appears when the chat is opened.

Only titles and reasons are stored, never a customer's details.
