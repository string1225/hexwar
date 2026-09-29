import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, availableTroops, cloneState, restore, serialize, SAVE_VERSION } from '../src/core/game.js';
import { neighbors } from '../src/core/hex.js';

function fixture() {
  const state = createGame({ size: 'small', enemies: 2, seed: 'troop-budget' });
  const a = Object.values(state.cells).find(c => c.owner === 0);
  const [b, c, d] = neighbors(a, state.cells).filter(c => c.owner === null);
  a.troops = 10;
  for (const cell of [b, c, d]) { cell.owner = 0; cell.troops = 1; }
  return { state, a, b, c, d };
}
const march = (state, from, to, amount, frequency = 'once') => applyCommand(state, { type: 'MARCH', actor: 0, from: from.id, to: to.id, amount, frequency });
function finish(state) {
  do { state = applyCommand(state, { type: 'END_TURN', actor: state.current }); } while (state.current !== 0);
  return state;
}

test('10 troops reserve 1 garrison: after planning 6, other directions can only reserve 3', () => {
  let { state, a, b, c } = fixture();
  state = march(state, a, b, 6);
  assert.equal(availableTroops(state, a.id), 3);
  const before = serialize(state);
  assert.throws(() => march(state, a, c, 4), /本回合可调兵力不足/);
  assert.equal(serialize(state), before);
  state = march(state, a, c, 3);
  assert.equal(availableTroops(state, a.id), 0);
  const next = finish(state);
  assert.equal(next.cells[a.id].troops, 2); // 1 garrison + 1 supply
  assert.equal(next.cells[b.id].troops, 8); assert.equal(next.cells[c.id].troops, 5);
});

test('editing replaces its reservation; cancellation and conversion to repeating free the budget', () => {
  let { state, a, b, c } = fixture();
  state = march(march(state, a, b, 6), a, c, 3);
  assert.equal(availableTroops(state, a.id, b.id), 6);
  assert.throws(() => march(state, a, b, 7));
  state = march(state, a, b, 5); assert.equal(availableTroops(state, a.id), 1);
  state = applyCommand(state, { type: 'CANCEL_MARCH', actor: 0, from: a.id, to: c.id });
  assert.equal(availableTroops(state, a.id), 4);
  state = march(state, a, b, 90, 'repeat'); assert.equal(availableTroops(state, a.id), 9);
  assert.throws(() => march(state, a, b, 10));
  state = march(state, a, b, 9); assert.equal(availableTroops(state, a.id), 0);
  assert.equal(state.orders.length, 1);
});

test('manual orders take priority over repeating orders regardless of entry order', () => {
  const { state, a, b, c } = fixture();
  const first = march(march(state, a, b, 9, 'repeat'), a, c, 6);
  const reverse = march(march(state, a, c, 6), a, b, 9, 'repeat');
  assert.equal(availableTroops(first, a.id), 3);
  const next = finish(first);
  assert.deepEqual(next, finish(reverse));
  assert.equal(next.cells[c.id].troops, 8); assert.equal(next.cells[b.id].troops, 5);
  assert.equal(next.orders.length, 1); assert.equal(next.orders[0].amount, 9);
  assert.deepEqual(restore(serialize(first)), first);
});

test('multiple recurring routes share only leftover troops and remain scheduled when none remain', () => {
  let { state, a, b, c, d } = fixture();
  state = march(march(march(state, a, b, 8, 'repeat'), a, c, 4, 'repeat'), a, d, 6);
  const next = finish(state);
  assert.equal(next.cells[b.id].troops, 4); assert.equal(next.cells[c.id].troops, 3);
  assert.equal(next.cells[d.id].troops, 8);
  const allManual = march(state, a, d, 9), blocked = finish(allManual);
  assert.equal(blocked.cells[b.id].troops, 2); assert.equal(blocked.cells[c.id].troops, 2);
  assert.equal(blocked.orders.length, 2); assert.equal(blocked.orders[0].frequency, 'repeat');
});

test('friendly destination capacity also prioritizes manual arrivals and retains rejected troops', () => {
  let { state, a, b, c } = fixture(); a.troops = 9996; b.troops = c.troops = 10;
  state = march(march(state, b, a, 3, 'repeat'), c, a, 3);
  const next = finish(state);
  assert.equal(next.cells[a.id].troops, 9999);
  assert.equal(next.cells[b.id].troops, 11); assert.equal(next.cells[c.id].troops, 8);
});

test('incoming reinforcements cannot fund manual orders from another source in the same round', () => {
  let { state, a, b } = fixture();
  state = march(state, a, b, 6);
  assert.equal(availableTroops(state, b.id), 0);
  assert.throws(() => march(state, b, a, 1));
  state = march(state, b, a, 5, 'repeat');
  const next = finish(state);
  assert.equal(next.cells[b.id].troops, 8); assert.equal(next.cells[a.id].troops, 5);
});

test('v4 overbooked plans migrate within budget without changing the board or replaying locked turns', () => {
  let { state, a, b, c, d } = fixture();
  state = march(march(march(state, a, b, 6), a, c, 3), a, d, 8, 'repeat');
  state = applyCommand(state, { type: 'END_TURN', actor: 0 });
  state.version = 4; state.orders.find(o => o.to === c.id).amount = 6;
  const before = serialize(state), migrated = restore(before);
  assert.equal(migrated.version, SAVE_VERSION); assert.equal(migrated.current, 1);
  assert.deepEqual(migrated.cells, state.cells); assert.equal(migrated.rng, state.rng);
  assert.deepEqual(migrated.aiPending, state.aiPending);
  assert.deepEqual(migrated.orders.filter(o => o.frequency === 'once').map(o => o.amount).sort(), [4, 5]);
  assert.equal(migrated.orders.find(o => o.frequency === 'repeat').amount, 8);
  assert.deepEqual(restore(serialize(migrated)), migrated);
  const corrupt = cloneState(state); corrupt.version = SAVE_VERSION;
  assert.equal(restore(serialize(corrupt)), null);
  assert.equal(serialize(state), before);
});
