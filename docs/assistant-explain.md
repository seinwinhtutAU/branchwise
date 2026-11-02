# Explain bubble (built for the retail Dashboard and Business Alerts)

A small, screen-aware helper: the user clicks a number, a chart bar or a table row anywhere in the app
and a bubble opens beside it with a **2–3 sentence** explanation of what it means and why it is what it
is. It is the same assistant as [assistant.md](./assistant.md), entered from the screen instead of from
the chat panel. Nothing on the page gets an "Ask AI" button, so the UI stays as it is.

## Who can use it

`admin` and `development` only, the same as the assistant (`require_assistant_access`). Other roles get
403 and never see the bubble. No new permission is introduced.

## The idea

The screen tells the assistant **what state it is in**, not what the numbers are. The assistant looks
the numbers up itself with the tools it already has. Those tools call the same service functions the
screens call, so the bubble and the page agree, and every figure still goes through the check in
`chat/grounding.py`.

This is why it is one generic feature rather than a tooltip per card: a page that sends no extra
information still works (page, tab, branch, date range and the clicked text are enough for a basic
answer); extra information only makes it sharper.

## What the screen sends

Today the chat context holds branch, date range and page (`ConversationContext`). The bubble adds:

| Field | Meaning |
|---|---|
| `tab` | The tab inside the page (e.g. Dashboard → Cost) |
| `focus` | What was clicked: its text and the title of the block it sits in. No values needed |
| `visible_text` | A short snapshot of the text on screen, so the answer can match what the user sees (client-side rounding, sorting, local filters) |
| `fetched_at` | When the screen last loaded its data, so a stale screen can be mentioned instead of the assistant "correcting" it |

The frontend gathers this in one place (`AppShell`); each page only reports its tab and filters, most of
which already exist as state.

## What the backend does (built)

A new route, `POST /api/chat/explain`, that **saves no conversation**. It runs the same agent with a
stricter mode:

- A short-answer system prompt: 2–3 sentences, shop-owner words, meaning first and reason second. No
  tables, no charts, no ad-hoc SQL.
- At most 1–2 tool calls.
- The grounding check stays on. Wording follows the app's rules (Ks amounts, wholesale in sets, no
  per-day selling rates, one word per concept from the dashboard docs).
- The answer ends with 2–3 suggested follow-ups, shown as buttons.
- A page/tab → tool → doc map tells the assistant where to look (`search_knowledge` already reads
  `docs/retail/dashboard.md` and `branch_health.md`).

"Expand" in the bubble opens the full assistant panel with this exchange carried over, so there is
still one assistant and no second AI that does not know what the first said.

## What the frontend does

- One gesture, written once: an **Explain switch** (off by default); with it on, a click on a card explains it
  instead of doing what it normally does, because a plain click already opens detail pages on some cards.
- One bubble component, with the short answer streaming in, the follow-up buttons and Expand.
- Placed in the shell, so every page inherits it.

## Gaps to close first

- ~~Revenue and Customer dashboard tabs had no dedicated tool.~~ Done: `get_revenue_summary` and
  `get_customer_activity` call `build_revenue_dashboard` / `build_customer_dashboard`, and
  `get_dashboard_summary` calls `build_summary_dashboard`, so all five
  dashboard tabs (Summary, Revenue, Cost, Customer, Inventory) plus health and alerts now have a matching tool.
- **Speed and cost.** One model call per click. Cache on (page, tab, focus, branch, date range, data
  freshness) so the same click is free the second time.

## Build order

1. ~~Fill the Revenue/Customer tool gap.~~ (done)
2. ~~Backend: the explain route, the short-answer prompt, the page → tool map.~~ (done, below.) Still to
   do: add explain-style questions to `backend/tests/eval/questions.json` and run the evaluation (it calls
   the real model, so it is run by hand).
3. ~~Frontend: state collection, the gesture and bubble, wired to the retail Dashboard only.~~ (done, below.)
4. Roll out page by page: Business Alerts, Import Health, wholesale Dashboard, Finance.

## Open questions

- ~~Click gesture~~: decided, an explain-mode switch.
- Is the page snapshot (`visible_text`) worth its token cost, or are `tab` + `focus` enough?
- Should the bubble remember the last few clicks in a session so "why is this lower than that one?"
  works?

## The backend as built

`POST /api/chat/explain` (`routers/chat.py`, same `require_assistant_access` gate as every chat route).

- **Request** (`schemas.chat.ExplainRequest`): `context` (branch, date range, `page` — the app's section
  id such as `dashboard`, `businessAlerts`), `tab`, `focus` (≤300 chars), `focus_title`, `visible_text`
  (≤4000), `language` (`en`/`my`). **Response**: `answer`, `follow_ups` (≤3), `sources` (the tools'
  citations, with the page `route`), `cached`. A failure is `{detail, code}` with the chat panel's codes.
- **One agent path.** `chat/explain.py` runs `stream_chat` with an `AgentProfile` (`agent.py`): the short
  answer prompt, no `run_query`/`describe_data`/`show_chart`, and `recursion_limit = 7` (two lookups and
  the answer). Hitting the cap gives a plain "open the assistant" reply, not an error. The figure checks
  of [assistant.md](./assistant.md) still apply; figures printed in the screen text count as told, so the
  bubble may repeat what the user is looking at.
- **Page → tool map** (`WHERE_TO_LOOK`, keyed by page and tab) is put in the question as "Where to look".
  A page or tab not in the map still works; the model just picks the tool itself.
- **Screen text is data.** It is fenced in `<screen>` and the prompt says never to follow it (a product
  name is free text from the POS import).
- **Cache** (`response_cache`): key = who (branch scope), the whole request, today, and the branch's import
  data version, so a new import or a new day means a new answer. A failed call is never cached.
- **Usage** is saved as kind `explain` and shows under "Explain" on the Usage report; a cache hit costs nothing.
- Not saved as a conversation, so "Expand" (bubble → full panel) will need the exchange sent along as
  the first messages of a new thread. That belongs to the frontend step.
- Tests: `backend/tests/test_chat_explain.py`.

## The frontend as built

All in `frontend/renderer/src/components/features/explain/`.

- **Switch.** `ExplainToggle` (`ExplainToggle.tsx`, `aria-pressed`) sits in the app header beside the
  refresh button (`shell/AppShell.tsx`). Its icon is the pet the person chose (cat or robot, from
  `chat/petKind.ts`, the one place that remembers the choice). It renders only for `admin`/`development`
  and only on a page that takes part. Off = the page is exactly as before. On = cards outline on hover
  (`globals.css`, `body[data-explain-mode="on"]`) and the cursor becomes a help cursor.
- **The pet goes on duty.** While the mode is live, the floating pet (`chat/ChatLauncher.tsx`) shrinks
  (`PERCH_SCALE`) and walks to the icon's slot in the header (`[data-explain-perch]`, found by query and
  kept current with a `ResizeObserver`); the picture in the switch fades out because the pet is sitting
  there, and it waves on arrival (and again when it is back home). Turning the mode off, or leaving a page that takes part, sends it back
  to where the person left it (the saved position is never overwritten). While it sits there it cannot be
  dragged, and **clicking it turns Explain off** instead of opening the chat. The walk, there and back, is
  animated only for about half a second after the mode changes (the flag is raised during render, not in an
  effect, or the way back would jump), so dragging stays immediate; reduced-motion settings
  skip the animation. The chat panel stays where it was and can still be opened from the bubble's
  "Continue in the assistant". Geometry: `chat/petPerch.ts` (tested).
- **What can be explained.** Every `Card` (`ui/Card.tsx`) and the Summary tab's `DrilldownCard` carry `data-explain=""`, so a stat tile, a
  chart card or a table card is explainable with no per-element work. The nearest card wins. The mode only
  acts on a page that has opted in, so cards elsewhere are untouched.
- **A page opts in** with `useExplainScreen({tab, branchId, dateFrom, dateTo})`
  (`explainContext.ts`). The Dashboard reports its tab, branch and applied date range; the page id is the
  app's section id, given by `App.tsx`. A new page needs that one hook call and an `<ExplainToggle />`.
- **The click** (`ExplainProvider.tsx`, a capture-phase listener on `document`): on a card it stops the
  click, reads the card's text (`focus`), its heading (`focus_title`) and the text of `<main
  data-app-content>` (`visible_text`), and posts to `POST /api/chat/explain` (`explainHelpers.ts` builds the
  body and trims everything to the server's limits). A click elsewhere closes the bubble; so does Escape,
  switching the mode off, or changing page, tab, branch or dates. A newer click cancels the older request.
- **The bubble** (`ExplainBubble.tsx`): the short answer, up to three follow-up chips, and "Continue in the
  assistant". It sits below the card (above if it does not fit) and stays inside the window. A long answer
  scrolls inside it (title bar and hand-over link stay put), and it can be dragged by its title bar like the
  pet (`clampBubble` keeps it in the window); it keeps its dragged spot when the language changes, and a click
  on another card opens a fresh bubble beside that card.
- **Hand-over to the assistant.** A chip or "Continue" calls `onAskAssistant`, which `App.tsx` passes to
  `ChatLauncher` as `askRequest`; the launcher opens the chat and `ChatPanel` sends the question, written
  as the question plus "about: <the card's text>". This starts from the clicked card, not from the bubble's
  own answer (the explain route saves nothing to carry over), and it continues the open thread.
- **Wiring.** `shell/AppProviders.tsx` wraps the app in the density and explain providers, so `App.tsx`'s
  JSX did not need another nesting level.
- Tests: `explainHelpers.test.ts` (request body, trimming, bubble placement, hand-over text). The click
  handling and the bubble are not unit-tested; they need a browser.

### Language

The bubble has an **EN | မြန်မာ** switch in its header. Only English and Burmese are offered. The choice is
kept in `localStorage` (`branchwise-explain-language`, English by default) and sent as `language`; the
backend tells the model to answer in standard Myanmar Unicode, never Zawgyi. Changing it re-asks the same
card in the other language (a different cache entry, since the language is part of the request). The
follow-up chips come back in the same language. Only the answer is translated: the page's own labels are
not, and "Continue in the assistant" opens the chat, which answers in the language the question is
written in. The Burmese wording is the model's, and has not been checked by a Burmese reader.

### How the answer is written

The model writes the answer however reads best, in light Markdown (a bolded key figure, short paragraphs, a
short bullet list only for several separate points), and the bubble renders it with the chat's own
`ChatMarkdown`, so it is styled like the assistant's answers and is safe the same way (no HTML, no links).
The prompt keeps it short and bans headings, tables, emoji and links. There is no fixed template, so
two answers may look different; that is intended.

## Pages that take part

| Page | Opted in by | What is explainable | Tool it looks at |
|---|---|---|---|
| Dashboard, every tab (Summary, Health, Revenue, Cost, Inventory, Customer) | `DashboardPage.tsx` | Every `Card`; the Summary tab's `DrilldownCard`; on Health, the branch and wholesale score cards (`OverviewTab.tsx`), each dimension card and each small measure tile inside it, such as Revenue growth or Order growth and Received (`HealthDimensionCard.tsx`), and the "Recommended decisions" card and its items (`DecisionsCard.tsx`) | see the table in "What the backend does" |
| Wholesale Dashboard, every tab (Summary, Health, Revenue, Cost, Inventory, Customer) | `wholesale/monitoring/MonitoringDashboardPage.tsx` | Every `Card`/`StatTile`; on Health the same dimension cards and measure tiles as retail | Health: `get_wholesale_health` (every measure with its calculation); Revenue, Cost, Inventory and Customer: `get_wholesale_revenue`, `get_wholesale_cost`, `get_wholesale_inventory`, `get_wholesale_customers` (the tab's period part and its open part); Summary: `get_wholesale_summary` |
| Import hub (Import, History, Import Health tabs) | `retail/ImportHubPage.tsx` | Every `Card` on the tabs; the tab and the branch are reported | `get_import_status`; on Import Health also `search_knowledge` for what a check means |
| Data overview (Sale, Inventory, Purchase, Salary, ...) | `retail/DataOverviewTable.tsx` | A column header or a row of each table | `calculate_metric` with `sales_summary` or `purchase_summary`, and `get_current_stock` for inventory |
| Reorder items | `retail/PurchasingPage.tsx` | A column header or a row (one product) | `get_reorder_list` (same service as the page; the rules are in the calculations guide, section 13) |
| Import History and Import Health | `retail/ImportHistoryTable.tsx`, `retail/ImportHealthPage.tsx` | History: column or row; Health: each branch card and each issue line | `get_import_status` |
| Data Quality (Warnings) | `retail/WarningsPage.tsx` | Every `Card`; the active tab (Inventory, Sale, Purchase, ...) is reported | `get_data_quality_warnings` |
| Wholesale Customers, Suppliers, Products | `wholesale/{customers,suppliers,products}/*Page.tsx` | Every `Panel`/`FigureCard` (`wholesale/shared/ui.tsx`) and every table column or row | `get_wholesale_customers_owing`, `get_wholesale_suppliers_owed`, `get_wholesale_inventory` |
| Wholesale order page and voucher page (a voucher's Shipped, Arrived and Moved tabs are in it) | `wholesale/orders/SalePage.tsx`, `wholesale/vouchers/PurchasePage.tsx` | Every `Panel`/`FigureCard` and every table column or row | `get_wholesale_record` (`chat/wholesale_records.py`): the page reports its kind and reference as the tab (`order ORD-...`, `voucher VCH-...`); the tool calls the same list functions the pages' endpoints use, so a voucher also gives its shipments and receivings |
| Import review and a batch's detail page | `retail/ImportReviewPage.tsx`, `retail/ImportHistoryDetailPage.tsx` | The previewed rows and columns; the batch summary | The row and its Note; `get_import_status` |
| Settings and Knowledge | `settings/SettingsPage.tsx`, `knowledge/KnowledgePage.tsx` | Every `Card` and table row | Settings: `get_app_settings` (the value in force, never the knowledge base) |
| Wholesale forms: new order, new voucher, What to buy | `orders/NewSalePage.tsx`, `vouchers/NewPurchasePage.tsx`, `vouchers/WhatToBuyPage.tsx` | Panels and table rows/columns (typing in a field behaves as usual) | `get_wholesale_inventory`, `get_wholesale_next_steps` (`TAB_HINTS` in `explain.py`) |
| Wholesale Today | `wholesale/today/WholesaleTodayDashboard.tsx` | Every `Card` (Deliver, Money, Receive, Buy, ...) | `get_wholesale_next_steps` (the same lists the cards show) |
| Business Alerts | `BusinessAlertsPage.tsx` | Each alert in the list, the alert's detail pane, and its "Why this alert" and "Recommended Action" boxes | `get_business_alerts`, found by the alert's title |

Business Alerts reports its category tab and the branch filter. Its buttons, filters and the detail pane's
actions do nothing while the mode is on (the click explains instead); switch the mode off to use them.

A card-like element that is not a `Card` is not explainable until it carries `data-explain=""`; that is
the whole job for a new page, plus the one `useExplainScreen` call.

A small measure tile on a Health card is explained from the same tool as its card: `get_branch_health`
(for one branch) and `get_wholesale_health` both list every scored measure with its points and the figures it
was worked out from, so "why is Orders ready to send 40 points" is answered from the calculation, not from a guess.

## Tables

A table is never sent whole. `Th` and `Tr` in `ui/Table.tsx` opt in to explain mode: clicking a column header sends that column's name plus one example value, clicking anywhere on a row sends that one row as "Header: value" pairs. Both send only the column names as screen text (`tableClick` in `explainHelpers.ts`). The prompt tells the assistant to explain the column or the row and never summarise the table.

Not covered on purpose: User Management. Its rows are staff names and e-mail addresses, which should not be sent to the language model for a page whose meaning is obvious.

## How the answer is written and delivered

- **Audience**: a shop owner or staff member, not a finance or technical person. The prompt asks for short, calm, precise answers (no slang, no jokes), enough to understand without opening anything else, and to explain an unfamiliar word once in brackets.
- **Answer first**: the first sentence is the conclusion with the key figure in bold; the reason follows. If the figures do not show a reason, it says so in one sentence and stops.
- **A shape per click**: a number or card (conclusion, then one or two sentences; a comparison in one line), a row (up to five "Field: meaning" lines and one summary sentence), a column (a definition and an example), an alert (why it appeared with its figures, then "What to do").
- **Steps while it works**: the bubble calls `POST /api/chat/explain/stream` (Server-Sent Events, read with `chat/stream.ts`) and shows the last three steps ("Looking at ...") until the answer arrives. The answer itself is not typed out word by word: it is checked against the tools' figures first (`grounding.py`), so it is only shown once complete. The plain `POST /api/chat/explain` still exists and gives the same answer; both share one cache, so a repeated click is instant.
