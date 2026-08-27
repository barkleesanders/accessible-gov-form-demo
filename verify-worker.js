// Cloudflare Worker — server-side verification for the accessible service-request form.
// Deploy with `wrangler deploy`. Set the secret:  wrangler secret put TURNSTILE_SECRET
// (Use Cloudflare's test secret 1x0000000000000000000000000000000AA for a demo — it always passes.)
//
// This is the piece that actually stops spam. Turnstile on the client is the accessible
// challenge; siteverify here is the gate. No CAPTCHA image, no audio-typing, no lockout.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    const form = await request.formData();

    // 1) Honeypot — a hidden field real users never fill. Bots do. Silent drop.
    if ((form.get('company') || '').trim() !== '') {
      return new Response(JSON.stringify({ ok: true, ref: fakeRef() }), { headers: cors }); // look successful, do nothing
    }

    // 2) Turnstile token — verify server-side against Cloudflare siteverify.
    const token = form.get('cf-turnstile-response');
    if (!token)
      return new Response(JSON.stringify({ ok: false, error: 'Missing challenge token' }), {
        status: 400,
        headers: cors,
      });

    const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET,
        response: token,
        remoteip: request.headers.get('CF-Connecting-IP') || '',
      }),
    }).then((r) => r.json());

    if (!verify.success) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Challenge failed', codes: verify['error-codes'] }),
        { status: 403, headers: cors },
      );
    }

    // 3) Validate required fields server-side (never trust the client).
    for (const k of ['type', 'loc', 'desc', 'email']) {
      if (!(form.get(k) || '').trim()) {
        return new Response(JSON.stringify({ ok: false, error: `Missing field: ${k}` }), {
          status: 400,
          headers: cors,
        });
      }
    }

    // 4) (Optional) rate-limit per IP with a Durable Object or KV counter, and hand off to
    //    the real ticketing backend here. Return the tracking number to the reporter.
    const ref = fakeRef();
    return new Response(JSON.stringify({ ok: true, ref }), { headers: cors });
  },
};

function fakeRef() {
  // Demo-only ref. In production, return the ticket id from your maintenance system.
  return 'REQ-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}
