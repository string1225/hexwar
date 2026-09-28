import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { GameApp } from '../src/ui/app.js';
import { createGame, serialize, applyCommand } from '../src/core/game.js';
import { neighbors } from '../src/core/hex.js';

function context() {
  return new Proxy({
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: text => ({ width: text.length * 8 }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
}
function platform(width = 390, height = 844, save = null, safe = {}) {
  let stored = save;
  return {
    canvas: { width: 0, height: 0, getContext: () => context() },
    image: () => ({}), load: () => stored, save: data => { stored = data; },
    size: () => ({ width, height, dpr: 2, ...safe }),
    onResize() {}, onPointer() {}, onKey() {}, onWheel() {},
  };
}
function click(app, id) {
  const b = app.buttons.find(b => b.id === id);
  assert.ok(b, `Missing button ${id}`); assert.ok(!b.disabled, `Disabled button ${id}`);
  app.pointer('down', b.x + b.w / 2, b.y + b.h / 2);
  app.pointer('up', b.x + b.w / 2, b.y + b.h / 2);
}
function overlaps(a, b) {
  return Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5;
}

test('all main controls remain visible and non-overlapping on desktop, portrait and landscape', () => {
  for (const [w, h, safe] of [[1440, 900], [1280, 720], [1024, 768], [390, 844], [375, 667], [320, 568], [844, 390], [390, 844, { top: 88, bottom: 34 }], [375, 667, { top: 50, bottom: 20 }]]) {
    const app = new GameApp(platform(w, h, null, safe));
    for (const modal of ['setup', null, 'rules', 'result']) {
      app.modal = modal; app.render();
      for (const b of app.buttons) {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, `${w}×${h} ${modal} ${b.id} is offscreen: ${JSON.stringify(b)}`);
        assert.ok(b.w >= 20 && b.h >= 25, `${b.id} is too small`);
      }
      for (let i = 0; i < app.buttons.length; i++) for (let j = i + 1; j < app.buttons.length; j++) {
        assert.ok(!overlaps(app.buttons[i], app.buttons[j]), `${w}×${h} ${modal}: ${app.buttons[i].id} overlaps ${app.buttons[j].id}`);
      }
    }
  }
});
test('setup chooses requested size and enemy count; tapping dispatch uses real game rules', () => {
  const p = platform(), app = new GameApp(p);
  click(app, 'size-small'); click(app, 'enemies-1'); click(app, 'start-game');
  assert.equal(app.state.config.size, 'small'); assert.equal(app.state.config.enemies, 1);
  const home = app.state.cells[app.selected], target = neighbors(home, app.state.cells).find(c => c.owner === null);
  app.chooseCell(target.id); click(app, 'amount-2');
  assert.equal(app.amount, 17); click(app, 'dispatch');
  assert.equal(app.state.acted, true); assert.equal(app.state.cells[home.id].troops, 1);
  assert.ok(app.buttons.find(b => b.id === 'dispatch').disabled);
  assert.equal(JSON.parse(p.load()).acted, true);
  clearTimeout(app.toastTimer);
});
test('route configuration, route deletion and friendly source reselection work through UI controls', () => {
  const state = createGame({ size: 'small', enemies: 1, seed: 'route-ui' });
  const home = Object.values(state.cells).find(c => c.owner === 0);
  const target = neighbors(home, state.cells).find(c => c.owner === null); target.owner = 0;
  const app = new GameApp(platform(390, 844, serialize(state)));
  app.chooseCell(target.id); click(app, 'transport'); click(app, 'dispatch');
  assert.equal(app.state.routes.length, 1); assert.equal(app.state.acted, false);
  click(app, `remove-${home.id}`); assert.equal(app.state.routes.length, 0);
  app.chooseCell(target.id); app.chooseCell(target.id); assert.equal(app.selected, target.id);
  clearTimeout(app.toastTimer);
});
test('new campaigns keep size preferences but generate a fresh map seed', () => {
  const saved = createGame({ size: 'large', enemies: 5, seed: 'previous-campaign' });
  const app = new GameApp(platform(390, 844, serialize(saved)));
  click(app, 'new'); click(app, 'start-game');
  assert.equal(app.state.config.size, 'large'); assert.equal(app.state.config.enemies, 5);
  assert.notEqual(app.state.config.seed, 'previous-campaign');
  assert.notDeepEqual(app.state.cells, saved.cells);
});
test('winning through the UI shows a result, persists it and allows another campaign', () => {
  const state = createGame({ size: 'small', enemies: 1, seed: 'winning-ui' });
  const home = Object.values(state.cells).find(c => c.owner === 0);
  for (const c of Object.values(state.cells)) if (c.owner === 1) c.owner = null;
  const target = neighbors(home, state.cells)[0]; target.owner = 1; target.troops = 1; state.rng = 1;
  const p = platform(390, 844, serialize(state)), app = new GameApp(p);
  app.chooseCell(target.id); click(app, 'amount-2'); click(app, 'dispatch');
  assert.equal(app.state.winner, 0); assert.equal(app.modal, 'result');
  const resumed = new GameApp(p); assert.equal(resumed.modal, 'result');
  click(resumed, 'play-again'); assert.equal(resumed.modal, 'setup');
  click(resumed, 'start-game'); assert.equal(resumed.state.phase, 'playing');
});
test('cloud actions are explicit, validate downloaded saves and preserve local play on errors', async () => {
  const p = platform(), remote = createGame({ size: 'small', enemies: 1, seed: 'cloud-restore' });
  let writes = 0;
  p.cloud = {
    read: async () => ({ revision: 4, state: remote }),
    write: async (_state, revision) => { writes++; assert.equal(revision, 4); return { revision: 5, savedAt: Date.now() }; },
  };
  const app = new GameApp(p); app.newGame(); const local = serialize(app.state);
  app.tab = 'cloud'; await app.readCloud();
  assert.equal(serialize(app.state), local); // Opening the tab never overwrites local progress.
  app.restoreCloud(); assert.equal(app.state.config.seed, 'cloud-restore');
  await app.writeCloud(); assert.equal(writes, 1); assert.equal(app.cloudRecord.revision, 5);
  for (const b of app.buttons) assert.ok(b.x >= 0 && b.x + b.w <= 390 && b.y + b.h <= 844);
  p.cloud.read = async () => { throw new Error('offline'); };
  const before = serialize(app.state); await app.readCloud();
  assert.equal(serialize(app.state), before); assert.equal(app.cloudBusy, false); assert.equal(app.cloudError, 'offline');
  clearTimeout(app.toastTimer);
});
test('reloading an AI turn resumes once, grows once, and returns to player', async () => {
  let state = createGame({ size: 'small', enemies: 1, seed: 'resume' });
  state = applyCommand(state, { type: 'END_TURN', actor: 0 });
  const p = platform(390, 844, serialize(state)); const app = new GameApp(p);
  await new Promise(resolve => setTimeout(resolve, 1050));
  assert.equal(app.state.current, 0); assert.equal(app.state.round, 2); assert.equal(app.busy, false);
  assert.equal(app.state.logs.filter(l => l.type === 'capture' || l.type === 'battle' || l.type === 'transfer').length, 1);
});
test('starting a new game invalidates an in-flight AI task', async () => {
  const app = new GameApp(platform()); app.newGame(); app.endTurn(); app.newGame();
  const expected = serialize(app.state);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(serialize(app.state), expected); assert.equal(app.busy, false);
});
test('WeChat bundle boots with wx APIs, handles touches and persists without any DOM globals', async () => {
  const { outputFiles } = await build({ entryPoints: ['src/platform/wechat.js'], bundle: true, write: false, format: 'iife', target: 'es2019' });
  const handlers = {}, storage = new Map(), ctx = context();
  const wx = {
    createCanvas: () => ({ width: 0, height: 0, getContext: () => ctx }), createImage: () => ({}),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, screenHeight: 844, pixelRatio: 3, safeArea: { top: 47, bottom: 810 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 82 }),
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    onWindowResize: fn => { handlers.resize = fn; }, onTouchStart: fn => { handlers.down = fn; },
    onTouchEnd: fn => { handlers.up = fn; }, onTouchMove: fn => { handlers.move = fn; }, onTouchCancel: fn => { handlers.cancel = fn; },
    onHide: fn => { handlers.hide = fn; }, onShow: fn => { handlers.show = fn; },
  };
  vm.runInNewContext(outputFiles[0].text, { wx, setTimeout, clearTimeout });
  assert.ok(handlers.down && handlers.up && handlers.hide);
  handlers.show(); handlers.resize();
  handlers.down({ changedTouches: [{ identifier: 1, clientX: 370, clientY: 10 }] });
  handlers.cancel(); handlers.up({ changedTouches: [] });
  handlers.hide();
  assert.equal(JSON.parse(storage.get('hexwar.save.v1')).version, 1);
});
