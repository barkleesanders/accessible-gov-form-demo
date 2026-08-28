# Accessible service-request form — a working fix for a CAPTCHA that locks out disabled users

**Live demo:** https://barkleesanders.github.io/accessible-gov-form-demo/
(Caltrans CSR layout + ImproveBayArea-style tap/drag map. Red **DEMO** bar so it cannot be mistaken for the official form. Map is optional; typed location is required.)
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
Live widget (this is the *entire* host-side setup):
```html
<script src='https://www.google.com/recaptcha/api.js' async defer></script>
<div class="g-recaptcha" data-sitekey="6LdqJkoUAAAAAKRfVdCoDawQEnJDLVhSpLKxSstc"></div>
```
Google injects a hidden `<textarea name="g-recaptcha-response">`. Native `#msrform`
`action=""` POSTs that token to `https://csr.dot.ca.gov/` with the rest of the fields.
The host JS never calls `grecaptcha.getResponse()`. A user who cannot complete the
visual **or** audio challenge cannot file a hazard report at all.

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

### 5. How they wired the captcha (setup bugs, not Google's iframe)

Google's [display API](https://developers.google.com/recaptcha/docs/display) gives the
site owner `data-callback`, `data-expired-callback`, `data-error-callback`, `data-tabindex`,
and `hl=`. Caltrans set **none** of those. Combined with the rest of the form, that is
what locks people out even after they "succeed":

| Defect | What happens |
|---|---|
| No `data-expired-callback` / `data-error-callback` / `data-callback` | Token is **one-use and ~2 minutes** ([Google verify](https://developers.google.com/recaptcha/docs/verify)). Google tells owners to reset the widget and tell the user. Caltrans is silent. Screen readers only hear "Verification expired" if they are still inside Google's iframe. |
| Client never checks the widget | Empty, expired, or missing token still native-POSTs `/`. Failure is HTTP **200 on the same form** (bounce, no ticket) — not an announced error (WCAG 3.3.1 / 4.1.3). |
| GIS race burns a good token | Pin drop → `Postmileq/pxy` → `$("#rte").change()` → `getDirection` → `$("select#dirTravel").replaceWith(...)`. That async rebuild can empty `dirTravel` *after* the box is checked. First POST bounces; the one-use token is already spent. Google's own help says **solve captcha last**. This map work fights that. |
| `allowSubmit = false` after first click | Bounce or expiry leaves Submit dead until a full reload, which also kills widget state. |
| Unlabeled `g-recaptcha-response` textarea | 1 of 13 controls has no name. Same WAVE miss as [google/recaptcha#421](https://github.com/google/recaptcha/issues/421). Host can set `aria-hidden` after render. They don't. |
| Drag-map is a second gate | Even a passed checkbox still hits `alert('Put the map marker on a valid location…')` + `preventDefault`. Keyboard / AT users fail WCAG 2.1.1 here. The alert is not `aria-live`. |
| ADA Grievance "link" has no `href` | `<a onclick='openinNewBrowser("https://adapt.dot.ca.gov/grievance/newRequest");'>` — no `href`. The one accessible intake they advertise fails 2.4.4 / 4.1.2. |
| No `noscript`, no `hl=`, no host iframe title, no `data-tabindex` | The map has a noscript message; the captcha does not. |

Google's official "ADA way" is **not a skip token**. It is (1) a lucky checkbox auto-pass for
trusted Google Chrome cookies, or (2) the audio challenge ([reCAPTCHA Help → Accessibility](https://support.google.com/recaptcha/?hl=en)).
hCaptcha ships an [accessibility cookie](https://www.hcaptcha.com/accessibility) that actually
bypasses the puzzle. **reCAPTCHA has no equivalent site-owner flag.** Audio is what people
report as blocked:

- [google/recaptcha#418](https://github.com/google/recaptcha/issues/418) — audio selectively disabled: "Your computer or network may be sending automated queries." Visual grid still offered. Workaround people report: stay logged into Google in Chrome — the opposite of an AT path.
- [#422](https://github.com/google/recaptcha/issues/422) "Download audio" link broken; [#423](https://github.com/google/recaptcha/issues/423) VoiceOver replay; [#450](https://github.com/google/recaptcha/issues/450) audio blocked under keyboard on a VM; [#470](https://github.com/google/recaptcha/issues/470) image grid unsolvable with NVDA; [#538](https://github.com/google/recaptcha/issues/538) audio dead, no fallback.
- W3C [Inaccessibility of CAPTCHA](https://www.w3.org/TR/turingtest/): keyboard users get the inaccessible fallback; blocked cookies trigger the grid; Google sometimes stops offering audio at all. Assistive tech looks like a bot to the scorer.

So: trusted Google profile → checkbox auto-pass. Screen reader / keyboard / privacy cookies → grid or audio blocked. Deaf-blind → neither modality. Title II still requires a channel that works.

---

## The fix they need (Cloudflare Turnstile, Free plan, an afternoon)

Turnstile is a drop-in for this exact pattern: a script tag, a div in the form, a token in
the POST body, a server `siteverify`. **The site does not have to sit on Cloudflare's CDN.**
Free plan (Cloudflare docs, retrieved 2026-08-27): **$0, unlimited challenges, up to 20
widgets, all widget types (Managed / Non-interactive / Invisible), WCAG 2.2 AA** (plans table
also lists AAA). Tokens last **300 seconds** vs reCAPTCHA's 120 — which is the difference
between surviving this form's GIS lookup and bouncing.

### HTML they would change (the whole client swap)

**Today (csr.dot.ca.gov):**
```html
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
<div class="g-recaptcha" data-sitekey="6LdqJkoUAAAAAKRfVdCoDawQEnJDLVhSpLKxSstc"></div>
```

**Tomorrow (this repo's `index.html`, minus the test key):**
```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile"
     data-sitekey="YOUR_SITEKEY"
     data-theme="auto"
     data-callback="onTurnstileSuccess"
     data-expired-callback="onTurnstileExpired"
     data-error-callback="onTurnstileError"></div>
```

That is the same two lines they already have, plus the three callbacks Google documented and
they never wired. The widget writes `cf-turnstile-response` instead of `g-recaptcha-response`.

### PHP / server they would change (the whole verify swap)

They already POST a token and check it somehow. Replace Google's `siteverify` with Cloudflare's:

```
POST https://challenges.cloudflare.com/turnstile/v0/siteverify
secret=<TURNSTILE_SECRET>
response=<cf-turnstile-response>
```

Reject unless `success: true`. One token, one use, 5 minutes. Same shape as today.

### Checklist (copy this)

1. Free Cloudflare account → Turnstile → Add widget → hostname `csr.dot.ca.gov` → **Managed**.
2. Swap the script `src` and the div class / sitekey (above).
3. Server: read `cf-turnstile-response`, POST `siteverify`, fail closed.
4. Wire success / expired / error callbacks: enable Submit only with a live token; on expiry call `turnstile.reset()` and announce in an `aria-live` region. Stop POSTing a dead token.
5. Stop `$("select#dirTravel").replaceWith(...)` after pin-drop — update options, don't destroy the control.
6. Stop treating HTTP 200 as success; confirmation page (ticket number in the title/body) is the success contract.
7. Make the map optional: keep the pin, accept a text location / postmile. That is WCAG 2.1.1.
8. Put a real `href` on the ADA Grievance link. Mark required fields `required` / `aria-required`.
9. Keep a **phone / TTY / relay** intake as the Title II alternative channel. The captcha-free grievance form at `adapt.dot.ca.gov/grievance/newRequest` already proves they can ship no-CAPTCHA intake; it just refuses road hazards.

This repo is that form. `index.html` is the static page. `hono-worker/` is a deployable
Cloudflare Worker that does the server-side `siteverify`. Demo sitekey
`1x00000000000000000000AA` always passes so anyone can click through.

---

## The fix (this repo)

### Front end — `index.html`
- **Cloudflare Turnstile** instead of reCAPTCHA. Turnstile is non-interactive for most users
  (no image grids), ships screen-reader support, and offers an accessible challenge when one is
  needed. The demo uses Cloudflare's **test sitekey `1x00000000000000000000AA`** (always passes),
  so the page works out of the box. The widget wires `data-callback` / `data-expired-callback` /
  `data-error-callback` and leaves Submit disabled until a live token exists — the three
  host-side hooks `csr.dot.ca.gov` omitted.
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
