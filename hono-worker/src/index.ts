import { Hono } from 'hono'
import { html, raw } from 'hono/html'

type Bindings = {
  TURNSTILE_SECRET?: string // wrangler secret put TURNSTILE_SECRET  (test: 1x0000000000000000000000000000000AA)
  TURNSTILE_SITEKEY?: string // vars in wrangler.toml (test: 1x00000000000000000000AA)
  DEV_SKIP_TURNSTILE?: string // LOCAL ONLY: set to "1" in `wrangler dev` when outbound TLS is blocked. NEVER set in production.
}

const app = new Hono<{ Bindings: Bindings }>()

const TEST_SITEKEY = '1x00000000000000000000AA'
const TEST_SECRET = '1x0000000000000000000000000000000AA'

// ---- shared page shell (accessible: lang, single h1, skip link, theme-color) ----
const page = (title: string, body: ReturnType<typeof html>) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --fg:#11202e; --bg:#fff; --line:#8a94a0; --focus:#1a5fb4; --err:#b3261e; --ok:#0b6b3a; }
  * { box-sizing: border-box }
  body { font: 16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
         color:var(--fg); background:var(--bg); margin:0 }
  main { max-width: 720px; margin: 0 auto; padding: 1.25rem }
  h1 { font-size: 1.6rem; margin: .2rem 0 1rem }
  label { display:block; font-weight:600; margin:.9rem 0 .3rem }
  .req { color:var(--err); font-weight:400 }
  input, textarea, select { width:100%; padding:.6rem .7rem; font:inherit;
         border:1px solid var(--line); border-radius:6px; background:#fff; color:var(--fg) }
  textarea { min-height:6.5rem }
  input:focus, textarea:focus, select:focus, a:focus, button:focus {
         outline:3px solid var(--focus); outline-offset:2px }
  .hint { font-weight:400; color:#425466; font-size:.9rem; margin:.15rem 0 0 }
  button { margin-top:1.1rem; padding:.7rem 1.2rem; font:inherit; font-weight:600;
           color:#fff; background:var(--focus); border:0; border-radius:6px; cursor:pointer }
  .skip { position:absolute; left:-999px }
  .skip:focus { position:static; display:inline-block; padding:.5rem }
  .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden }
  .summary { border:2px solid var(--err); background:#fdecea; padding:.8rem 1rem; border-radius:6px; margin:1rem 0 }
  .summary h2 { font-size:1.05rem; margin:.1rem 0 .4rem }
  .summary a { color:var(--err) }
  [aria-invalid="true"] { border-color:var(--err); border-width:2px }
  .ok { border:2px solid var(--ok); background:#e7f5ec; padding:1rem 1.1rem; border-radius:6px }
  .ref { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:700 }
  footer { margin:2rem 0 3rem; color:#425466; font-size:.85rem }
</style>
</head>
<body>
<a class="skip" href="#form">Skip to the form</a>
<main>
${body}
<footer>
  Accessible service-request demo — Hono + Cloudflare Workers. WCAG 2.1 AA pattern.
  Source: <a href="https://github.com/barkleesanders/accessible-gov-form-demo">github.com/barkleesanders/accessible-gov-form-demo</a>
</footer>
</main>
</body>
</html>`

// ---- the form ----
function formPage(sitekey: string, errors: Record<string, string> = {}, values: Record<string, string> = {}) {
  const errList = Object.entries(errors)
  const v = (k: string) => values[k] ? ` ` + `value="${values[k].replace(/"/g, '&quot;')}"` : ''
  const inv = (k: string) => (errors[k] ? ' aria-invalid="true"' : '')
  const desc = (k: string) => (errors[k] ? ` aria-describedby="${k}-err"` : '')
  const emsg = (k: string) => (errors[k] ? html`<p class="hint" id="${k}-err" style="color:var(--err)">${errors[k]}</p>` : '')
  return page('Report a road hazard', html`
    <h1>Report a road hazard</h1>
    ${errList.length
      ? html`<div class="summary" role="alert" tabindex="-1" id="errsum">
          <h2>There ${errList.length === 1 ? 'is 1 problem' : `are ${errList.length} problems`} with your report</h2>
          <ul>${raw(errList.map(([k, m]) => `<li><a href="#${k}">${m}</a></li>`).join(''))}</ul>
        </div>`
      : ''}
    <form id="form" method="post" action="/submit" novalidate>
      <label for="description">What is the hazard? <span class="req">(required)</span></label>
      <textarea id="description" name="description" required aria-required="true"${raw(inv('description'))}${raw(desc('description'))}>${values.description ?? ''}</textarea>
      ${emsg('description')}

      <label for="location">Where is it? <span class="req">(required)</span></label>
      <input id="location" name="location" type="text" required aria-required="true"
             placeholder="Street, cross street, city, or route + direction"${raw(v('location'))}${raw(inv('location'))}${raw(desc('location'))}>
      <p class="hint">Type the location in words. A map pin is optional — not required to submit.</p>
      ${emsg('location')}

      <label for="email">Your email <span class="req">(required)</span></label>
      <input id="email" name="email" type="email" required aria-required="true"
             inputmode="email" autocomplete="email"${raw(v('email'))}${raw(inv('email'))}${raw(desc('email'))}>
      ${emsg('email')}

      <label for="name">Your name (optional)</label>
      <input id="name" name="name" type="text" autocomplete="name"${raw(v('name'))}>

      <label for="phone">Phone (optional)</label>
      <input id="phone" name="phone" type="tel" autocomplete="tel"${raw(v('phone'))}>

      <!-- honeypot: hidden from people + assistive tech; bots fill it -->
      <div class="hp" aria-hidden="true">
        <label for="company">Company</label>
        <input id="company" name="company" type="text" tabindex="-1" autocomplete="off">
      </div>

      <div class="cf-turnstile" data-sitekey="${sitekey}" style="margin-top:1.1rem"></div>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

      <button type="submit">Submit report</button>
    </form>
    <script>
      // Move focus to the error summary if the server returned one (WCAG 3.3.1).
      var s = document.getElementById('errsum'); if (s) s.focus();
    </script>
  `)
}

app.get('/', (c) => c.html(formPage(c.env.TURNSTILE_SITEKEY || TEST_SITEKEY)))

// ---- verify Turnstile server-side (the actual bot gate) ----
async function verifyTurnstile(token: string, secret: string, ip?: string): Promise<boolean> {
  if (!token) return false
  try {
    const body = new FormData()
    body.append('secret', secret)
    body.append('response', token)
    if (ip) body.append('remoteip', ip)
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const j = (await r.json()) as { success: boolean }
    return j.success === true
  } catch {
    // Network/verify failure -> fail closed (treat as unverified) rather than 500.
    return false
  }
}

function genRef(): string {
  // Deterministic, human-readable tracking ref. crypto is available in Workers.
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  return `SR-${hex}`
}

app.post('/submit', async (c) => {
  const form = await c.req.formData()
  const val = (k: string) => (form.get(k) ?? '').toString().trim()

  // 1) Honeypot — silently accept-and-drop bots (never reveal it).
  if (val('company') !== '') return c.html(page('Report received', html`<div class="ok"><h1>Report received</h1><p>Thank you.</p></div>`))

  // 2) Server-side field validation (never trust the client).
  const values = { description: val('description'), location: val('location'), email: val('email'), name: val('name'), phone: val('phone') }
  const errors: Record<string, string> = {}
  if (!values.description) errors.description = 'Describe the hazard.'
  if (!values.location) errors.location = 'Enter where the hazard is.'
  if (!values.email) errors.email = 'Enter your email address.'
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) errors.email = 'Enter a valid email address.'

  // 3) Turnstile (accessible CAPTCHA) — the bot gate. Test secret always passes.
  const token = val('cf-turnstile-response')
  const secret = c.env.TURNSTILE_SECRET || TEST_SECRET
  const ip = c.req.header('CF-Connecting-IP')
  // DEV_SKIP_TURNSTILE is a LOCAL-ONLY escape for `wrangler dev` when outbound TLS is unavailable. Off in prod.
  const humanOk = c.env.DEV_SKIP_TURNSTILE === '1' ? true : await verifyTurnstile(token, secret, ip)
  if (!humanOk) errors['cf-turnstile-response'] = 'Please complete the verification checkbox.'

  if (Object.keys(errors).length) {
    return c.html(formPage(c.env.TURNSTILE_SITEKEY || TEST_SITEKEY, errors, values), 422)
  }

  // 4) Accept. In production: persist to KV/D1 and/or POST to the ticketing backend here.
  const ref = genRef()
  // await c.env.TICKETS?.put(ref, JSON.stringify({ ...values, ip, at: new Date().toISOString() }))

  return c.html(page('Report received', html`
    <div class="ok">
      <h1>Report received</h1>
      <p>Your tracking number is <span class="ref">${ref}</span>. Save it to check status.</p>
      <p><strong>Hazard:</strong> ${values.description}</p>
      <p><strong>Location:</strong> ${values.location}</p>
    </div>
    <p style="margin-top:1.2rem"><a href="/">Report another hazard</a></p>
  `))
})

// Accessible 404
app.notFound((c) => c.html(page('Page not found', html`<h1>Page not found</h1><p><a href="/">Go to the report form</a>.</p>`), 404))

export default app
