# Contributing

Thanks for helping improve Personal Finance Tracker. Bug reports, bank export
profiles, fixes and features are all welcome.

## What this project is (and isn't)

The app is **local-first and single-household**: one SQLite file on your own
machine, no accounts, no cloud backend, no telemetry. The only outbound network
calls are the optional SimpleFIN sync. Changes that keep that shape are the
easiest to accept. If you want to build something large — a new page, a new
data source, anything that touches the schema — open an issue or discussion
first so we can agree on the approach before you spend the time.

## The one hard rule: no real financial data

Issues, pull requests, tests, fixtures, screenshots and commit messages are
public forever. Never include real statements, account or card numbers,
names, addresses, merchants from your own history, or balances.

- Test fixtures use made-up merchants (`ACME CORP`), places (`SPRINGFIELD IL`)
  and numbers in the **same shape** as the real export.
- Screenshots come from `npm run seed` data.
- If an import bug only shows up with your file, trim it to the header plus a
  few rows and replace the values before sharing.

## Getting set up

You need **Node 24** and npm.

```bash
git clone https://github.com/gillespiejameson/personal-finance-tracker.git
cd personal-finance-tracker
npm install
npm run seed     # creates data/finance.db with 3 months of fake data
npm run dev      # http://localhost:3000
```

> `npm run seed` **wipes** the database it points at. If you also use the app
> for your own money, keep development on a separate file:
> `FINANCE_DB=./data/dev.db npm run seed` and `FINANCE_DB=./data/dev.db npm run dev`
> (PowerShell: `$env:FINANCE_DB="./data/dev.db"; npm run dev`).

## Before you open a pull request

```bash
npm run lint         # Biome (npm run format fixes most of it)
npx tsc --noEmit     # type-check
npm test             # Vitest
```

CI runs the same checks plus `npm run build` on every pull request, and `main`
only accepts changes through pull requests with green checks.

## How the code is laid out

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the directory map, the
import pipeline, the data model and "how to add…" recipes. `docs/PLAN.md` is
the original product and design plan.

This project runs **Next.js 16**, which differs from older versions in ways
that matter: middleware lives in `proxy.ts`, `searchParams` is a Promise, and
`"use server"` files may export only async functions. The docs that match the
installed version are in `node_modules/next/dist/docs/`.

## Conventions reviewers will check

- **Money is integer cents.** Never floats.
- **Dates are `YYYY-MM-DD` strings.** No local-time `Date` math; use the
  helpers in `src/lib/dates.ts`.
- **Server actions validate input with zod** and return `{ ok: true, ... }` or
  `{ ok: false, error }`.
- **No hex color literals under `src/components/`.** Use the design tokens and
  `src/lib/categories/palette.ts`.
- **Amounts render through `AmountText`** so digits line up.
- **No interactive elements nested inside other interactive elements.**
- **Every behavior change gets a test.** Logic lives in `src/lib/` where it
  can be tested against an in-memory database; don't weaken existing tests to
  make a change pass.
- **Schema changes** go through Drizzle: edit `src/lib/db/schema.ts`, run
  `npm run db:generate`, and commit the generated migration in `drizzle/`.

## Good first contributions

- **A bank export profile.** If your bank's CSV isn't recognized, add a
  built-in profile plus a synthetic fixture and a detection test.
- **Merchant cleanup cases.** A description that cleans up badly is a one-line
  fixture in `tests/fixtures/merchants.txt` plus the fix.
- Issues labeled [`good first issue`](https://github.com/gillespiejameson/personal-finance-tracker/labels/good%20first%20issue).

## Commits and pull requests

- Branch from `main`; keep each pull request to one change.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Describe what changed, why, and how you tested it. The template will prompt you.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
