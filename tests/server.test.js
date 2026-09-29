import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApi, createStore, exchangeWechatCode } from '../server/service.js';
import { createGame, applyCommand } from '../src/core/game.js';
import { neighbors } from '../src/core/hex.js';

async function fixture(t) {
  const store = createStore(':memory:');
  const server = createApi({ store, appid: 'wx-test', secret: 'server-only', exchangeCode: async code => `openid-${code}` });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}/wechat/game/hexwar/api`;
  const call = async (route, method = 'GET', body, token) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const login = async code => (await call('/auth/wechat', 'POST', { code })).data.token;
  return { store, call, login };
}

test('public health is minimal; save API requires authentication', async t => {
  const { call } = await fixture(t);
  assert.deepEqual((await call('/health')).data, { ok: true, service: 'hexwar', version: '1.2.0' });
  assert.equal((await call('/save')).status, 401);
  assert.equal((await call('/save', 'GET', undefined, 'a'.repeat(43))).status, 401);
  assert.equal((await call('/unknown')).status, 404);
  assert.equal((await call('/auth/wechat', 'POST', { code: '' })).status, 400);
});
test('login, save and restore isolate accounts and reject stale revisions', async t => {
  const { call, login } = await fixture(t);
  const a = await login('user-a'), b = await login('user-b');
  assert.match(a, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal((await call('/save', 'GET', undefined, a)).data.revision, 0);
  const initial = createGame({ seed: 'cloud' }), home = Object.values(initial.cells).find(c => c.owner === 0);
  const target = neighbors(home, initial.cells).find(c => c.owner === null);
  const state = applyCommand(initial, { type: 'MARCH', frequency: 'once', from: home.id, to: target.id, amount: 4, actor: 0 });
  const saved = await call('/save', 'PUT', { state, revision: 0 }, a);
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
  assert.deepEqual((await call('/save', 'GET', undefined, a)).data.state, state);
  assert.equal((await call('/save', 'GET', undefined, b)).data.state, null);
  const stale = await call('/save', 'PUT', { state, revision: 0 }, a);
  assert.equal(stale.status, 409); assert.equal(stale.data.error, 'SAVE_CONFLICT');
  const a2 = await login('user-a');
  assert.equal((await call('/save', 'GET', undefined, a2)).data.revision, 1);
  assert.equal((await call('/save', 'PUT', { state, revision: 1 }, a2)).data.revision, 2);
});
test('invalid or oversized saves are rejected without replacing valid data', async t => {
  const { call, login } = await fixture(t), token = await login('test-user');
  const state = createGame();
  await call('/save', 'PUT', { state, revision: 0 }, token);
  assert.equal((await call('/save', 'PUT', { state: { version: 1 }, revision: 1 }, token)).status, 400);
  assert.equal((await call('/save', 'PUT', { state, revision: -1 }, token)).status, 400);
  assert.equal((await call('/save', 'PUT', { state: 'x'.repeat(200 * 1024), revision: 1 }, token)).status, 413);
  assert.equal((await call('/save', 'GET', undefined, token)).data.revision, 1);
});
test('save and sessions survive a service restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hexwar-db-'));
  let store;
  try {
    const filename = path.join(dir, 'save.sqlite');
    store = createStore(filename);
    const { token } = store.session('openid', 'appid'), user = store.authenticate(token), state = createGame();
    store.save(user, state, 0); store.close(); store = createStore(filename);
    assert.equal(store.authenticate(token), user); assert.deepEqual(store.load(user).state, state);
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }); }
});
test('WeChat upstream failures never expose secret, code, session key or raw errors', async () => {
  const options = { appid: 'appid', secret: 'sensitive-test-secret' };
  await assert.rejects(exchangeWechatCode('one-time-code', { ...options, fetchImpl: async () => { throw new Error('upstream https://api.weixin.qq.com/?secret=sensitive-test-secret'); } }), error => error.message === '微信登录服务暂不可用，请稍后重试。');
  const result = await exchangeWechatCode('one-time-code', { ...options, fetchImpl: async url => {
    assert.equal(url.hostname, 'api.weixin.qq.com'); assert.equal(url.searchParams.get('secret'), options.secret);
    return { ok: true, json: async () => ({ openid: 'user', session_key: 'upstream-private-key' }) };
  } });
  assert.equal(result, 'user');
  await assert.rejects(exchangeWechatCode('expired-code', { ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ errcode: 40029, errmsg: 'invalid code' }) }) }), /微信登录失败/);
});
test('login attempts have a per-client rate limit', async t => {
  const { call } = await fixture(t);
  for (let i = 0; i < 20; i++) assert.equal((await call('/auth/wechat', 'POST', { code: 'user-test' })).status, 200);
  assert.equal((await call('/auth/wechat', 'POST', { code: 'user-test' })).status, 429);
});
