# Personal Finance Tracker — Revised Build Plan

## Context

You handed me a build plan for a local, single-user finance tracker and asked me to review it, adjust it, and add a visual direction: clean Apple-style UI, bright unique colors, fun to use, easy to extend. Your answers to my questions:

- **Several accounts across mixed banks** → the column-mapping wizard, profile auto-detection and dedupe are the Phase 1 centerpiece, not an afterthought.
- **Light, airy, color-coded categories; light mode only for now.**
- **Next.js + Tailwind + shadcn/ui.**
- **Runs on your computer, opened like an app.** Not Vercel (Vercel is hosting, and its servers have no persistent disk for a SQLite file).

The directory is empty, so this plan doubles as the spec. After approval, step one is saving it into the project as `docs/PLAN.md`, then starting Phase 1.

---

## Review verdict

The original plan is strong. The product principles, transfer detection, recurring detection, and the "awareness before budget" gating are exactly right and I kept them verbatim in spirit. What I changed:

| # | Change | Why |
|---|--------|-----|
| 1 | **Trimmed the category tree from ~40 leaves to 26.** | Section 6 of your own plan says keep it under ~25; the tree in 2.2 violates that. |
| 2 | **Money stored as integer cents, dates as ISO strings.** | Floats silently corrupt sums; JS Date + timezones silently shift days. Both are on your "goes wrong" list but had no fix. |
| 3 | **Import preview + undo import + auto-backup before import.** | Import is the one place a mistake poisons everything downstream. Preview catches sign/date mistakes before commit; undo makes any mistake free. |
| 4 | **Fuzzy-duplicate flagging (not auto-skip).** | Pending→posted transactions change date/description, so exact-hash dedupe misses them. Flag "possible duplicate" for review instead of guessing. |
| 5 | **Bank-profile auto-detection by header signature.** | With mixed banks, "app figures out the bank" needs a mechanism. Header signature is cheap and reliable. |
| 6 | **Refund netting spelled out.** | Was listed as a pitfall with no design. |
| 7 | **Added a full design system section** (tokens, palette, type, motion, layout, IA). | Your main new requirement. Doing this first keeps every later screen consistent. |
| 8 | **"Opened like an app" done cheaply in Phase 1; real Tauri packaging deferred to Phase 6.** | A launcher that opens Edge/Chrome in `--app` mode gives a chromeless window with a taskbar icon in an hour. Tauri + Next.js server actions needs a bundled Node sidecar; worth it later, not now. |
| 9 | **Seed dataset generator promoted to a first-class Phase 1 deliverable.** | You can't design the insight screens against an empty DB, and it exercises transfers, refunds, recurring bills and splits from day one. |
| 10 | **Data-model tweaks:** category color/icon, `imports.file_hash`, `rules.hit_count`, integer cents, transfer pairing table. | Small additions that the features above need. |
| 11 | **Safe-to-spend definition tightened.** | Original formula ignored bills due before payday. |

Everything else (principles, feature list, phases, post-MVP list, pitfalls, Actual Budget note) stands.

---

## 1. Product principles (unchanged)

1. Import must be painless. Drag a file, app figures out the bank, dedupes, done. Under a minute a month.
2. Categorization must be mostly automatic. ≥90% via rules after month one; review leftovers on one screen.
3. Show reality before asking for a budget. No budget numbers until 2–3 months of actuals exist.
4. One honest number: "safe to spend until next payday."
5. A weekly ritual, not a dashboard. 10-minute review, streak-tracked.

Added:

6. **Every screen should be understandable in five seconds.** One headline number, one chart, one action. If a screen needs a legend to be understood, it has too much on it.
7. **Nothing destructive without undo.** Imports, categorizations, rule creation, splits: all reversible.

---

## 2. Design system

### Feel
Apple Settings / Wallet / Fitness, light mode. Large rounded white cards on a soft gray canvas, generous whitespace, one bright accent color per category used everywhere that category appears. Calm by default; color carries meaning, never decoration.

### Tokens (Tailwind theme + CSS variables)

| Token | Value | Use |
|-------|-------|-----|
| `bg-canvas` | `#F5F5F7` | page background |
| `bg-card` | `#FFFFFF` | cards, sheets, table surfaces |
| `bg-subtle` | `#EFEFF4` | secondary fills, hover rows, input backgrounds |
| `text-primary` | `#1D1D1F` | headlines, amounts |
| `text-secondary` | `#6E6E73` | labels, metadata |
| `text-tertiary` | `#AEAEB2` | placeholders, disabled |
| `accent` | `#0A84FF` | primary buttons, links, focus rings, selected states |
| `positive` | `#34C759` | income, under budget |
| `negative` | `#FF3B30` | overspent, errors |
| `warning` | `#FF9500` | approaching limit, needs review |
| `radius-card` | `20px` | cards |
| `radius-control` | `12px` | buttons, inputs, chips |
| `radius-pill` | `999px` | category chips, progress bars |
| `shadow-card` | `0 1px 3px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.04)` | resting cards |
| `shadow-float` | `0 12px 40px rgba(0,0,0,.12)` | dialogs, popovers, command palette |

Light-only now, but every color goes through a CSS variable so dark mode later is a token swap, not a rewrite.

### Category palette (Apple system colors)
Each top-level category owns one color and one SF-Symbol-style icon (Lucide). Subcategories inherit the parent color at reduced tint. The same color is used in chips, chart segments, progress bars, and the category picker, so the user learns "orange = Food" once.

| Category | Color | Hex |
|----------|-------|-----|
| Income | Green | `#34C759` |
| Home | Blue | `#007AFF` |
| Car & Transport | Indigo | `#5856D6` |
| Food | Orange | `#FF9500` |
| Bills & Subscriptions | Purple | `#AF52DE` |
| Health | Red | `#FF3B30` |
| Shopping | Pink | `#FF2D55` |
| Fun | Yellow | `#FFCC00` |
| Gifts & Giving | Teal | `#30B0C7` |
| Debt | Brown | `#A2845E` |
| Savings & Investing | Mint | `#00C7BE` |
| Transfer | Gray | `#8E8E93` |
| Uncategorized | Gray, dashed outline | `#C7C7CC` |

Tints: `color/12` for chip backgrounds, `color/24` for hover, full color for text/icon/bars.

### Typography
- **Inter** via `next/font` (SF Pro isn't licensable; Inter is the closest metric match and looks right on Windows).
- All amounts use `font-variant-numeric: tabular-nums` so columns align.
- Scale: display 40/44 semibold (hero numbers), title 28/34, headline 20/25 semibold, body 15/20, caption 13/18, micro 11/13. Tight tracking on display sizes (`-0.02em`).
- Negative amounts render as `−$42.10` (true minus, not hyphen), positive income as `+$1,240.00` in green.

### Motion
- Framer Motion. Spring `{ stiffness: 400, damping: 30 }` for sheets, popovers, list reorders.
- Numbers count up on first render (hero amounts only).
- Progress bars animate width on mount and on change.
- Review queue: categorized rows slide out; the next row slides up. This is the "fun to use" moment; make it satisfying.
- Respect `prefers-reduced-motion`.

### Layout & navigation
- Left sidebar (240px, collapsible to icons) with: **Home, Review** (badge = count), **Transactions, Insights, Bills, Budget, Goals, Settings**. Budget and Goals are hidden until the awareness gate opens (≥2 months of data), shown as a locked item with "unlocks after 2 months of data" so the user knows they exist.
- Content area max-width 1200px, 24px gutters, 12-column grid for cards.
- Command palette (`⌘K` / `Ctrl+K`): jump to a screen, search transactions, "import file", "new rule".
- Review screen is keyboard-first: `1–9` pick a suggested category, `/` to search categories, `S` split, `T` mark transfer, `Enter` accept, `→` skip.
- Every table is virtualized (TanStack Table + Virtual) so 20k transactions scroll at 60fps.

### Empty states and first run
- First launch: a single centered card, "Drop a bank statement here," with the three supported formats as pills. No sidebar clutter until data exists.
- Every empty screen has one sentence and one button. No illustrations of sad folders.

### Charts (Recharts, styled through tokens)
- Category donut on Insights; horizontal stacked bar for month-over-month; waterfall for cash flow; sparklines in Bills rows.
- No gridlines heavier than `bg-subtle`, no axis clutter, tooltips as floating white cards.

---

## 3. Core feature set (MVP)

### 3.1 Statement import
- **Formats:** CSV (Phase 1), OFX/QFX (Phase 1, since mixed banks; the parser is ~150 lines), PDF (post-MVP).
- **Bank profiles:** column mapping + date format + sign convention. Ship with Chase (card and checking), BofA, Wells Fargo, Capital One, Amex, Discover, and Citi; credit-union exports go through the wizard once and are remembered. **Auto-detect by header signature** (sorted set of column names hashed); on miss, open the mapping wizard and save the result as a new profile named after the file.
- **Import flow:** drop file → detect profile → **preview table** (first 20 rows parsed, with "purchases show as negative, is that right?" and a date-format check that scans for any day > 12 to disambiguate MM/DD vs DD/MM) → choose account → commit → toast "12 new · 40 duplicates skipped · 2 possible duplicates flagged" → **Undo** button in the toast.
- **SimpleFIN bridge (Phase 8):** connect once in Settings → Connections with a setup token, map each SimpleFIN account to an app account, and transactions, pending items and balances arrive through the same pipeline (dedupe, rules, transfers, recurring). CSV/OFX import stays as the fallback.
- **Auto-backup:** copy `finance.db` to `data/backups/finance-YYYYMMDD-HHMMSS.db` before every import. Keep the last 20.
- **Dedupe:** `sha256(account_id | date | amount_cents | normalized_description)` with a UNIQUE index. Also reject a file whose `file_hash` was already imported.
- **Fuzzy duplicates:** same account, same amount, normalized description similar (Jaro-Winkler ≥ 0.85), date within ±3 days, not an exact-hash match → import, but flag `possible_duplicate = true` and surface in the review queue with "keep both / merge."
- **Accounts:** checking, savings, credit, cash, loan, investment. Credit card payments detected as transfers (see below), never spending.
- **Transfers:** opposite-sign, equal-amount pairs across two accounts within ±3 days → mark both `is_transfer` and link via `transfer_pairs`. A narrow rule-based fallback covers one-sided moves between the user's **own** accounts only (bank wording like "ONLINE TRANSFER TO/FROM CHK …", "ACH XFER", and the card-side "PAYMENT THANK YOU"). Everything paid to a third party is spending, not a transfer: Zelle/Venmo/PayPal to people, and payments to cards or apps the user chose not to import (Card payments, Savings & investing, Loan payments).

### 3.2 Cleanup and categorization
- **Merchant normalization:** ordered pipeline of regex strips (`SQ *`, `TST*`, `POS DEBIT`, `CHECKCARD`, store numbers, trailing city/state, dates, `#1234`, phone numbers), then title-case, then an alias table (`AMZN`, `AMAZON MKTPL` → Amazon). Store `raw_description` and `merchant`. Unit-tested against a fixture file of 100 real-shaped descriptions.
- **Rules engine:** ordered by priority; match on merchant contains/regex, amount range, account, and direction (money in / money out / any; builtin income rules are money-in only). First match wins. Changing a category on the Transactions screen offers "Apply to all" for that merchant, which writes the rule and recategorizes every matching row with an Undo. Created from the review screen ("Always categorize Kroger as Groceries?"). Track `hit_count` and `last_hit` so dead rules can be pruned.
- **Category tree (26 leaves):**

| Parent | Leaves |
|--------|--------|
| Income | Paycheck · Side income · Other income |
| Home | Rent/Mortgage · Utilities · Insurance · Repairs & household |
| Car & Transport | Fuel · Car payment & insurance · Repairs, parking & transit |
| Food | Groceries · Restaurants · Coffee & takeout |
| Bills & Subscriptions | Phone & internet · Subscriptions · Gym & memberships |
| Health | Medical & pharmacy |
| Shopping | Clothing & personal care · General (Amazon, Target) |
| Fun | Entertainment · Hobbies · Travel |
| Gifts & Giving | Gifts & giving |
| Debt | Loan payments · Card payments (to cards not imported) · Interest & fees |
| Savings & Investing | Savings & investing |
| System | Transfer · Uncategorized |

  User can rename or add leaves, but the UI shows a soft warning past 30.
  Groups can be added, renamed, recolored (palette only) and archived once
  empty; user groups are expense-kind and sort before the system groups.

- **Refunds:** a positive amount on a credit/checking account whose merchant matches a prior negative transaction within 90 days inherits that transaction's category, so returns net against the original spend. Flagged in review with "refund of $X from Amazon on Mar 3?" for confirmation.
- **Splits:** one transaction → N category rows summing exactly to the parent amount (validated in cents).
- **Review queue:** uncategorized, low-confidence, possible-duplicate and suspected-refund rows in one list. Each row shows three suggested categories as numbered chips (from rules, prior categorizations of the same merchant, and parent-category frequency). Keyboard-first per §2.
- **Optional LLM assist:** off by default, setting-gated, batches ambiguous merchants to Claude for a suggestion. Never required.

### 3.3 Understanding spending (awareness)
- **Insights:** month picker; donut by parent category; drill into leaves; each shows this month, last month, and the average over the last 3 complete months (labeled with the count; "—" when none). *Spent* means fixed + variable everywhere (hero, donut, table, Home); savings is shown beside it as signed net savings. The Transactions header is the gross "money out / money in" ledger view. *(Built 2026-09-06; 6/12-month averages deferred.)*
- **Top merchants:** by dollars and by count (distinct transactions), phrased "$340 at DoorDash across 19 purchases"; rows link to the filtered Transactions month.
- **Bills page (recurring detection):** series per merchant, direction and amount cluster (a merchant can carry several bills); small clusters need ≥ 4 points and ≥ 25% of the merchant's charges; weekly clusters need ≥ 6 points and either a majority share or amounts steady within $5 or 2%; fixed-category bills tolerate ±35%; two identical monthly charges show as "likely"; any transaction can be marked as a bill by hand; same-day duplicates collapsed; cadence from the median gap (weekly 5–9d, biweekly 11–17d, monthly 26–35d, quarterly 80–100d, annual 350–380d) with ≥70% of gaps in window and ≥70% of amounts within ±15% (±$5 under $30); ≥3 occurrences (2 for annual). Sections: Bills (header counts these, monthlyized total), Expected income, Ended, Dismissed. Row actions: not a bill, rename, category quick-pick (creates a whole-word rule). Detection refreshes after every import and mutation, plus a Refresh button; "New" badge within 45 days of first sight.
- **Cash-flow waterfall:** income − fixed − variable − savings = leftover, with a 6-month history table.
- **Fixed vs. variable:** `is_fixed` on categories; Insights and Budget both split on it.

### 3.4 Budget (discipline)
- **Gate:** unlocks at ≥2 full months of imported data. Locked state visible in sidebar.
- **Guided setup:** walk each variable category showing the 3-month average, pre-filled rounded up to the nearest $10. Fixed categories are pre-filled from recurring detection.
- **Method:** zero-based; income − assigned = "left to assign" shown at the top. 50/30/20 shown as a sanity strip below, not a separate system.
- **Monthly screen:** per category: budgeted, spent, remaining, progress bar in category color, overspent pinned to the top in `negative`.
- **Safe to spend:** `max(0, sum of remaining across variable categories − unposted recurring bills due before next payday) ÷ days until payday`. Bills whose category is a fixed leaf are not subtracted (their own budget line already reserves them); active bills whose expected date has passed without posting still count. Shown as the hero number on Home with its inputs on a details line. Payday schedule in Settings: weekly, biweekly (anchor date), semi-monthly (two days), monthly (day); inferred from the recurring paycheck until confirmed; without one the horizon is month end. *(Built 2026-09-06.)*
- **Rollover:** per-category toggle.
- **Goals / sinking funds:** target, date, monthly contribution derived; funded like a category.

### 3.5 Weekly review (ritual)
One guided screen (`/weekly`), five steps with a progress rail, under 10 minutes: import reminder (per-account staleness) → clear review queue (the review screen embedded in place) → overspend and pace check (budget used vs month elapsed, ±5 points) → bills due in 7 days (overdue first) → "adjust anything?" Weeks start Monday; one completion per week; the streak counts consecutive weeks back from the current or previous week; "review due" after 7 days shows as a dot in the sidebar and on the Home card. *(Built 2026-09-06.)*

---

## 4. Post-MVP (unchanged order)
Net worth *(built 2026-09-06: `/networth`, balances from statement balance columns on import plus manual entry, monthly series)* → debt payoff planner *(built 2026-09-06: `/debt`, APR and minimum per liability account, avalanche vs snowball with an extra-per-month knob)* → anomaly alerts *(built 2026-09-06: five detectors over the last 30 days, "Worth a look" on Home, `/alerts` with dismiss)* → annual spreading *(built 2026-09-06: planned expenses and detected quarterly/annual bills spread into monthly set-asides on Bills and Budget)* → cash-flow forecast *(built 2026-09-06: `/forecast`, 30/60/90-day projected cash from balances, detected paychecks and bills, planned expenses and the everyday spend rate, with a floor)* → exports *(built 2026-09-06: filtered transactions CSV from the Transactions screen; database backup download from Settings)* → PDF parsing → **Tauri desktop packaging** (added here). Multi-currency, shared budgets, mobile: out of scope.

- Household access *(built 2026-09-07: Cloudflare Tunnel + Access in front of the desktop, no login in the app; a hashed display token exempts the two display routes)*: `GET /api/wall` returns the glanceable summary to a bearer token and `/wall` renders it as a chromeless one-screen panel for an enrolled display. Setup lives in `docs/HOUSEHOLD.md`; the token is generated, rotated and revoked in Settings → Household.

---

## 5. Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Runtime | Node 20+, TypeScript strict | single process |
| Framework | Next.js 16, App Router, server actions | no separate API |
| DB | SQLite via **better-sqlite3 + Drizzle ORM** | `data/finance.db`, migrations in `drizzle/`, checked in |
| UI | Tailwind v4 + shadcn/ui + Lucide icons (Framer Motion arrives with the Phase 2 review queue) | tokens from §2 |
| Tables | TanStack Virtual (TanStack Table only when a screen needs column features) | |
| Charts | Recharts (added in Phase 3) | |
| Parsing | papaparse (CSV), small custom OFX/SGML parser | |
| Validation | zod at every boundary (file rows, server actions, settings) | |
| Tests | Vitest | pure logic only, see §7 |
| Lint/format | Biome | one tool, fast |
| Launch | `npm run app` | starts `next start` on :3000 and opens Edge/Chrome with `--app=http://localhost:3000` (chromeless window, its own taskbar icon). `npm run dev` for development. |
| Backup | `npm run backup` + auto-backup on import | |

### Money and dates (rules for all code)
- Amounts are `integer` cents everywhere in DB and logic. Format only at the edge with `Intl.NumberFormat`.
- Dates are `YYYY-MM-DD` text. No `Date` objects in the DB layer; use the hand-rolled string helpers in `src/lib/dates.ts` (no date-fns, so no `Date` creeps in). Statement dates have no time zone and must never gain one.
- Sign convention normalized on import: **outflows negative, inflows positive**, regardless of what the bank exports.

### Data model

```
accounts(id, name, type, institution, bank_profile_id, color, created_at)
bank_profiles(id, name, header_signature UNIQUE, date_col, desc_col, amount_col, debit_col, credit_col,
              balance_col, date_format, sign_convention[outflow_negative|outflow_positive|debit_credit_cols],
              skip_rows, builtin BOOLEAN)
imports(id, account_id, filename, file_hash UNIQUE, imported_at, row_count, new_count, dup_count, flagged_count,
        backup_path)
transactions(id, account_id, import_id, date, amount_cents, raw_description, merchant, category_id,
             is_transfer, possible_duplicate, suspected_refund_of, notes, dedupe_hash UNIQUE, reviewed, created_at)
transfer_pairs(id, from_txn_id, to_txn_id, confidence)
transaction_splits(id, transaction_id, category_id, amount_cents, notes)
categories(id, parent_id, name, kind[income|expense|transfer|system], is_fixed, rollover, color, icon, sort, archived)
merchant_aliases(id, pattern, match_type[contains|regex], merchant)
rules(id, priority, match_type[contains|regex], pattern, min_cents, max_cents, account_id, category_id,
      enabled, hit_count, last_hit)
budgets(id, month 'YYYY-MM', category_id, amount_cents, UNIQUE(month, category_id))
goals(id, name, target_cents, target_date, category_id, current_cents, archived)
recurring(id, merchant, category_id, avg_cents, interval_days, tolerance_cents, last_seen, next_expected,
          active, dismissed)
settings(key PRIMARY KEY, value JSON)
balance_snapshots(id, account_id, date, balance_cents)
weekly_reviews(id, completed_at, week_start)
```

### Folder layout

```
src/
  app/                      # routes: (app)/home, review, transactions, insights, bills, budget, goals, settings
  components/ui/            # shadcn primitives, restyled with tokens
  components/finance/       # AmountText, CategoryChip, ProgressRing, MerchantRow, ImportDropzone ...
  lib/db/                   # drizzle schema, client, migrations runner
  lib/import/               # csv.ts, ofx.ts, profiles/, detect.ts, dedupe.ts, preview.ts
  lib/money.ts              # cents helpers, formatting
  lib/dates.ts
  lib/normalize/            # merchant pipeline + aliases
  lib/rules/
  lib/transfers/
  lib/recurring/
  lib/budget/               # safe-to-spend, rollover, averages
  lib/seed/                 # fake dataset generator
  actions/                  # server actions, one file per domain
tests/                      # vitest, mirrors lib/
data/                       # finance.db, backups/ (gitignored)
docs/PLAN.md                # this document
```

---

## 6. Build phases

Each phase ends with something usable on real statements.

### Phase 1 — Data in
1. Scaffold: Next.js, Tailwind, shadcn, Biome, Vitest, Drizzle + better-sqlite3, `npm run app` launcher.
2. Design tokens, Inter, base layout shell (sidebar, canvas, card), `AmountText`, `CategoryChip`.
3. Schema + migrations + seed script (3 months, 2 checking-ish + 2 cards, salary, 12 recurring bills, transfers, 2 refunds, 1 split-worthy Costco run, some noise).
4. Accounts CRUD.
5. CSV + OFX parsers, built-in profiles, header-signature detection, mapping wizard, preview, commit, dedupe, fuzzy flags, undo, auto-backup.
6. Transfer detection.
7. Transactions screen: virtualized table, filters (account, date range, category, search), inline category edit.
8. First-run empty state.

### Phase 2 — Cleanup
Merchant normalization + aliases, category tree + seed categories with colors, rules engine, review queue with keyboard shortcuts and suggestions, splits, refund matching.

### Phase 3 — Insight
Insights screen, top merchants, recurring detection + Bills page, waterfall, fixed/variable.

### Phase 4 — Budget
Gate, guided setup, monthly screen, safe-to-spend, rollover, goals, payday settings.

### Phase 5 — Ritual
Weekly review flow, streak, Home screen assembly.

### Phase 6 — Extras
Post-MVP list in §4 order, ending with Tauri packaging.

**Gating:** Phase 3 can start right after Phase 2. Phase 4 should wait until you've imported real data for a couple of weeks and the review queue is mostly empty each week; budget quality is downstream of categorization quality.

---

## 7. Tests (what silently corrupts data)
Vitest, pure functions only, no UI tests in MVP:
- `dedupe.hash` stability and collision cases
- date-format disambiguation (MM/DD vs DD/MM, 2-digit years)
- sign-convention normalization for each profile type
- merchant normalization against the 100-row fixture
- transfer pairing (equal/opposite, ±3 days, no double-pairing)
- split sums in cents
- recurring interval detection with tolerance
- safe-to-spend arithmetic including bills before payday
- OFX parser on fixture files (Phase 1 ships one sample; add more bank samples over time)

---

## 8. Pitfalls guarded (mapping to your §6)

| Pitfall | Guard |
|---------|-------|
| Card payments as spending | transfer pairing + fallback rules → Transfer, excluded everywhere |
| Refunds not netting | refund matching (§3.2) |
| Pending vs posted duplicates | fuzzy-duplicate flag |
| MM/DD vs DD/MM | day>12 scan in preview, profile stores format explicitly |
| Sign conventions | normalized on import, preview asks the user to confirm |
| Too many categories | 26 leaves, soft cap at 30 |
| Budgeting before data | hard gate at 2 months |
| Float money | integer cents |
| Bad import | auto-backup + undo |

---

## 9. Verification (Phase 1 done means)
1. `npm run app` opens a chromeless window at the first-run screen.
2. `npm run seed` then reload: Transactions shows ~150+ rows, sidebar shows 4 accounts, transfers are marked, table scrolls smoothly.
3. Drop a real CSV from each of your banks: profile detected or wizard opens; preview shows correct dates/signs; commit reports counts; re-dropping the same file reports 0 new; undo removes them.
4. Drop two statements with overlapping date ranges: no duplicates.
5. `npm test` green.
6. Visually: cards, tokens, Inter, category colors match §2 on Home and Transactions.

