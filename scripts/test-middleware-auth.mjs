import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const next = require('next/server');
const { createClient } = require('@supabase/supabase-js');
function moduleAt(path, mocks = {}) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)(id => mocks[id] ?? require(id), mod, mod.exports);
  return mod.exports;
}
const deadline = moduleAt('src/lib/middleware-auth-deadline.ts');
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
function middlewareFor(getUser) {
  return moduleAt('src/middleware.ts', {
    '@supabase/supabase-js': { createClient: (_url, _key, options) => ({ auth: { getUser: () => getUser(options) } }) },
    './lib/middleware-auth-deadline': { ...deadline, withAuthDeadline: fn => deadline.withAuthDeadline(fn, 30) }
  }).middleware;
}
function request(path = '/', cookie = '', host = 'workforce.dropxlogistics.com', method = 'GET') {
  return new next.NextRequest(`https://${host}${path}`, { method, headers: { host, cookie } });
}
test('stalled verification is bounded, aborted and never passes auth or logs out', async () => {
  let signal;
  const mw = middlewareFor(async options => {
    const original = global.fetch;
    global.fetch = (_input, init) => { signal = init.signal; return new Promise(() => {}); };
    try { return await options.global.fetch('https://example.supabase.co/auth/v1/user'); }
    finally { global.fetch = original; }
  });
  const original = global.fetch;
  try {
    const response = await mw(request('/', 'existing=session'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-middleware-next'), null);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('retry-after'), '5');
    assert.equal(signal.aborted, true);
  } finally { global.fetch = original; }
});
test('upstream network/5xx/429 failures preserve sessions and fail closed', async () => {
  for (const error of [{ name: 'AuthRetryableFetchError', status: 0 }, { status: 503 }, { status: 429 }]) {
    const response = await middlewareFor(async () => ({ data: { user: null }, error }))(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('x-middleware-next'), null);
  }
});
test('missing and revoked sessions go to login; cleared cookies survive redirect', async () => {
  const response = await middlewareFor(async options => {
    options.auth.storage.removeItem('test-auth');
    return { data: { user: null }, error: { status: 401 } };
  })(request('/delivery-network/rate-mapping'));
  assert.equal(response.status, 307);
  assert.match(response.headers.get('location'), /login\?next=/);
  assert.match(response.headers.get('set-cookie'), /test-auth=.*Max-Age=0/);
});
test('verified sessions retain routing and send refreshed cookies to browser AND server', async () => {
  const mw = middlewareFor(async options => {
    options.auth.storage.setItem('test-auth', JSON.stringify({ access_token: 'refreshed-test' }));
    return { data: { user: { id: 'test-user' } }, error: null };
  });
  for (const path of ['/', '/delivery-network/rate-mapping']) {
    const response = await mw(request(path));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /test-auth\.0=b64-/);
    assert.match(response.headers.get('x-middleware-request-cookie'), /test-auth\.0=b64-/);
    if (path === '/') assert.equal(new URL(response.headers.get('x-middleware-rewrite')).pathname, '/delivery-network');
    else assert.equal(response.headers.get('x-middleware-next'), '1');
  }
});
test('malformed session encoding does not crash middleware', async () => {
  const response = await middlewareFor(async options => {
    assert.equal(options.auth.storage.getItem('test-auth'), null);
    return { data: { user: null }, error: { status: 401 } };
  })(request('/', 'test-auth=b64-%%%%'));
  assert.equal(response.status, 307);
});
test('preview write guard, public paths and surface restrictions are unchanged', async () => {
  const mw = middlewareFor(() => { throw new Error('must not call auth'); });
  assert.equal((await mw(request('/api/test', 'dropx_portal_preview_v1=test', undefined, 'POST'))).status, 403);
  assert.equal((await mw(request('/login'))).headers.get('x-middleware-next'), '1');
  assert.equal((await mw(request('/api/test'))).headers.get('x-middleware-next'), '1');
  assert.match((await mw(request('/people'))).headers.get('location'), /unauthorized/);
});
test('real Supabase SDK validates user and refreshes expired sessions with bounded transport', async () => {
  for (const expired of [false, true]) {
    const now = Math.floor(Date.now() / 1000);
    let value = JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_at: now + (expired ? -60 : 3600), user: { id: 'test-user' } });
    const paths = [];
    const result = await deadline.withAuthDeadline(async signal => {
      const client = createClient('https://example.supabase.co', 'test-key', {
        auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
          storage: { getItem: () => value, setItem: (_key, v) => { value = v; }, removeItem: () => { value = null; } } },
        global: { fetch: async (input) => {
          assert.equal(signal.aborted, false);
          paths.push(new URL(input).pathname);
          return new Response(JSON.stringify(String(input).includes('/token')
            ? { access_token: 'refreshed-test-access', refresh_token: 'refreshed-test-refresh', token_type: 'bearer', expires_in: 3600, user: { id: 'test-user' } }
            : { id: 'test-user' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } }
      });
      return client.auth.getUser();
    }, 500);
    assert.equal(result.error, null);
    assert.equal(result.data.user.id, 'test-user');
    assert.ok(paths.includes('/auth/v1/user'));
    if (expired) {
      assert.ok(paths.includes('/auth/v1/token'));
      assert.match(value, /refreshed-test-access/);
    }
  }
});
