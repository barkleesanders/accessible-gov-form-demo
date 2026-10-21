import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const output = await mkdtemp(path.join(tmpdir(), 'accessible-runtime-'));
let runtime;
let providerOk = true;
let verificationCalls = 0;
try {
  const build = (config, dir) =>
    execFileSync(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'deploy',
        '--dry-run',
        '-c',
        path.resolve(config),
        '--outdir',
        dir,
      ],
      { stdio: 'inherit' },
    );
  build('wrangler.toml', path.join(output, 'hono'));
  build('../wrangler.toml', path.join(output, 'raw'));
  const hono = await readFile(path.join(output, 'hono/index.js'), 'utf8');
  const raw = await readFile(path.join(output, 'raw/verify-worker.js'), 'utf8');
  const outboundService = async (request) => {
    assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const data = await request.formData();
    assert.equal(data.get('secret'), 'synthetic-secret');
    assert.equal(data.get('response'), 'synthetic-token');
    verificationCalls++;
    return new Response(JSON.stringify({ success: providerOk }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const worker = (name, script) => ({
    name,
    modules: true,
    script,
    compatibilityDate: '2024-11-01',
    bindings: { TURNSTILE_SECRET: 'synthetic-secret', TURNSTILE_SITEKEY: 'synthetic-sitekey' },
    outboundService,
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({ workers: [worker('hono-test', hono), worker('raw-test', raw)] }),
  );
  const honoWorker = await runtime.getWorker('hono-test');
  const rawWorker = await runtime.getWorker('raw-test');
  const get = await honoWorker.fetch('https://example.invalid/');
  assert.equal(get.status, 200);
  assert.match(await get.text(), /data-sitekey="synthetic-sitekey"/);
  const fields = {
    description: 'Synthetic hazard',
    location: 'Synthetic location',
    email: 'test@example.invalid',
    'cf-turnstile-response': 'synthetic-token',
  };
  const post = (target, fields) =>
    target.fetch('https://example.invalid/submit', {
      method: 'POST',
      body: new URLSearchParams(fields),
    });
  const accepted = await post(honoWorker, fields);
  assert.equal(accepted.status, 200);
  assert.match(await accepted.text(), /SR-[0-9A-F]{8}/);
  providerOk = false;
  assert.equal((await post(honoWorker, fields)).status, 422);
  assert.equal(
    (await post(honoWorker, { ...fields, description: 'x'.repeat(70_000) })).status,
    413,
  );
  assert.equal(
    (await honoWorker.fetch('https://example.invalid/submit', { method: 'POST', body: 'broken' }))
      .status,
    400,
  );
  providerOk = true;
  const rawFields = {
    type: 'demo',
    loc: 'Synthetic location',
    desc: 'Synthetic hazard',
    email: 'test@example.invalid',
    'cf-turnstile-response': 'synthetic-token',
  };
  const rawAccepted = await post(rawWorker, rawFields);
  assert.equal(rawAccepted.status, 200);
  assert.equal((await rawAccepted.json()).ok, true);
  providerOk = false;
  assert.equal((await post(rawWorker, rawFields)).status, 403);
  assert.equal(
    (await rawWorker.fetch('https://example.invalid/', { method: 'POST', body: 'broken' })).status,
    400,
  );
  assert.equal(verificationCalls, 4);
  console.log(
    JSON.stringify({
      runtime: 'workerd',
      honoBundleSha256: createHash('sha256').update(hono).digest('hex'),
      rawBundleSha256: createHash('sha256').update(raw).digest('hex'),
      verificationCalls,
      outbound: 'isolated synthetic Turnstile responder only; no agency backend',
    }),
  );
} finally {
  if (runtime) await runtime.dispose();
  await rm(output, { recursive: true, force: true });
}
