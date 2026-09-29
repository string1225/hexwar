import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, chooseAICommand, stats, SIZES, serialize, restore, winChance, SAVE_VERSION } from '../src/core/game.js';
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
  assert.equal(result.cells[a.id].troops, 18);
  assert.deepEqual(result.cells, state.cells); assert.equal(result.rng, state.rng);
  assert.equal(result.orders.length, 1); assert.equal(applyCommand(result, base).orders.length, 1);
  assert.equal(finishRound(result).cells[a.id].troops, 15);
});
test('friendly move conserves troops and reserves one garrison', () => {
  const { state, a, b } = scenario(); b.owner = 0;
  const sum = a.troops + b.troops;
  const next = finishRound(command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 }));
  assert.equal(next.cells[a.id].troops, 2);
  assert.equal(next.cells[a.id].troops + next.cells[b.id].troops, sum + 2);
});
test('probability targets 95% at 3:1, 50% at parity and complementary reverse odds', () => {
  assert.ok(Math.abs(winChance(15, 5) - 0.95) < 1e-12); assert.equal(winChance(5, 5), 0.5);
  assert.ok(Math.abs(winChance(5, 15) - 0.05) < 1e-12);
  for (const ratio of [0.1, 0.5, 1, 2, 3, 5, 20]) {
    assert.ok(Math.abs(winChance(ratio, 1) + winChance(1, ratio) - 1) < 1e-12);
    assert.ok(Math.abs(winChance(ratio * 10, 10) - winChance(ratio, 1)) < 1e-12);
  }
  assert.ok(winChance(20, 5) > winChance(10, 5)); assert.equal(winChance(0, 5), 0);
});
test('combat losses fluctuate slightly around half the losing army, with a surviving garrison', () => {
  const remaining = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const { state, a, b } = scenario(); b.troops = 10; a.troops = 31; state.rng = seed;
    const next = finishRound(command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 30 }));
    if (next.cells[b.id].owner === 0) {
      const troops = next.cells[b.id].troops - 1; // end-of-round supply
      assert.ok([24, 25, 26].includes(troops)); remaining.add(troops);
    } else assert.ok(next.cells[b.id].troops >= 1 && next.cells[b.id].troops <= 10);
  }
  assert.deepEqual([...remaining].sort(), [24, 25, 26]);
});

test('growth happens exactly once after every living faction takes a turn; neutrals do not grow', () => {
  const s = start(), initial = serialize(s), home = owned(s), neutral = Object.values(s.cells).find(c => c.owner === null);
  const ai = command(s, { type: 'END_TURN' }); assert.equal(ai.round, 1); assert.equal(ai.cells[home.id].troops, 18);
  const next = finishRound(s); assert.equal(next.round, 2); assert.equal(next.current, 0);
  assert.equal(next.cells[home.id].troops, 19); assert.equal(next.cells[neutral.id].troops, neutral.troops);
  assert.equal(serialize(s), initial);
});
test('recurring orders use the end-turn snapshot before growth and cannot relay arriving troops within a round', () => {
  let { state, a, b } = scenario();
  const c = neighbors(b, state.cells).find(c => c.id !== a.id && c.owner === null);
  b.owner = c.owner = 0; a.troops = 10; b.troops = c.troops = 1;
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 8 });
  state = command(state, { type: 'SET_ROUTE', from: b.id, to: c.id, amount: 8 });
  assert.equal(state.acted, false);
  const next = finishRound(state);
  assert.equal(next.cells[a.id].troops, 3); assert.equal(next.cells[b.id].troops, 10); assert.equal(next.cells[c.id].troops, 2);
  assert.equal(stats(next, 0).troops, 15);
});
test('a recurring march can be edited and removed, with strict ownership checks', () => {
  let { state, a, b } = scenario();
  assert.throws(() => command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 2 }));
  b.owner = 0;
  for (const amount of [0, 100, 1.5]) assert.throws(() => command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount }));
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 2 });
  state = command(state, { type: 'SET_ROUTE', from: a.id, to: b.id, amount: 5 });
  assert.equal(state.orders.length, 1); assert.equal(state.orders[0].amount, 5);
  state = command(state, { type: 'REMOVE_ROUTE', from: a.id }); assert.equal(state.orders.length, 0);
});

test('multiple manual orders can split one army and move different armies in the same turn', () => {
  let { state, a, b } = scenario();
  const c = neighbors(a, state.cells).find(c => c.id !== b.id && c.owner === null);
  b.owner = c.owner = 0; a.troops = 18; b.troops = c.troops = 5;
  const march = (from, to, amount) => { state = command(state, { type: 'MARCH', frequency: 'once', from, to, amount }); };
  march(a.id, b.id, 5); march(a.id, c.id, 4); march(b.id, a.id, 2);
  assert.equal(state.round, 1); assert.equal(state.current, 0);
  assert.equal(state.cells[a.id].troops, 18); assert.equal(state.orders.length, 3);
  state = finishRound(state);
  assert.equal(state.cells[a.id].troops, 12); assert.equal(state.cells[b.id].troops, 9); assert.equal(state.cells[c.id].troops, 10);
  assert.equal(stats(state, 0).troops, 31);
  assert.equal(state.orders.length, 0);
  assert.deepEqual(restore(serialize(state)), state);
});

test('multiple recurring directions share the source budget and cancel independently', () => {
  let { state, a, b } = scenario();
  const c = neighbors(a, state.cells).find(c => c.id !== b.id && c.owner === null);
  b.owner = c.owner = 0; a.troops = 10; b.troops = c.troops = 1;
  for (const target of [b, c]) state = command(state, { type: 'MARCH', frequency: 'repeat', from: a.id, to: target.id, amount: 8 });
  state = command(state, { type: 'MARCH', frequency: 'repeat', from: a.id, to: b.id, amount: 7 });
  assert.equal(state.orders.length, 2); assert.deepEqual(restore(serialize(state)), state);
  const next = finishRound(state);
  assert.equal(next.cells[a.id].troops, 2); assert.equal(next.cells[b.id].troops, 6); assert.equal(next.cells[c.id].troops, 7);
  assert.equal(stats(next, 0).troops, 15);
  state = command(state, { type: 'CANCEL_MARCH', from: a.id, to: b.id });
  assert.equal(state.orders.length, 1); assert.equal(state.orders[0].to, c.id);
});

test('AI handles multiple starting territories, persists remaining orders and ends its turn', () => {
  let { state, a, b } = scenario();
  b.owner = 1; b.troops = 15;
  state = command(state, { type: 'END_TURN' });
  const starting = [...state.aiPending], sources = [];
  assert.equal(starting.length, 2);
  while (state.current === 1 && state.phase === 'playing') {
    const cmd = chooseAICommand(state);
    if (cmd.type === 'MARCH') sources.push(cmd.from);
    state = restore(serialize(applyCommand(state, cmd)));
    assert.ok(state); assert.ok(sources.length <= starting.length);
  }
  assert.equal(new Set(sources).size, 2); assert.ok(sources.every(id => starting.includes(id)));
  assert.equal(state.cells[a.id].owner, 0);
});

test('legacy saves migrate and already-completed AI turns do not replay', () => {
  for (const acted of [false, true]) {
    const old = start(); old.version = 1; old.current = 1; old.acted = acted; old.routes = []; delete old.orders; delete old.aiPending;
    const migrated = restore(serialize(old));
    assert.equal(migrated.version, SAVE_VERSION); assert.deepEqual(migrated.cells, old.cells);
    assert.equal(migrated.current, 0); assert.equal(migrated.aiPending.length, 1);
    assert.equal(migrated.orders.length, 0); assert.equal(migrated.rng, old.rng);
  }
});
test('capturing a route endpoint cancels the route and eliminates the faction if it was the last tile', () => {
  let { state, a, b } = scenario();
  const oldHome = owned(state, 1); oldHome.owner = null; b.owner = 1; b.troops = 1;
  const c = neighbors(b, state.cells).find(c => c.owner === null); c.owner = 1;
  state.orders.push({ owner: 1, from: b.id, to: c.id, amount: 3, frequency: 'repeat' }); state.rng = 1;
  state = command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 });
  state = finishRound(state);
  assert.equal(state.orders.length, 0);
  assert.equal(state.phase, 'playing');
});
test('victory needs elimination of colored enemies, not occupation of neutral territory', () => {
  const { state, a, b } = scenario();
  for (const c of Object.values(state.cells)) if (c.owner !== 0) c.owner = null;
  b.owner = 1; b.troops = 1; state.rng = 1;
  const next = finishRound(command(state, { type: 'MOVE', from: a.id, to: b.id, amount: 17 }));
  assert.equal(next.phase, 'finished'); assert.equal(next.winner, 0);
  assert.ok(Object.values(next.cells).some(c => c.owner === null));
  assert.throws(() => command(next, { type: 'END_TURN' }));
});
test('player defeat ends the session even if several AI factions remain', () => {
  const { state, a, b } = scenario(); b.owner = 1; b.troops = 100; a.troops = 1; state.current = 1; state.rng = 1;
  const next = finishRound(command(state, { type: 'MOVE', from: b.id, to: a.id, amount: 90 }));
  assert.equal(next.phase, 'finished'); assert.equal(next.winner, null);
});
test('turn rotation skips eliminated factions', () => {
  const s = start(); owned(s, 1).owner = null;
  assert.equal(command(s, { type: 'END_TURN' }).current, 2);
});
test('valid saves roundtrip; corrupt and incompatible saves are rejected', () => {
  const s = start(); assert.deepEqual(restore(serialize(s)), s);
  for (const raw of ['', 'null', '{', '{}', '{"version":999}', '[]']) assert.equal(restore(raw), null);
  const changes = [s => { s.cells = {}; }, s => { owned(s).troops = -1; }, s => { owned(s).owner = 100; }, s => { s.rng = 0; }, s => { s.current = 9; }, s => { s.orders = [{ from: 'bad' }]; }, s => { s.config.size = '__proto__'; }];
  for (const change of changes) { const bad = start(); change(bad); assert.equal(restore(bad), null); }
});

test('editing and cancelling planned attacks never changes the battlefield or random stream', () => {
  let { state, a, b } = scenario();
  const initial = serialize(state.cells), rng = state.rng;
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 5, frequency: 'once' });
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 9, frequency: 'once' });
  assert.equal(state.orders.length, 1); assert.equal(state.orders[0].amount, 9);
  assert.equal(serialize(state.cells), initial); assert.equal(state.rng, rng);
  assert.deepEqual(restore(serialize(state)), state);
  state = command(state, { type: 'CANCEL_MARCH', from: a.id, to: b.id });
  state = command(state, { type: 'END_TURN' });
  assert.equal(state.orders.length, 0); assert.equal(serialize(state.cells), initial); assert.equal(state.rng, rng);
});

test('all factions lock plans before any movement; once and repeat orders share proportional budgets', () => {
  let { state, a, b } = scenario();
  const c = neighbors(a, state.cells).find(cell => cell.id !== b.id && cell.owner === null);
  b.owner = c.owner = 0; a.troops = 18; b.troops = c.troops = 1;
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 10, frequency: 'once' });
  state = command(state, { type: 'MARCH', from: a.id, to: c.id, amount: 10, frequency: 'repeat' });
  const board = serialize(state.cells);
  state = command(restore(serialize(state)), { type: 'END_TURN' });
  assert.equal(serialize(state.cells), board); assert.equal(state.orders.length, 2);
  assert.deepEqual(restore(serialize(state)), state);
  state = command(state, { type: 'END_TURN' });
  assert.equal(serialize(state.cells), board);
  state = command(state, { type: 'END_TURN' });
  assert.equal(state.current, 0); assert.equal(state.cells[a.id].troops, 2);
  assert.deepEqual([state.cells[b.id].troops, state.cells[c.id].troops].sort((a, b) => a - b), [10, 11]);
  assert.equal(state.orders.length, 1); assert.equal(state.orders[0].frequency, 'repeat');
  const previous = state.cells[c.id].troops;
  state = finishRound(state);
  assert.equal(state.cells[a.id].troops, 2); assert.equal(state.cells[c.id].troops, previous + 2);
});

test('changing frequency replaces the same order without duplicating it', () => {
  let { state, a, b } = scenario(); b.owner = 0;
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 4, frequency: 'repeat' });
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 5, frequency: 'once' });
  assert.equal(state.orders.length, 1); assert.equal(state.orders[0].frequency, 'once');
  const before = state.cells[b.id].troops;
  state = finishRound(state);
  assert.equal(state.cells[b.id].troops, before + 6); assert.equal(state.orders.length, 0);
});

test('end-turn transfers respect capacity and never forward arrivals through cycles', () => {
  let { state, a, b } = scenario(); b.owner = 0; a.troops = 10; b.troops = 9998;
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 9, frequency: 'once' });
  state = command(state, { type: 'MARCH', from: b.id, to: a.id, amount: 9997, frequency: 'once' });
  state = finishRound(state);
  assert.equal(state.cells[a.id].troops, 9999); assert.equal(state.cells[b.id].troops, 11);
  assert.ok(restore(serialize(state)));
});

test('version 2 routes migrate to planned repeating orders without executing or losing the map', () => {
  const { state, a, b } = scenario(); b.owner = 0;
  state.version = 2; state.routes = [{ owner: 0, from: a.id, to: b.id, amount: 5 }]; delete state.orders;
  const migrated = restore(serialize(state));
  assert.equal(migrated.version, SAVE_VERSION); assert.deepEqual(migrated.cells, state.cells);
  assert.equal(migrated.orders[0].frequency, 'repeat'); assert.equal(migrated.orders[0].amount, 5);
  assert.equal(migrated.rng, state.rng); assert.equal('routes' in migrated, false);
});

test('invalid and duplicate plans are rejected when restoring', () => {
  let { state, a, b } = scenario();
  state = command(state, { type: 'MARCH', from: a.id, to: b.id, amount: 4, frequency: 'once' });
  for (const change of [s => { s.orders.push({ ...s.orders[0] }); }, s => { s.orders[0].frequency = 'now'; }, s => { s.orders[0].amount = 10000; }, s => { s.orders[0].owner = 1; }, s => { s.orders[0].frequency = 'repeat'; }]) {
    const invalid = JSON.parse(serialize(state)); change(invalid); assert.equal(restore(invalid), null);
  }
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
