import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createApi, createStore } from './service.js';

const appid = process.env.WECHAT_APPID, secret = process.env.WECHAT_APP_SECRET;
if (!/^wx[0-9a-f]{16}$/.test(appid || '') || !/^[0-9a-f]{32}$/.test(secret || '')) throw new Error('Configure WECHAT_APPID and WECHAT_APP_SECRET in the server environment.');
const filename = process.env.HEXWAR_DB || '/var/lib/hexwar/game.sqlite';
mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
const store = createStore(filename);
const server = createApi({ store, appid, secret, trustedProxy: true });
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3041), '127.0.0.1', () => console.log('HEXWAR API listening on loopback'));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => { store.close(); process.exit(0); }); });
