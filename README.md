# Accessible service-request form — a working fix for a CAPTCHA that locks out disabled users

**Live demo:** https://barkleesanders.github.io/accessible-gov-form-demo/
**Why this exists:** a state road-hazard reporting form (`csr.dot.ca.gov`) can only be
submitted by completing a Google reCAPTCHA, with **no accessible alternative** — so a
disabled person cannot report a hazard at all. This repo shows that the accessible fix
is small, standard, and shippable in an afternoon.

It contains:
1. A **working, accessible** service-request form (`index.html`) using **Cloudflare Turnstile**.
2. The **server-side verifier** (`verify-worker.js`) — the piece that actually stops spam.
3. A **code-level breakdown** of the reverse-engineering that proved the barrier (below).

Nothing here is exotic. It is the ordinary way to do bot protection without excluding people.

---

## The barrier, at the code level

All findings below were taken from the **live** production page (`https://csr.dot.ca.gov/`)
by reading its own client JavaScript and DOM — no server was touched. Reproduce with any
browser's DevTools.

### 1. The reCAPTCHA is the sole submit gate
```
<iframe src="https://www.google.com/recaptcha/...">   // present on the page
data-sitekey = "6LdqJkoUAAAAAKRfVdCoDawQEnJDLVhSpLKxSstc"
```
`g-recaptcha-response` is empty until a human solves the challenge; the form's submit
depends on it. A user who cannot complete the visual **or** audio challenge is stopped
here, and the page offers no other way to file a hazard report.

### 2. There is no accessible alternative channel
- The "Other Service Request" option calls `getTypeCodeInfo()`, which POSTs the type code
  to `index.php/Msrsubmit/getTypecodeLink/`. A non-empty response is treated as an email
  address and the page opens a `mailto:` — for "Other" that address is a **web-administration
  mailbox that creates no ticket**. (The agency confirmed by email it does not process these.)
- The agency **does** run a captcha-free web form — its ADA *grievance* form — proving the
  accessible pattern is feasible. But that form is scoped to physical-infrastructure barriers
  and does **not** accept hazard/service reports.

### 3. A dead validator that looks like a wall but isn't
The page defines `validateMobileForm()` whose body includes a "must be on the State Highway
System" check and a "please wait… re-submit again" timer. **It is never called and never bound**
(no `onsubmit`, no handler), and it would throw on its first line at runtime:
```js
function validateMobileForm(){
  document.getElementById('uid').value = getcustUID();  // getcustUID is undefined; #uid does not exist
  ...
}
```
Verified live: `typeof getcustUID === "undefined"`, `document.getElementById('uid') === null`.
It is leftover code from a retired mobile client. The *real* gates are the reCAPTCHA, the
type-routing `getTypeCodeInfo()`, and the "possible duplicate" `alert()` fired off the map pin.
**Reading a function's body proves capability; only checking that it is reachable proves behavior.**

### 4. The full client API surface (read-only lookups only)
No published spec (`robots.txt`, `sitemap.xml`, `openapi.json` all 404), so the client's own
calls are the complete surface:
```
POST index.php/Msrsubmit/getAllOpenTicketsLatLng/   {countyName}   -> open tickets (the duplicate check)
POST index.php/Msrsubmit/getTypecodeLink/           {typecode}     -> ''|email|url routing
POST index.php/Postmileq/pxy                         {lat,lng}      -> county/route/postmile
GET  index.php/Msrsubmit/getRoutes|getCounties|getDirection|getEntities
```
Every one is a read-only helper. **There is no captcha-free submit endpoint** — the ticket
submit is the form POST to the site root, gated by the reCAPTCHA. (One trap worth noting:
`getAllOpenTicketsLatLng` wants the full county **name** — `countyName=Marin` returns data;
the Caltrans **code** `MRN` returns `[]`, which looks like "no tickets" but means "asked wrong.")

---

## The fix (this repo)

### Front end — `index.html`
- **Cloudflare Turnstile** instead of reCAPTCHA. Turnstile is non-interactive for most users
  (no image grids), ships screen-reader support, and offers an accessible challenge when one is
  needed. The demo uses Cloudflare's **test sitekey `1x00000000000000000000AA`** (always passes),
  so the page works out of the box.
- **Honeypot field** (`company`, visually hidden and `aria-hidden`) — catches bots at zero
  accessibility cost, and reduces how often any challenge is even shown.
- **Real accessibility**: `<label>` on every control, `aria-required`, an error **summary with
  in-page anchor links** that moves focus (WCAG 3.3.1/3.3.3), a skip link, keyboard-only operable,
  and a **text location field** so the map is optional, not required (WCAG 2.1.1).

### Back end — `verify-worker.js` (Cloudflare Worker)
- Verifies the Turnstile token server-side via `siteverify` (the actual gate).
- Re-checks the honeypot and re-validates required fields server-side (never trust the client).
- Hooks marked for per-IP rate-limiting and hand-off to the real ticketing backend.

### Defense-in-depth Caltrans could layer (all accessible)
| Layer | What it stops | Accessibility cost |
|---|---|---|
| Cloudflare Turnstile | automated form spam | ~none (non-interactive, SR-supported) |
| Honeypot field | naive bots | none (hidden from AT) |
| Server-side `siteverify` | forged/replayed tokens | none |
| Per-IP + per-session rate limit (KV/Durable Object) | floods | none |
| Cloudflare WAF managed rules / Bot Management | known-bad traffic at the edge | none |
| A monitored **phone / TTY / relay** intake as a fallback | anyone a challenge still blocks | none — it's the alternative channel |

The point: **none of these require excluding disabled users.** reCAPTCHA-with-no-alternative is
the one choice on this list that does.

---

## Run it

```bash
# front end — any static host (this repo auto-serves via GitHub Pages)
open index.html

# back end — Cloudflare Worker
npm i -g wrangler
wrangler secret put TURNSTILE_SECRET   # demo/test value: 1x0000000000000000000000000000000AA
wrangler deploy
```

## Standards this maps to
- **ADA Title II**, 28 C.F.R. §35.130(b)(7) (reasonable modifications), §35.160 (effective communication)
- **28 C.F.R. §35.200 / §35.202** — WCAG 2.1 Level AA incorporated by reference; compliance date
  for large public entities was **April 24, 2026**.
- **Section 504**, 29 U.S.C. §794 (recipients of federal financial assistance)

## License
MIT — see `LICENSE`. Built as a public-interest demonstration.
