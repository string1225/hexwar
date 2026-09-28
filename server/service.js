import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { restore } from '../src/core/game.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY = 192 * 1024;
const PREFIX = '/wechat/game/hexwar/api';
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

export function createStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS saves (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, saved_at INTEGER NOT NULL, state TEXT NOT NULL);`);
  return {
    session(openid, appid) {
      const userId = digest(`${appid}:${openid}`), token = randomBytes(32).toString('base64url'), expiresAt = Date.now() + SESSION_MS;
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
      // Keep a bounded number of active sessions per account without logging tokens.
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 4)').run(userId, userId);
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), userId, expiresAt);
      return { token, expiresAt };
    },
    authenticate(token) { return db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token), Date.now())?.user_id; },
    load(userId) {
      const row = db.prepare('SELECT revision, saved_at, state FROM saves WHERE user_id = ?').get(userId);
      return row ? { revision: row.revision, savedAt: row.saved_at, state: JSON.parse(row.state) } : { revision: 0, savedAt: null, state: null };
    },
    save(userId, state, expectedRevision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT revision FROM saves WHERE user_id = ?').get(userId);
        const revision = row?.revision || 0;
        if (revision !== expectedRevision) throw new HttpError(409, 'SAVE_CONFLICT', '云端存档已更新，请重新打开云存档后再选择备份或读取。');
        const savedAt = Date.now();
        db.prepare('INSERT INTO saves VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET revision = excluded.revision, saved_at = excluded.saved_at, state = excluded.state').run(userId, revision + 1, savedAt, JSON.stringify(state));
        db.exec('COMMIT');
        return { revision: revision + 1, savedAt };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}

export async function exchangeWechatCode(code, { appid, secret, fetchImpl = fetch }) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' }).toString();
  let response, data;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    data = await response.json();
  } catch { throw new HttpError(502, 'WECHAT_UNAVAILABLE', '微信登录服务暂不可用，请稍后重试。'); }
  if (!response.ok || data.errcode || typeof data.openid !== 'string' || !data.openid || typeof data.session_key !== 'string') throw new HttpError(401, 'WECHAT_LOGIN_FAILED', '微信登录失败，请重新登录。');
  return data.openid; // Never return session_key, the App Secret or the upstream response.
}

async function readBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', '请使用 JSON 请求。');
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE', '请求过大。');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE', '请求过大。'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
  catch { throw new HttpError(400, 'INVALID_JSON', 'JSON 格式错误。'); }
}

export function createApi({ store, appid, secret, exchangeCode, trustedProxy = false }) {
  const windows = new Map();
  const login = exchangeCode || (code => exchangeWechatCode(code, { appid, secret }));
  const send = (res, status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(payload)); };
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === `${PREFIX}/health` && req.method === 'GET') { send(res, 200, { ok: true, service: 'hexwar', version: '1.0.0' }); return; }
      if (!['/auth/wechat', '/save'].some(route => pathname === PREFIX + route)) throw new HttpError(404, 'NOT_FOUND', '接口不存在。');
      const ip = trustedProxy ? String(req.headers['x-real-ip'] || req.socket.remoteAddress) : req.socket.remoteAddress;
      const now = Date.now(), isLogin = pathname.endsWith('/auth/wechat'), key = `${ip}:${isLogin ? 'login' : 'save'}`;
      for (const [id, value] of windows) if (value.until < now) windows.delete(id);
      const bucket = windows.get(key) || { count: 0, until: now + 60000 };
      if (++bucket.count > (isLogin ? 20 : 120)) throw new HttpError(429, 'RATE_LIMITED', '请求频繁，请稍后重试。');
      windows.set(key, bucket);
      if (isLogin) {
        if (req.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方式不支持。');
        const { code } = await readBody(req);
        if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]{4,256}$/.test(code)) throw new HttpError(400, 'INVALID_CODE', '缺少有效的微信登录 code。');
        const openid = await login(code);
        send(res, 200, store.session(openid, appid)); return;
      }
      const match = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(req.headers.authorization || '');
      const userId = match && store.authenticate(match[1]);
      if (!userId) throw new HttpError(401, 'UNAUTHORIZED', '登录已过期，请重新打开云存档。');
      if (req.method === 'GET') { send(res, 200, store.load(userId)); return; }
      if (req.method !== 'PUT') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请求方式不支持。');
      const body = await readBody(req), state = restore(body.state);
      if (!state || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new HttpError(400, 'INVALID_SAVE', '存档格式无效。');
      send(res, 200, store.save(userId, state, body.revision));
    } catch (error) {
      send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.code : 'INTERNAL_ERROR', message: error instanceof HttpError ? error.message : '服务暂不可用，请稍后重试。' });
    }
  });
}
