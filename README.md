# Personal Finance Tracker

A local, single-user finance tracker. Drop a bank statement in, and it figures
out which bank it came from, normalizes the dates and signs, skips rows you
already imported, links transfers between your own accounts, and shows
everything in one searchable table. On top of that it categorizes with rules,
detects bills and paychecks, and adds budgets, a safe-to-spend figure, net
worth, debt payoff, a cash-flow forecast and anomaly alerts.

Everything runs and stays on your computer: there is no account and no cloud
service — the whole database is one SQLite file you can copy or delete. The
only network calls are the optional SimpleFIN bank sync described below.

## Requirements

Node 24. Then:

```
npm install
```

## Running it

| Command | What it does |
|---|---|
| `npm run app` | Builds if needed and opens a chromeless desktop-style window at `localhost:3000` (uses Edge or Chrome on Windows, Chrome on macOS, Chrome or Chromium on Linux; otherwise it prints the URL) |
| `npm run dev` | Development server with hot reload |
| `npm run seed` | **Wipes** the dev database and regenerates 3 months of realistic fake data |
| `npm run backup` | Snapshots the database into `data/backups/` |
| `npm test` | Vitest unit tests |

## Where the data lives

`data/finance.db` (SQLite, gitignored). Every import first copies the database
into `data/backups/finance-YYYYMMDD-HHMMSS.db`, keeping the last 20, and every
import can be undone from the toast that follows it.

## Importing statements

CSV and OFX/QFX are supported. Built-in profiles cover Chase, Bank of America,
Wells Fargo, Capital One, Amex, Discover and Citi; a file is matched to one by
its header signature, so a recognized bank imports with no questions asked.

When no profile matches, the mapping wizard opens: name the profile, pick the
date, description and amount columns (or separate debit/credit columns), say
whether purchases export as negative or positive, choose the date format, and
set how many junk rows sit above the header. The preview then shows the parsed
rows so you can check the dates and signs before committing, and the mapping is
saved as a profile once the import succeeds, so that bank is recognized next
time.

Duplicates are skipped by a hash of account + date + amount + description, the
same file cannot be imported twice, and near-matches (a pending row that later
posted) are imported but flagged for review.

## Connecting your banks (SimpleFIN)

Instead of downloading statements, connect SimpleFIN in **Settings →
Connections**: create a setup token at bridge.simplefin.org, paste it in, and
map each SimpleFIN account to one of yours. From then on **Sync now** (or an
automatic sync when Home is opened more than six hours after the last one)
pulls new transactions, pending items and balances through the same pipeline as
an import — dedupe, rules, transfers, recurring detection and net worth all
behave the same, and pending rows show a "pending" pill until they post. The
app never sees your bank passwords; the read-only access URL lives in
`data/finance.db` and **Disconnect** deletes it, keeping your transactions. CSV
and OFX import remain available for anything SimpleFIN does not cover.

## Household access and the wall display

The app has no login of its own. To reach it from outside the house, a
Cloudflare Tunnel publishes the desktop's port 3000 on a hostname you own and
Cloudflare Access lets in only the Google accounts you list. A wall display or
a separate dashboard reads the glanceable numbers instead through a **display
token**, generated in **Settings → Household** and shown once: opening its
enrollment link on a display enrols that browser for `/wall` (a chromeless
one-screen panel), and the same token as `Authorization: Bearer …` reads
`GET /api/wall`. Rotating or revoking the token cuts every display off at once.
`docs/HOUSEHOLD.md` has the full setup — tunnel, the two Access applications,
the display, the hub contract, backups and the LAN note.

## Security

The app is built for one household on one machine and has **no login of its
own**. Do not expose port 3000 to the internet directly; put it behind
something that authenticates, such as the Cloudflare Access setup in
`docs/HOUSEHOLD.md`. Never commit your `data/` directory.

## Contributing

Contributions are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) maps the code, and
`docs/PLAN.md` is the product and design plan the app was built from. Please
never post real bank data in issues or pull requests; security problems go
through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
