import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyCommand, chooseAICommand, cloneState, serialize, restore, SAVE_VERSION } from '../src/core/game.js';

function board(seed = 1) {
  const state = createGame({ size: 'small', enemies: 2, seed: 'simultaneous' });
  for (const cell of Object.values(state.cells)) { cell.owner = null; cell.troops = 1; }
  for (const [id, owner, troops] of [['-1,0', 0, 20], ['1,0', 1, 20], ['0,2', 2, 20]]) Object.assign(state.cells[id], { owner, troops });
  state.rng = seed; state.aiPending = ['-1,0']; state.cells['0,0'].troops = 10;
  return state;
}
const plan = (from, to, amount, frequency = 'once') => ({ type: 'MARCH', from, to, amount, frequency });
function playRound(initial, plans = {}) {
  let state = initial;
  for (let actor = state.current; actor < state.factions.length; actor++) {
    if (state.current !== actor || state.phase !== 'playing') continue;
    for (const order of plans[actor] || []) state = applyCommand(state, { ...order, actor });
    state = applyCommand(state, { type: 'END_TURN', actor });
  }
  return state;
}
const battleAt = (state, id) => state.logs.find(l => ['capture', 'battle'].includes(l.type) && l.text.startsWith(id + ' '));

test('two converging armies have exactly the same battle outcome as their combined force', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const state = board(seed); Object.assign(state.cells['0,-1'], { owner: 0, troops: 10 });
    const combined = playRound(state, { 0: [plan('-1,0', '0,0', 12)] });
    const split = playRound(state, { 0: [plan('-1,0', '0,0', 6), plan('0,-1', '0,0', 6)] });
    assert.deepEqual(split.cells['0,0'], combined.cells['0,0']);
    assert.deepEqual(battleAt(split, '0,0'), battleAt(combined, '0,0'));
    assert.equal(split.logs.filter(l => /0,0 合兵交战/.test(l.text)).length, 1);
  }
});

test('reversing order entry and cell traversal preserves all results, random state and logs', () => {
  const state = board(87);
  Object.assign(state.cells['0,-1'], { owner: 0, troops: 12 });
  const orders = { 0: [plan('-1,0', '0,0', 14), plan('-1,0', '-1,1', 5), plan('0,-1', '0,0', 8)], 1: [plan('1,0', '0,0', 12)], 2: [plan('0,2', '0,1', 10)] };
  const reversed = cloneState(state); reversed.cells = Object.fromEntries(Object.entries(reversed.cells).reverse());
  const expected = playRound(state, orders);
  const actual = playRound(reversed, Object.fromEntries(Object.entries(orders).map(([owner, list]) => [owner, [...list].reverse()])));
  assert.deepEqual(actual, expected);
});

test('mutual attacks fight on the edge first; only survivors continue and use a separate siege draw', () => {
  const results = new Set(), edgeWinners = new Set(), survivors = new Set();
  for (let seed = 1; seed <= 250; seed++) {
    const state = board(seed);
    Object.assign(state.cells['0,0'], { owner: 1, troops: 8 });
    state.cells['-1,0'].troops = 7;
    const result = playRound(state, { 0: [plan('-1,0', '0,0', 6)], 1: [plan('0,0', '-1,0', 7)] });
    const clash = result.logs.filter(l => l.type === 'clash');
    assert.equal(clash.length, 1); assert.match(clash[0].text, /6 对 7/);
    const winner = clash[0].owner, remaining = Number(clash[0].text.match(/剩余 (\d+) 兵/)[1]);
    assert.ok(winner === 0 ? [1, 2, 3].includes(remaining) : [3, 4, 5].includes(remaining));
    edgeWinners.add(winner); survivors.add(winner + ':' + remaining);
    const origin = winner === 0 ? '-1,0' : '0,0', target = winner === 0 ? '0,0' : '-1,0';
    assert.equal(result.cells[origin].owner, winner); assert.equal(result.cells[origin].troops, result.phase === 'playing' ? 2 : 1);
    assert.equal(battleAt(result, origin), undefined); // Losing expedition cannot attack.
    assert.match(battleAt(result, target).text, new RegExp(result.factions[winner].name + ' ' + remaining + '(?: /|，)'));
    results.add(result.cells[target].owner === winner ? 'captured' : 'repelled');
    assert.ok(restore(serialize(result)));
  }
  assert.equal(edgeWinners.size, 2); assert.equal(survivors.size, 6);
  assert.deepEqual([...results].sort(), ['captured', 'repelled']);
});

test('incoming friendly reinforcements merge with the garrison after simultaneous departures', () => {
  const state = board(); Object.assign(state.cells['0,0'], { owner: 1, troops: 10 });
  const next = playRound(state, {
    0: [plan('-1,0', '0,0', 6)],
    1: [plan('0,0', '0,1', 6), plan('1,0', '0,0', 3)],
  });
  assert.match(battleAt(next, '0,0').text, /翡翠军团 6 \/ 赤焰军团 7/);
});

test('multi-faction arrivals resolve one battle including the neutral garrison', () => {
  const winners = new Set();
  for (let seed = 1; seed <= 160; seed++) {
    const state = board(seed); state.cells['0,0'].troops = 6;
    Object.assign(state.cells['0,1'], { owner: 2, troops: 10 });
    const next = playRound(state, { 0: [plan('-1,0', '0,0', 6)], 1: [plan('1,0', '0,0', 6)], 2: [plan('0,1', '0,0', 6)] });
    const battles = next.logs.filter(l => l.text.startsWith('0,0 合兵交战'));
    assert.equal(battles.length, 1);
    assert.match(battles[0].text, /中立守军 6 \/ 翡翠军团 6 \/ 赤焰军团 6 \/ 流金沙盟 6/);
    winners.add(next.cells['0,0'].owner);
  }
  assert.equal(winners.size, 4);
});

test('losing the last departure cell does not cancel marching troops or prematurely eliminate a faction', () => {
  const state = board(1);
  for (const c of Object.values(state.cells)) c.owner = null;
  for (const [id, owner] of [['0,0', 0], ['1,0', 1], ['0,1', 2]]) Object.assign(state.cells[id], { owner, troops: 100 });
  state.aiPending = ['0,0'];
  const next = playRound(state, { 0: [plan('0,0', '1,0', 99)], 1: [plan('1,0', '0,1', 99)], 2: [plan('0,1', '0,0', 99)] });
  assert.equal(next.cells['1,0'].owner, 0); assert.equal(next.cells['0,1'].owner, 1); assert.equal(next.cells['0,0'].owner, 2);
  assert.equal(next.phase, 'playing'); assert.equal(next.winner, null);
  assert.equal(next.logs.filter(l => l.type === 'eliminated').length, 0);
  assert.ok(restore(serialize(next)));
});

test('AI plans against the unchanged board without reading player orders; mid-round saves replay once', () => {
  let state = board(77);
  state = applyCommand(state, { ...plan('-1,0', '0,0', 12), actor: 0 });
  const locked = applyCommand(state, { type: 'END_TURN', actor: 0 });
  assert.deepEqual(locked.cells, state.cells); assert.equal(locked.rng, state.rng);
  const hidden = cloneState(locked); hidden.orders = [];
  assert.deepEqual(chooseAICommand(locked), chooseAICommand(hidden));
  const ai = chooseAICommand(locked);
  const paused = applyCommand(locked, ai);
  const resumed = restore(serialize(paused)); assert.deepEqual(resumed, paused);
  assert.deepEqual(playRound(resumed), playRound(paused));
  assert.equal(playRound(resumed).orders.length, 0);
});

test('capacity-limited friendly transfers leave rejected troops home and propagate through chains', () => {
  const state = board();
  Object.assign(state.cells['0,0'], { owner: 0, troops: 9998 });
  Object.assign(state.cells['1,0'], { owner: 0, troops: 9999 });
  const next = playRound(state, { 0: [plan('-1,0', '0,0', 9), plan('0,0', '1,0', 9)] });
  assert.equal(next.cells['-1,0'].troops, 20); // Only one departs, then supply +1.
  assert.equal(next.cells['0,0'].troops, 9999); assert.equal(next.cells['1,0'].troops, 9999);
  assert.ok(restore(serialize(next)));
});

test('v3 pending human plans survive migration; previously executed AI phases restart without replay', () => {
  let state = board();
  state = applyCommand(state, { ...plan('-1,0', '0,0', 6), actor: 0 }); state.version = 3;
  const human = restore(serialize(state));
  assert.equal(human.version, SAVE_VERSION); assert.deepEqual(human.orders, state.orders);
  assert.deepEqual(human.cells, state.cells);
  const oldAI = board(); oldAI.version = 3; oldAI.current = 1; oldAI.aiPending = [];
  oldAI.orders = [{ owner: 1, from: '1,0', to: '0,0', amount: 8, frequency: 'once' }];
  const migrated = restore(serialize(oldAI));
  assert.equal(migrated.current, 0); assert.equal(migrated.orders.length, 0);
  assert.deepEqual(migrated.cells, oldAI.cells); assert.equal(migrated.rng, oldAI.rng);
});
