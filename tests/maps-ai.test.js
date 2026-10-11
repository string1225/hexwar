import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, chooseAICommand, applyCommand, restore, serialize, SIZES, SHAPES, DIFFICULTIES, SAVE_VERSION } from '../src/core/game.js';
import { neighbors, distance } from '../src/core/hex.js';
import { mapLayout, pathDistances } from '../src/core/map.js';

test('both outlines have seeded interior holes, connected cells, and separated random starts at every size', () => {
  const spawnPatterns = new Set(), holePatterns = new Set();
  for (const size of Object.keys(SIZES)) for (const shape of Object.keys(SHAPES)) for (let enemies = 1; enemies <= 5; enemies++) for (let seed = 1; seed <= 12; seed++) {
    const state = createGame({ size, shape, enemies, seed: 'map-' + seed });
    const layout = mapLayout(SIZES[size].radius, shape), ids = Object.keys(state.cells);
    const missing = Object.keys(layout).filter(id => !state.cells[id]);
    assert.ok(missing.length > 0 && missing.length <= Math.ceil(Object.keys(layout).length * 0.12));
    assert.ok(missing.every(id => neighbors(layout[id], layout).length === 6));
    assert.equal(pathDistances(state.cells, [ids[0]]).size, ids.length);
    const spawns = Object.values(state.cells).filter(c => c.owner !== null);
    assert.equal(spawns.length, enemies + 1);
    assert.ok(spawns.every(c => c.troops === 18 && neighbors(c, state.cells).length >= 3));
    assert.ok(spawns.every(a => spawns.every(b => a === b || distance(a, b) >= 2)));
    assert.deepEqual(createGame(state.config), state);
    assert.deepEqual(restore(serialize(state)), state);
    if (size === 'small' && shape === 'hexagon' && enemies === 5) {
      spawnPatterns.add(spawns.map(c => c.id).sort().join(';')); holePatterns.add(missing.sort().join(';'));
    }
  }
  assert.ok(spawnPatterns.size >= 8); assert.ok(holePatterns.size >= 8);
});

test('holes cannot be selected as a destination or forged into a saved map', () => {
  const state = createGame({ size: 'small', shape: 'rectangle', seed: 'missing-cell' });
  const layout = mapLayout(3, 'rectangle'), missing = Object.keys(layout).find(id => !state.cells[id]);
  const source = Object.values(state.cells).find(c => c.owner === 0);
  assert.throws(() => applyCommand(state, { actor: 0, type: 'MARCH', from: source.id, to: missing, amount: 1, frequency: 'once' }));
  const added = JSON.parse(serialize(state)); added.cells[missing] = { ...layout[missing], owner: null, troops: 1, terrain: 0 };
  assert.equal(restore(added), null);
  const removed = JSON.parse(serialize(state)); delete removed.cells[source.id]; assert.equal(restore(removed), null);
  for (const config of [{ shape: 'triangle' }, { shape: '__proto__' }, { difficulty: 'impossible' }, { holes: 1 }]) {
    assert.throws(() => createGame(config)); const invalid = JSON.parse(serialize(state)); Object.assign(invalid.config, config); assert.equal(restore(invalid), null);
  }
});

test('v5 campaigns retain their board, plans, turn and RNG, with full hexagon and standard AI defaults', () => {
  let state = createGame({ size: 'small', holes: false, seed: 'old-map' });
  const home = Object.values(state.cells).find(c => c.owner === 0), target = neighbors(home, state.cells)[0];
  state = applyCommand(state, { actor: 0, type: 'MARCH', from: home.id, to: target.id, amount: 4, frequency: 'once' });
  state = applyCommand(state, { actor: 0, type: 'END_TURN' }); state.version = 5;
  delete state.config.shape; delete state.config.holes; delete state.config.difficulty;
  const migrated = restore(serialize(state));
  assert.equal(migrated.version, SAVE_VERSION); assert.equal(migrated.config.shape, 'hexagon'); assert.equal(migrated.config.holes, false); assert.equal(migrated.config.difficulty, 'standard');
  for (const field of ['cells', 'orders', 'current', 'rng', 'aiPending', 'round']) assert.deepEqual(migrated[field], state[field]);
  assert.deepEqual(restore(serialize(migrated)), migrated);
});

function tacticalBoard(difficulty) {
  const state = createGame({ size: 'small', enemies: 1, holes: false, difficulty, seed: 'tactics' });
  for (const c of Object.values(state.cells)) { c.owner = null; c.troops = 999; }
  Object.assign(state.cells['0,0'], { owner: 0, troops: 8 });
  Object.assign(state.cells['-1,0'], { owner: 1, troops: 11 });
  Object.assign(state.cells['0,-1'], { owner: 1, troops: 11 });
  state.current = 1; state.aiPending = ['-1,0', '0,-1'];
  return state;
}

test('advanced AI coordinates otherwise unfavorable individual attacks; standard waits rather than attacking', () => {
  const standard = tacticalBoard('standard'); assert.equal(chooseAICommand(standard).type, 'END_TURN');
  let advanced = tacticalBoard('advanced');
  for (let i = 0; i < 2; i++) {
    const before = serialize(advanced), next = chooseAICommand(advanced);
    assert.equal(next.type, 'MARCH'); assert.equal(next.to, '0,0'); assert.equal(next.amount, 7);
    assert.equal(serialize(advanced), before); assert.deepEqual(next, chooseAICommand(advanced));
    advanced = applyCommand(advanced, next);
  }
  assert.equal(advanced.orders.reduce((sum, o) => sum + o.amount, 0), 14);
  assert.equal(chooseAICommand(advanced).type, 'END_TURN');
});

test('stronger AI sends rear troops along friendly paths toward the frontier and never reads player plans', () => {
  for (const difficulty of ['standard', 'advanced']) {
    const state = tacticalBoard(difficulty);
    for (const c of Object.values(state.cells)) { c.owner = 1; c.troops = 1; }
    state.cells['3,0'].owner = 0; state.cells['3,0'].troops = 30;
    state.cells['-3,0'].troops = 18; state.aiPending = ['-3,0'];
    const next = chooseAICommand(state);
    assert.equal(next.type, 'MARCH');
    const fronts = Object.values(state.cells).filter(c => c.owner === 1 && neighbors(c, state.cells).some(n => n.owner !== 1));
    const dist = pathDistances(state.cells, fronts.map(c => c.id));
    assert.ok(dist.get(next.to) < dist.get(next.from));
    const hidden = JSON.parse(serialize(state)); hidden.orders.push({ owner: 0, from: '3,0', to: '2,0', frequency: 'once', amount: 29 });
    assert.deepEqual(chooseAICommand(hidden), next);
  }
});

test('all three strategies run legal, deterministic, bounded campaigns on both perforated outlines', () => {
  for (const shape of Object.keys(SHAPES)) for (const difficulty of Object.keys(DIFFICULTIES)) for (let seed = 1; seed <= 3; seed++) {
    let state = createGame({ size: 'small', enemies: 3, shape, difficulty, seed: 'strategy-' + seed });
    let moves = 0;
    for (let step = 0; step < 250 && state.phase === 'playing'; step++) {
      const next = chooseAICommand(state);
      assert.deepEqual(next, chooseAICommand(state));
      if (next.type === 'END_TURN') { moves = 0; } else { moves++; assert.ok(moves <= Object.keys(state.cells).length); }
      state = applyCommand(state, next);
      assert.ok(Object.values(state.cells).every(c => Number.isInteger(c.troops) && c.troops >= 1 && c.troops <= 9999));
      if (step % 25 === 0) assert.deepEqual(restore(serialize(state)), state);
    }
  }
});
