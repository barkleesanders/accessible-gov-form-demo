# Hono + Cloudflare Workers — accessible service-request form

A **complete, deployable** road-hazard / service-request form that a public agency can copy
as-is. It is the working counterpart to the static demo in the parent repo: same accessibility,
but server-rendered by [Hono](https://hono.dev) on Cloudflare Workers with real server-side
verification. This is a standalone Worker — unrelated to any other site.

## What it does
- **GET `/`** — renders the accessible form (server-side, no client framework required).
- **POST `/submit`** —
  1. **Honeypot** check (silent accept-and-drop for bots).
  2. **Server-side field validation** (never trusts the client).
  3. **Cloudflare Turnstile** `siteverify` — the bot gate, accessible by design.
  4. On success, generates a tracking ref (`SR-XXXXXXXX`) and renders a confirmation.
     (Production TODO markers show where to persist to KV/D1 or POST to a ticketing backend.)

## Accessibility (WCAG 2.1 AA)
- Every field has a real `<label>`; required fields carry `aria-required="true"`.
- On error, a `role="alert"` **error summary** with in-page anchor links, and focus is moved to it (3.3.1).
- Invalid fields get `aria-invalid` + `aria-describedby` pointing at the message.
- Skip link, single `<h1>`, `lang="en"`, keyboard-only operable, visible focus ring.
- **Location is a text field** — the map is optional, so there is no drag-map or visual-only gate.
- **Turnstile** replaces reCAPTCHA: non-interactive for most users, screen-reader supported,
  with an accessible challenge when one is needed.

## Deploy it (an afternoon, start to finish)
```bash
npm install
npx wrangler login
npx wrangler secret put TURNSTILE_SECRET   # your Turnstile secret (test value: 1x0000000000000000000000000000000AA)
# edit wrangler.toml -> TURNSTILE_SITEKEY = your real sitekey (test: 1x00000000000000000000AA)
npx wrangler deploy
```
Local dev: `npx wrangler dev`. If your machine's outbound TLS is intercepted (so `siteverify`
can't be reached locally), add `--var DEV_SKIP_TURNSTILE:1` for local testing **only**. It is
off in production and the code fails **closed** (unverified → rejected, never a 500) if the
verify call ever errors.

## Verified behavior (local)
| Request | Result |
|---|---|
| `GET /` | 200 — accessible form (aria-required, Turnstile, skip link) |
| `POST /submit` missing fields | **422** + `role="alert"` summary listing each problem |
| `POST /submit` valid + verified | **200** + tracking ref `SR-XXXXXXXX` |
| `POST /submit` honeypot filled | 200, silently dropped (no ticket) |
| `POST /submit` bad/unreachable token | **422** verification error — fails closed, not 500 |

## Files
- `src/index.ts` — the whole app (~185 lines).
- `wrangler.toml` — Worker config + Turnstile sitekey var.
- `package.json`, `tsconfig.json` — Hono 4, TypeScript 5, strict.

MIT licensed (see parent repo `LICENSE`). Built as a public-interest reference.
