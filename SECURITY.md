# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through GitHub:
[**Report a vulnerability**](https://github.com/gillespiejameson/personal-finance-tracker/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with
it. Use made-up data in any proof of concept. You should get a first response
within a week. Once a fix is released, you'll be credited in the advisory
unless you'd rather not be.

## Supported versions

Only the latest commit on `main` is supported. There are no release branches.

## Threat model, in short

- The app is meant to run on your own machine for one household and has **no
  login of its own**. Anyone who can reach its port can read and change
  everything. Exposing it to a network without an authenticating layer in
  front (for example Cloudflare Access, as described in `docs/HOUSEHOLD.md`) is
  a configuration issue, not a vulnerability.
- The wall display endpoints (`/wall`, `/api/wall`) are protected by a display
  token and deliberately expose only a summary. Anything that lets that token
  read or change more than the summary **is** in scope.
- Also in scope: anything that leaks data from `data/finance.db` or the
  SimpleFIN access URL, or that lets a crafted CSV/OFX file or SimpleFIN
  response run code or write outside the database.
