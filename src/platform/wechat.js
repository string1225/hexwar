import { GameApp } from '../ui/app.js';

const canvas = wx.createCanvas();
const STORAGE_KEY = 'hexwar.save.v1';
const platform = {
  canvas,
  size() {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const safe = info.safeArea;
    const capsule = typeof wx.getMenuButtonBoundingClientRect === 'function' ? wx.getMenuButtonBoundingClientRect() : null;
    return {
      width: info.windowWidth, height: info.windowHeight, dpr: Math.min(3, info.pixelRatio || 1),
      top: Math.max(safe?.top || 0, capsule?.bottom ? capsule.bottom + 6 : 0),
      bottom: safe ? Math.max(0, info.screenHeight - safe.bottom) : 0,
    };
  },
  image(path, done) { const image = wx.createImage(); image.onload = done; image.src = path; return image; },
  load: () => wx.getStorageSync(STORAGE_KEY),
  save: data => wx.setStorageSync(STORAGE_KEY, data),
  onResize: callback => { if (wx.onWindowResize) wx.onWindowResize(callback); },
  onPointer(callback) {
    let activeId = null;
    wx.onTouchStart(event => {
      if (activeId !== null) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      activeId = touch.identifier; callback('down', touch.clientX, touch.clientY);
    });
    wx.onTouchMove(event => {
      const touch = event.touches.find(t => t.identifier === activeId);
      if (touch) callback('move', touch.clientX, touch.clientY);
    });
    wx.onTouchEnd(event => {
      const touch = event.changedTouches.find(t => t.identifier === activeId);
      if (touch) { activeId = null; callback('up', touch.clientX, touch.clientY); }
    });
    wx.onTouchCancel(() => { activeId = null; callback('cancel', 0, 0); });
  },
  feedback: () => { if (wx.vibrateShort) wx.vibrateShort({ type: 'light' }); },
};
const app = new GameApp(platform);
wx.onHide(() => app.save());
wx.onShow(() => app.render());
