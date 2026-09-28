import test from 'node:test';
import assert from 'node:assert/strict';
import { createWechatCloud, API_BASE } from '../src/platform/cloud.js';

test('cloud client exchanges a login code, shares auth work and sends session tokens only to game API', async () => {
  let logins = 0; const requests = [];
  const wx = {
    login({ success }) { logins++; queueMicrotask(() => success({ code: 'wx-code' })); },
    request(options) {
      requests.push(options); assert.ok(options.url.startsWith(API_BASE + '/'));
      queueMicrotask(() => options.success({ statusCode: 200, data: options.url.endsWith('/auth/wechat') ? { token: 'session', expiresAt: Date.now() + 3600000 } : { revision: 0, state: null } }));
    },
  };
  const cloud = createWechatCloud(wx);
  await Promise.all([cloud.read(), cloud.read()]);
  assert.equal(logins, 1); assert.equal(requests.filter(r => r.url.endsWith('/auth/wechat')).length, 1);
  assert.ok(requests.filter(r => r.url.endsWith('/save')).every(r => r.header.Authorization === 'Bearer session'));
  await cloud.write({ version: 1 }, 7);
  assert.deepEqual(requests[requests.length - 1].data, { state: { version: 1 }, revision: 7 });
});
test('expired cloud sessions trigger a new login on retry and network errors retain local-play semantics', async () => {
  let logins = 0, unauthorized = true;
  const cloud = createWechatCloud({
    login({ success }) { logins++; success({ code: 'new-code' }); },
    request(options) {
      if (options.url.endsWith('/auth/wechat')) options.success({ statusCode: 200, data: { token: 'session', expiresAt: Date.now() + 3600000 } });
      else if (unauthorized) options.success({ statusCode: 401, data: { error: 'UNAUTHORIZED', message: 'expired' } });
      else options.fail();
    },
  });
  await assert.rejects(cloud.read(), /expired/); unauthorized = false;
  await assert.rejects(cloud.read(), /本地进度已保留/); assert.equal(logins, 2);
});
