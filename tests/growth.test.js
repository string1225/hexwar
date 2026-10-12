import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, growthAmount, restore, serialize, cloneState } from '../src/core/game.js';

function board(seed = 1) {
  const state = createGame({ size: 'small', enemies: 2, holes: false, seed: 'proportional-growth' });
  for (const c of Object.values(state.cells)) { c.owner = null; c.troops = 1; }
  for (const [id, owner] of [['0,0', 0], ['1,0', 1], ['0,1', 2]]) Object.assign(state.cells[id], { owner, troops: 100 });
  state.rng = seed; state.aiPending = ['0,0'];
  return state;
}
function finishRound(state) {
  do { state = applyCommand(state, { actor: state.current, type: 'END_TURN' }); } while (state.current !== 0);
  return state;
}

test('growth scales with a tile army, stays within rounding bounds and samples both sides of the baseline', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const state = board(seed), before = serialize(state);
    for (const troops of [1, 5, 10, 18, 50, 100, 1000, 9000]) {
      const cell = { id: '0,0', owner: 0, troops }, growth = growthAmount(state, cell);
      assert.ok(growth >= Math.max(1, Math.round(troops * 0.09)) && growth <= Math.max(1, Math.round(troops * 0.11)));
      if (troops === 100) seen.add(growth);
      assert.equal(growthAmount(state, { ...cell, owner: 1 }), growth); // No player / AI growth bonus.
    }
    assert.equal(serialize(state), before);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [9, 10, 11]);
});

test('growth waits for all factions, happens once, leaves neutrals unchanged and respects the troop cap', () => {
  let state = board(); Object.assign(state.cells['1,0'], { troops: 9998 }); Object.assign(state.cells['0,1'], { troops: 9999 });
  const initial = cloneState(state);
  state = applyCommand(state, { actor: 0, type: 'END_TURN' }); assert.deepEqual(state.cells, initial.cells);
  state = applyCommand(state, { actor: 1, type: 'END_TURN' }); assert.deepEqual(state.cells, initial.cells);
  state = applyCommand(state, { actor: 2, type: 'END_TURN' });
  assert.equal(state.round, 2); assert.ok(state.cells['0,0'].troops >= 109 && state.cells['0,0'].troops <= 111);
  assert.equal(state.cells['1,0'].troops, 9999); assert.equal(state.cells['0,1'].troops, 9999);
  assert.equal(state.logs.filter(l => l.type === 'growth').length, 1);
  for (const cell of Object.values(state.cells)) if (cell.owner === null) assert.equal(cell.troops, initial.cells[cell.id].troops);
});

test('growth uses armies after transport, respects the garrison, and does not relay newly grown troops', () => {
  let state = board(); state.cells['1,0'].owner = 0; state.cells['1,0'].troops = 1; state.cells['-1,0'].owner = 1;
  state = applyCommand(state, { actor: 0, type: 'MARCH', from: '0,0', to: '1,0', amount: 99, frequency: 'repeat' });
  state = applyCommand(state, { actor: 0, type: 'MARCH', from: '1,0', to: '0,0', amount: 99, frequency: 'repeat' });
  const next = finishRound(state);
  assert.equal(next.cells['0,0'].troops, 2); assert.ok(next.cells['1,0'].troops >= 109 && next.cells['1,0'].troops <= 111);
  assert.equal(next.orders.length, 2); assert.ok(restore(serialize(next)));
});

test('mid-round saves, completed-round reloads and reversed map traversal do not reroll or repeat growth', () => {
  let state = board(83);
  state = applyCommand(state, { actor: 0, type: 'END_TURN' });
  const resumed = restore(serialize(state)), reverse = cloneState(state);
  reverse.cells = Object.fromEntries(Object.entries(reverse.cells).reverse());
  const next = finishRound(state);
  assert.deepEqual(finishRound(resumed), next); assert.deepEqual(finishRound(reverse), next);
  assert.deepEqual(restore(serialize(next)), next);
  assert.notDeepEqual(finishRound(next).cells, next.cells);
});
