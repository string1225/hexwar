import { GameApp } from '../ui/app.js';

const canvas = document.querySelector('#battlefield');
const controls = document.querySelector('#controls');
const announcement = document.querySelector('#announcement');
const STORAGE_KEY = 'hexwar.save.v1';
let lastAnnouncement = '', lastControlSignature = '';
let currentButtons = [];

const platform = {
  canvas,
  size: () => ({ width: window.innerWidth, height: window.innerHeight, dpr: Math.min(3, window.devicePixelRatio || 1) }),
  image(path, done) { const image = new Image(); image.onload = done; image.src = path; return image; },
  load: () => localStorage.getItem(STORAGE_KEY),
  save: value => localStorage.setItem(STORAGE_KEY, value),
  onResize: callback => window.addEventListener('resize', callback),
  onPointer(callback) {
    for (const [event, type] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']]) {
      canvas.addEventListener(event, e => {
        if (event === 'pointerdown') canvas.setPointerCapture(e.pointerId);
        callback(type, e.clientX, e.clientY);
      });
    }
  },
  onKey: callback => window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;
    if ([' ', '+', '-', '=', 'Escape'].includes(event.key)) { event.preventDefault(); callback(event.key); }
  }),
  onWheel: callback => canvas.addEventListener('wheel', event => { event.preventDefault(); callback(event.deltaY, event.clientX, event.clientY); }, { passive: false }),
  cursor: value => { canvas.style.cursor = value; },
  syncControls(buttons, label) {
    currentButtons = buttons;
    if (label !== lastAnnouncement) { announcement.textContent = label; lastAnnouncement = label; }
    const signature = buttons.map(b => `${b.id}:${b.label}:${b.disabled}:${b.x}:${b.y}:${b.w}:${b.h}`).join('|');
    if (signature === lastControlSignature) return;
    lastControlSignature = signature;
    const focusId = document.activeElement?.dataset.controlId;
    controls.replaceChildren(...buttons.map(b => {
      const button = document.createElement('button');
      button.textContent = b.label; button.disabled = !!b.disabled; button.dataset.controlId = b.id;
      button.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
      button.addEventListener('click', () => { currentButtons.find(item => item.id === b.id)?.action(); app.render(); });
      return button;
    }));
    if (focusId) [...controls.children].find(b => b.dataset.controlId === focusId)?.focus({ preventScroll: true });
  },
};
const app = new GameApp(platform);
document.addEventListener('visibilitychange', () => { if (document.hidden) app.save(); });
window.addEventListener('pagehide', () => app.save());
