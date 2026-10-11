import vm from 'node:vm';
import { createGame, restore, serialize } from '../src/core/game.js';

// Boot the exact release bytes in a WeChat-only environment before uploading.
// This is a startup check, not a substitute for iOS / Android device testing.
export function smokeWechat(code) {
  const handlers = {}, storage = new Map(), drawn = [];
  const state = createGame({ size: 'small', enemies: 1, seed: 'protected-startup' });
  storage.set('hexwar.save.v1', serialize(state));
  const ctx = new Proxy({
    fillText: value => drawn.push(String(value)),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: String(value).length * 8 }),
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const wx = {
    createCanvas: () => ({ width: 0, height: 0, getContext: () => ctx }), createImage: () => ({}),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenHeight: 844, pixelRatio: 2, safeArea: { top: 47, bottom: 810 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 82 }),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    onWindowResize: fn => { handlers.resize = fn; }, onTouchStart: fn => { handlers.down = fn; },
    onTouchMove: fn => { handlers.move = fn; }, onTouchEnd: fn => { handlers.up = fn; }, onTouchCancel: fn => { handlers.cancel = fn; },
    onHide: fn => { handlers.hide = fn; }, onShow: fn => { handlers.show = fn; },
  };
  const sandbox = vm.createContext({ wx, console, setTimeout, clearTimeout });
  new vm.Script(code, { filename: 'protected-game.js' }).runInContext(sandbox, { timeout: 5000 });
  if (!handlers.down || !handlers.up || !handlers.hide || !handlers.show || !drawn.includes('六边形战争')) throw new Error('加固包未正常启动或未注册微信生命周期。');
  sandbox.smokeHandlers = handlers;
  new vm.Script('smokeHandlers.show(); smokeHandlers.resize(); smokeHandlers.cancel(); smokeHandlers.hide();').runInContext(sandbox, { timeout: 5000 });
  const saved = restore(storage.get('hexwar.save.v1'));
  if (!saved || serialize(saved) !== serialize(state)) throw new Error('加固包未正常保存或恢复本机战役。');
  return { platform: 'wechat', startup: true, localSave: true };
}
