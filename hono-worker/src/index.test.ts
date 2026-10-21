import { afterEach, describe, expect, it, vi } from 'vitest';
import verifier from '../../verify-worker.js';
import app from './index';

afterEach(() => vi.unstubAllGlobals());
const values = {
  description: 'Synthetic test hazard',
  location: 'Synthetic location',
  email: 'test@example.invalid',
  'cf-turnstile-response': 'synthetic-token',
};
const env = { TURNSTILE_SECRET: 'synthetic-secret', TURNSTILE_SITEKEY: 'synthetic-sitekey' };
const post = (data: Record<string, string> = values) =>
  new Request('https://example.invalid/submit', {
    method: 'POST',
    body: new URLSearchParams(data),
  });
const verified = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ success: true })),
  );

describe('actual Hono request handler', () => {
  it('renders the labelled form and configured Turnstile key', async () => {
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-sitekey="synthetic-sitekey"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('href="#form"');
  });
  it('returns validation errors and safely echoes submitted text', async () => {
    verified();
    const res = await app.fetch(
      post({ ...values, email: '', description: '<script>bad()</script>' }),
      env,
    );
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('role="alert"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>bad()');
  });
  it('posts the real verification field names and returns a demo reference', async () => {
    verified();
    const res = await app.fetch(post(), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/SR-[0-9A-F]{8}/);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error('Expected verification form data');
    expect(body.get('response')).toBe('synthetic-token');
    expect(body.get('secret')).toBe('synthetic-secret');
  });
  it('drops honeypot input before contacting the provider', async () => {
    verified();
    expect((await app.fetch(post({ company: 'bot' }), env)).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects provider network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('synthetic offline');
      }),
    );
    expect((await app.fetch(post(), env)).status).toBe(422);
  });
  it('rejects malformed form bodies as client errors', async () => {
    expect(
      (
        await app.fetch(
          new Request('https://example.invalid/submit', { method: 'POST', body: 'broken' }),
          env,
        )
      ).status,
    ).toBe(400);
  });
  it('cannot silently use the public test secret for a real site key', async () => {
    verified();
    expect((await app.fetch(post(), { TURNSTILE_SITEKEY: 'real-site-key' })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects oversized forms and file fields before verification', async () => {
    verified();
    expect(
      (await app.fetch(post({ ...values, description: 'x'.repeat(70_000) }), env)).status,
    ).toBe(413);
    const form = new FormData();
    form.set('description', new File(['synthetic'], 'example.txt'));
    expect(
      (
        await app.fetch(
          new Request('https://example.invalid/submit', { method: 'POST', body: form }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores the removed verification bypass flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false })),
    );
    const bypass = { ...env, DEV_SKIP_TURNSTILE: '1' };
    expect((await app.fetch(post(), bypass)).status).toBe(422);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('standalone verifier request handler', () => {
  const payload = () =>
    new URLSearchParams({
      type: 'demo',
      loc: 'Synthetic location',
      desc: 'Synthetic hazard',
      email: 'test@example.invalid',
      'cf-turnstile-response': 'synthetic-token',
    });
  const request = () =>
    new Request('https://example.invalid/', { method: 'POST', body: payload() });
  it('requires POST', async () => {
    expect((await verifier.fetch(new Request('https://example.invalid/'), env)).status).toBe(405);
  });
  it('accepts verified synthetic fields without contacting any ticketing backend', async () => {
    verified();
    const res = await verifier.fetch(request(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ref: expect.stringMatching(/^REQ-/) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('returns a client error for malformed form bodies', async () => {
    const res = await verifier.fetch(
      new Request('https://example.invalid/', { method: 'POST', body: 'broken' }),
      env,
    );
    expect(res.status).toBe(400);
  });
  it('fails closed when verification is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('synthetic offline');
      }),
    );
    const res = await verifier.fetch(request(), env);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false });
  });
  it('does not forward unconfigured secrets', async () => {
    verified();
    expect((await verifier.fetch(request(), {})).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
