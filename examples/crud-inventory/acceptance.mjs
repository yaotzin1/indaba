// Acceptance test for the inventory-app of docs/cookbook-crud.md. Copy it into the project as
// acceptance/inventory.mjs before the run; no step of the workflow may change it. It starts the real server
// (node src/server.js) on a free port and checks the contract the workflow's spec step was given, over HTTP.
// Run it yourself with: node acceptance/inventory.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const free = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const port = await free();
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'inherit' });
const stop = () => server.kill();
process.on('exit', stop);

async function up() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/api/items`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`the server did not answer on port ${port} within 5 seconds (it must listen on PORT)`);
}

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: json };
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const isError = (res, status) => {
  assert.equal(res.status, status);
  assert.equal(typeof res.body?.error, 'string', 'error responses are { "error": "<message>" }');
};

let mug;
const created = () => assert.ok(mug?.id, 'the check that creates the item must pass first');
check('GET / serves an HTML page', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.type, /^text\/html/);
});
check('GET /api/items starts empty', async () => {
  const res = await call('GET', '/api/items');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});
check('POST /api/items creates an item (201)', async () => {
  const res = await call('POST', '/api/items', { sku: 'MUG-01', name: 'Blue mug', quantity: 12, priceCents: 900 });
  assert.equal(res.status, 201);
  assert.match(res.type, /^application\/json/);
  mug = res.body;
  assert.equal(typeof mug.id, 'string');
  assert.deepEqual(
    { sku: mug.sku, name: mug.name, quantity: mug.quantity, priceCents: mug.priceCents },
    { sku: 'MUG-01', name: 'Blue mug', quantity: 12, priceCents: 900 },
  );
  for (const key of ['createdAt', 'updatedAt']) assert.equal(new Date(mug[key]).toISOString(), mug[key], `${key} is ISO 8601`);
});
check('POST refuses bad input (400) and a duplicate sku (409)', async () => {
  isError(await call('POST', '/api/items', '{not json'), 400);
  isError(await call('POST', '/api/items', { sku: 'mug-02', name: 'x', quantity: 1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'X'.repeat(33), name: 'x', quantity: 1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: '', quantity: 1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: 'x', quantity: -1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: 'x', quantity: 1.5, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: 'x', quantity: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: '   ', quantity: 1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: 'n'.repeat(201), quantity: 1, priceCents: 1 }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-02', name: 'x', quantity: 1, priceCents: 1, colour: 'blue' }), 400);
  isError(await call('POST', '/api/items', { sku: 'MUG-01', name: 'Again', quantity: 1, priceCents: 1 }), 409);
});
check('GET /api/items/:id reads it, an unknown id is 404', async () => {
  created();
  const res = await call('GET', `/api/items/${mug.id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, mug);
  isError(await call('GET', '/api/items/does-not-exist'), 404);
});
check('PATCH changes fields, validates and keeps sku unique', async () => {
  created();
  const cup = (await call('POST', '/api/items', { sku: 'CUP-01', name: 'Cup', quantity: 2, priceCents: 500 })).body;
  const res = await call('PATCH', `/api/items/${mug.id}`, { name: 'Red mug', priceCents: 950 });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Red mug');
  assert.equal(res.body.priceCents, 950);
  assert.equal(res.body.sku, 'MUG-01');
  assert.equal(res.body.createdAt, mug.createdAt);
  isError(await call('PATCH', `/api/items/${mug.id}`, { quantity: -3 }), 400);
  isError(await call('PATCH', `/api/items/${mug.id}`, {}), 400);
  isError(await call('PATCH', `/api/items/${mug.id}`, { colour: 'blue' }), 400);
  isError(await call('PATCH', `/api/items/${mug.id}`, { sku: 'CUP-01' }), 409);
  isError(await call('PATCH', '/api/items/does-not-exist', { name: 'x' }), 404);
  assert.equal((await call('PATCH', `/api/items/${cup.id}`, { sku: 'CUP-01' })).status, 200, 'an item may keep its own sku');
});
check('GET /api/items?lowStock=n lists items with quantity below n', async () => {
  const res = await call('GET', '/api/items?lowStock=5');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((i) => i.sku), ['CUP-01']);
  assert.deepEqual((await call('GET', '/api/items?lowStock=2')).body, []);
  isError(await call('GET', '/api/items?lowStock=-1'), 400);
  isError(await call('GET', '/api/items?lowStock=abc'), 400);
});
check('POST /api/items/:id/adjust changes stock, never below 0', async () => {
  created();
  const res = await call('POST', `/api/items/${mug.id}/adjust`, { delta: -2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.quantity, 10);
  assert.equal((await call('POST', `/api/items/${mug.id}/adjust`, { delta: 5 })).body.quantity, 15);
  isError(await call('POST', `/api/items/${mug.id}/adjust`, { delta: -16 }), 422);
  isError(await call('POST', `/api/items/${mug.id}/adjust`, { delta: 0 }), 400);
  isError(await call('POST', `/api/items/${mug.id}/adjust`, { delta: 1.5 }), 400);
  isError(await call('POST', '/api/items/does-not-exist/adjust', { delta: 1 }), 404);
  assert.equal((await call('GET', `/api/items/${mug.id}`)).body.quantity, 15);
});
check('DELETE removes it (204), then it is gone (404)', async () => {
  created();
  const res = await call('DELETE', `/api/items/${mug.id}`);
  assert.equal(res.status, 204);
  isError(await call('GET', `/api/items/${mug.id}`), 404);
  isError(await call('DELETE', `/api/items/${mug.id}`), 404);
});
check('any other path or method is 404 with an error body', async () => {
  isError(await call('GET', '/api/nothing'), 404);
  isError(await call('PUT', '/api/items'), 404);
});

let failed = 0;
try {
  await up();
  for (const { name, fn } of checks) {
    try {
      await fn();
      console.log(`ok      ${name}`);
    } catch (error) {
      failed++;
      console.log(`FAILED  ${name}\n        ${String(error.message).split('\n').join('\n        ')}`);
    }
  }
} catch (error) {
  failed++;
  console.log(`FAILED  ${error.message}`);
}
stop();
console.log(failed === 0 ? `acceptance: all ${checks.length} checks passed` : `acceptance: ${failed} of ${checks.length} checks failed`);
process.exit(failed === 0 ? 0 : 1);
