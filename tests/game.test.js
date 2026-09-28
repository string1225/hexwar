import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, chooseAICommand, stats, SIZES, serialize, restore, winChance } from '../src/core/game.js';
import { distance, neighbors, toPixel, fromPixel } from '../src/core/hex.js';

const start = options => createGame({ seed: 'hexwar-test', enemies: 2, ...options });
const owned = (state, owner = 0) => Object.values(state.cells).find(c => c.owner === owner);
const command = (state, value) => applyCommand(state, { actor: state.current, ...value });
function scenario() {
  const state = start({ size: 'small' });
  const a = owned(state), b = neighbors(a, state.cells).find(c => c.owner === null);
  return { state, a, b };
}
function finishRound(state) {
  do { state = command(state, { type: 'END_TURN' }); } while (state.current !== 0);
  return state;
}

test('all map sizes generate connected hex grids and spaced, equal starts', () => {
  for (const [size, config] of Object.entries(SIZES)) for (let enemies = 1; enemies <= 5; enemies++) {
    const s = start({ size, enemies });
    assert.equal(Object.keys(s.cells).length, config.cells);
    const homes = Object.values(s.cells).filter(c => c.owner !== null);
    assert.equal(homes.length, enemies + 1);
    assert.ok(homes.every(c => c.troops === 18));
    assert.ok(homes.every(a => homes.every(b => a === b || distance(a, b) >= 2)));
    const visited = new Set(), queue = [Object.values(s.cells)[0]];
    while (queue.length) { const c = queue.shift(); if (visited.has(c.id)) continue; visited.add(c.id); queue.push(...neighbors(c, s.cells).filter(n => !visited.has(n.id))); }
    assert.equal(visited.size, config.cells);
  }
});
test('same seed reproduces a game; different seeds change the map', () => {
  assert.deepEqual(start(), start());
  assert.notDeepEqual(start(), start({ seed: 'another' }));
});
test('axial conversion roundtrips every cell at multiple zoom levels', () => {
  for (const c of Object.values(start({ size: 'large' }).cells)) for (const size of [9, 23, 65]) {
    const p = toPixel(c.q, c.r, size); assert.equal(fromPixel(p.x, p.y, size), c.id);
  }
});
test('moves validate turn, adjacency, ownership and integer troops without mutating input', () => {
  const { state, a, b } = scenario(), before = serialize(state);
  const base = { type: 'MOVE', actor: 0, from: a.id, to: b.id, amount: 4 };
  for (const change of [{ amount: 0 }, { amount: 1.5 }, { amount: 18 }, { amount: NaN }, { actor: 1 }, { from: b.id }, { to: a.id }, { to: '999,999' }]) assert.throws(() => applyCommand(state, { ...base, ...change }));
  assert.equal(serialize(state), before);
  const result = applyCommand(state, base);
  assert.equal(serialize(state), before);
  assert.equal(result.cells[a.id].troops, 14);
  assert.throws(() => applyCommand(result, base), /本回合已行动/);
});
test('friendly move conserves troops and reserves one garrison', () => {
  const { state, a, b } = scenario(); b.owner = 0;
  const sum = a.troops + b.troops;
  const next = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 });
  assert.equal(next.cells[a.id].troops, 1);
  assert.equal(next.cells[a.id].troops + next.cells[b.id].troops, sum);
});
test('probability grows with army size and is symmetric at equal forces', () => {
  assert.equal(winChance(10, 5), 0.8); assert.equal(winChance(5, 5), 0.5);
  assert.ok(winChance(20, 5) > winChance(10, 5)); assert.equal(winChance(0, 5), 0);
});
test('victory and defeat use the stated casualties', () => {
  const { state, a, b } = scenario(); b.troops = 5;
  state.rng = 1; // next draw ~0.00006
  const won = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 10 });
  assert.equal(won.cells[b.id].owner, 0); assert.equal(won.cells[b.id].troops, 7);
  state.rng = 123456; b.troops = 100;
  const lost = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 3 });
  assert.equal(lost.cells[b.id].owner, null); assert.equal(lost.cells[b.id].troops, 99);
});
test('growth happens exactly once after every living faction takes a turn; neutrals do not grow', () => {
  const s = start(), initial = serialize(s), home = owned(s), neutral = Object.values(s.cells).find(c => c.owner === null);
  const ai = command(s, { type: 'END_TURN' }); assert.equal(ai.round, 1); assert.equal(ai.cells[home.id].troops, 18);
  const next = finishRound(s); assert.equal(next.round, 2); assert.equal(next.current, 0);
  assert.equal(next.cells[home.id].troops, 19); assert.equal(next.cells[neutral.id].troops, neutral.troops);
  assert.equal(serialize(s), initial);
});
test('automatic transport uses post-growth snapshot and cannot relay arriving troops within a round', () => {
  let { state, a, b } = scenario();
  const c = neighbors(b, state.cells).find(c => c.id !== a.id && c.owner === null);
  b.owner = c.owner = 0; a.troops = 10; b.troops = c.troops = 1;
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 8 });
  state = command(state, { type: 'SET_ROUTE', from: b.id, to: c.id, amount: 8 });
  assert.equal(state.acted, false);
  const next = finishRound(state);
  assert.equal(next.cells[a.id].troops, 3); assert.equal(next.cells[b.id].troops, 9); assert.equal(next.cells[c.id].troops, 3);
  assert.equal(stats(next, 0).troops, 15);
});
test('one outgoing route per cell can be edited and removed, with strict ownership checks', () => {
  let { state, a, b } = scenario();
  assert.throws(() => command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 2 }));
  b.owner = 0;
  for (const amount of [0, 100, 1.5]) assert.throws(() => command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount }));
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 2 });
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 5 });
  assert.equal(state.routes.length, 1); assert.equal(state.routes[0].amount, 5);
  state = command(state, { type: 'REMOVE_ROUTE', from: a.id }); assert.equal(state.routes.length, 0);
});
test('capturing a route endpoint cancels the route and eliminates the faction if it was the last tile', () => {
  let { state, a, b } = scenario();
  const oldHome = owned(state, 1); oldHome.owner = null; b.owner = 1; b.troops = 1;
  const c = neighbors(b, state.cells).find(c => c.owner === null); c.owner = 1;
  state.routes.push({ owner: 1, from: b.id, to: c.id, amount: 3 }); state.rng = 1;
  state = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 });
  assert.equal(state.routes.length, 0);
  assert.equal(state.phase, 'playing');
});
test('victory needs elimination of colored enemies, not occupation of neutral territory', () => {
  const { state, a, b } = scenario();
  for (const c of Object.values(state.cells)) if (c.owner !== 0) c.owner = null;
  b.owner = 1; b.troops = 1; state.rng = 1;
  const next = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 });
  assert.equal(next.phase, 'finished'); assert.equal(next.winner, 0);
  assert.ok(Object.values(next.cells).some(c => c.owner === null));
  assert.throws(() => command(next, { type: 'END_TURN' }));
});
test('player defeat ends the session even if several AI factions remain', () => {
  const { state, a, b } = scenario(); b.owner = 1; b.troops = 100; a.troops = 1; state.current = 1; state.rng = 1;
  const next = command(state, { type: 'MOVE', from: b.id, to: a.id, amount: 90 });
  assert.equal(next.phase, 'finished'); assert.equal(next.winner, null);
});
test('turn rotation skips eliminated factions', () => {
  const s = start(); owned(s, 1).owner = null;
  assert.equal(command(s, { type: 'END_TURN' }).current, 2);
});
test('valid saves roundtrip; corrupt and incompatible saves are rejected', () => {
  const s = start(); assert.deepEqual(restore(serialize(s)), s);
  for (const raw of ['', 'null', '{', '{}', '{"version":999}', '[]']) assert.equal(restore(raw), null);
  const changes = [s => { s.cells = {}; }, s => { owned(s).troops = -1; }, s => { owned(s).owner = 100; }, s => { s.rng = 0; }, s => { s.current = 9; }, s => { s.routes = [{ from: 'bad' }]; }, s => { s.config.size = '__proto__'; }];
  for (const change of changes) { const bad = start(); change(bad); assert.equal(restore(bad), null); }
});
test('AI decisions are legal, replayable, bounded and maintain state invariants over long games', () => {
  for (const size of Object.keys(SIZES)) for (let seed = 1; seed <= 8; seed++) {
    let s = start({ size, seed, enemies: 5 });
    for (let i = 0; i < 500 && s.phase === 'playing'; i++) {
      const cmd = chooseAICommand(s);
      assert.deepEqual(cmd, chooseAICommand(s));
      s = applyCommand(s, cmd);
      assert.ok(Object.values(s.cells).every(c => Number.isInteger(c.troops) && c.troops >= 1 && c.troops <= 9999));
      assert.ok(restore(serialize(s)));
    }
  }
});
