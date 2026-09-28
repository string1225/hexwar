export const API_BASE = 'https://www.sunny-string.cn/wechat/game/hexwar/api';

export function createWechatCloud(wx) {
  let token = null, expiresAt = 0, authenticating = null;
  function request(path, method = 'GET', data, bearer) {
    return new Promise((resolve, reject) => wx.request({
      url: API_BASE + path, method, data, timeout: 12000,
      header: { 'content-type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(response.data);
        else {
          if (response.statusCode === 401) { token = null; expiresAt = 0; }
          const error = new Error(response.data?.message || '云存档暂不可用，本地进度已保留。');
          error.code = response.data?.error; reject(error);
        }
      },
      fail() { reject(new Error('连接失败，请检查网络后重试。本地进度已保留。')); },
    }));
  }
  async function authenticate() {
    if (token && expiresAt > Date.now() + 30000) return token;
    if (!authenticating) authenticating = (async () => {
      const code = await new Promise((resolve, reject) => wx.login({ timeout: 10000, success: result => result.code ? resolve(result.code) : reject(new Error('微信登录未返回 code，请重试。')), fail: () => reject(new Error('微信登录失败，请稍后重试。')) }));
      const session = await request('/auth/wechat', 'POST', { code });
      if (typeof session.token !== 'string' || !Number.isFinite(session.expiresAt)) throw new Error('登录响应无效。');
      token = session.token; expiresAt = session.expiresAt; return token;
    })().finally(() => { authenticating = null; });
    return authenticating;
  }
  return {
    async read() { return request('/save', 'GET', undefined, await authenticate()); },
    async write(state, revision) { return request('/save', 'PUT', { state, revision }, await authenticate()); },
  };
}
