import { adjacent, cellId, distance, neighbors } from './hex.js';

export const SAVE_VERSION = 5;
export const SIZES = {
  small: { label: '小型', radius: 3, cells: 37, duration: '轻快交锋' },
  medium: { label: '中型', radius: 5, cells: 91, duration: '经典战役' },
  large: { label: '大型', radius: 7, cells: 169, duration: '纵深博弈' },
};
export const FACTIONS = [
  { name: '翡翠军团', short: '翡', color: '#75d8b0', fill: '#225847', dark: '#152e28' },
  { name: '赤焰军团', short: '赤', color: '#ec8c7a', fill: '#633d37', dark: '#302322' },
  { name: '流金沙盟', short: '金', color: '#ddbc76', fill: '#5e5033', dark: '#302c20' },
  { name: '紫雾王庭', short: '紫', color: '#b59ae0', fill: '#4a3d60', dark: '#292434' },
  { name: '苍蓝卫队', short: '蓝', color: '#82bce0', fill: '#355266', dark: '#202e37' },
  { name: '银月部落', short: '银', color: '#c9cfca', fill: '#4a5352', dark: '#282e2c' },
];
const MAX_TROOPS = 9999;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export class RuleError extends Error {}
const requireRule = (ok, message) => { if (!ok) throw new RuleError(message); };

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0 || 1;
}

// The PRNG state is part of the save. Identical seeds and commands replay identically.
export function random(state) {
  let x = state.rng;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

export function createGame({ size = 'medium', enemies = 3, seed = `${Date.now()}` } = {}) {
  requireRule(hasOwn(SIZES, size), '未知地图尺寸');
  requireRule(Number.isInteger(enemies) && enemies >= 1 && enemies <= 5, '敌对势力须为 1–5 个');
  const state = {
    version: SAVE_VERSION, config: { size, enemies, seed: String(seed) }, rng: hash(seed),
    round: 1, current: 0, acted: false, phase: 'playing', winner: null,
    cells: {}, factions: FACTIONS.slice(0, enemies + 1).map((f, id) => ({ ...f, id, control: id === 0 ? 'human' : 'ai' })),
    orders: [], logs: [], sequence: 0, aiPending: [],
  };
  const radius = SIZES[size].radius;
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      const id = cellId(q, r);
      state.cells[id] = { id, q, r, owner: null, troops: 1 + Math.floor(random(state) * 6), terrain: Math.floor(random(state) * 3) };
    }
  }
  const angle = c => Math.atan2(1.5 * c.r, Math.sqrt(3) * (c.q + c.r / 2));
  const ring = Object.values(state.cells).filter(c => distance(c, { q: 0, r: 0 }) === radius - 1).sort((a, b) => angle(a) - angle(b));
  if (random(state) < 0.5) ring.reverse();
  const offset = Math.floor(random(state) * ring.length);
  const spawns = state.factions.map((_, i) => ring[(offset + Math.floor(i * ring.length / (enemies + 1))) % ring.length]);
  spawns.forEach((cell, owner) => { cell.owner = owner; cell.troops = 18; });
  state.aiPending = [spawns[0].id];
  addLog(state, '战役开始。选择翡翠领地，向相邻地块进军。', 'system');
  return state;
}

export function stats(state, owner) {
  const cells = Object.values(state.cells).filter(c => c.owner === owner);
  return { land: cells.length, troops: cells.reduce((sum, c) => sum + c.troops, 0) };
}
export const alive = (state, owner) => Object.values(state.cells).some(c => c.owner === owner);
// Equal armies: 50%. A 3:1 advantage: 95% (3 ** exponent = 19).
export const BATTLE_EXPONENT = Math.log(19) / Math.log(3);
export const winChance = (attack, defense) => attack > 0 ? 1 / (1 + (defense / attack) ** BATTLE_EXPONENT) : 0;
export const cloneState = state => JSON.parse(JSON.stringify(state));

// Editing a direction replaces its reservation; recurring orders never reserve
// this turn's manual budget, and incoming troops cannot be spent in advance.
export function availableTroops(state, from, excludeTo = null) {
  const source = state.cells[from];
  if (!source) return 0;
  const reserved = state.orders.filter(o => o.from === from && o.to !== excludeTo && o.frequency === 'once').reduce((sum, o) => sum + o.amount, 0);
  return Math.max(0, source.troops - 1 - reserved);
}

function addLog(state, text, type = 'system', owner = null) {
  state.logs.unshift({ id: ++state.sequence, round: state.round, text, type, owner });
  state.logs = state.logs.slice(0, 60);
}

function finishIfNeeded(state) {
  state.orders = state.orders.filter(order => state.cells[order.from].owner === order.owner && (order.frequency === 'once' || state.cells[order.to].owner === order.owner));
  const survivors = state.factions.filter(f => alive(state, f.id));
  if (survivors.length === 1 || !alive(state, 0)) {
    state.phase = 'finished';
    state.winner = survivors.length === 1 ? survivors[0].id : null;
    addLog(state, state.winner === 0 ? '所有敌对势力已被消灭。战场归于翡翠军团！' : '翡翠军团失去了最后一块领地。战役结束。', 'result');
  }
}

function setMarch(state, command) {
  const { from, to, amount, actor, frequency } = command;
  const source = state.cells[from], target = state.cells[to];
  requireRule(['once', 'repeat'].includes(frequency), '请选择本回合或每回合执行');
  requireRule(adjacent(source, target) && source.owner === actor, '请选择己方领地与相邻目标');
  requireRule(frequency !== 'repeat' || target.owner === actor, '每回合行军需要两个相邻的己方格子');
  requireRule(Number.isInteger(amount) && amount >= 1 && amount <= (frequency === 'repeat' ? 99 : MAX_TROOPS - 1), '派遣兵力超出允许范围');
  requireRule(frequency !== 'once' || amount <= availableTroops(state, from, to), '本回合可调兵力不足：请减少数量或调整其他方向的指令');
  const existing = state.orders.find(order => order.from === from && order.to === to);
  if (existing) Object.assign(existing, { amount, frequency });
  else state.orders.push({ from, to, amount, owner: actor, frequency });
  // AI plans each starting territory once, then resolves all orders at END_TURN.
  state.aiPending = state.aiPending.filter(id => id !== from);
}

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const orderKey = order => order.from + '>' + order.to;
const orderedCells = state => Object.values(state.cells).sort((a, b) => compareId(a.id, b.id));

// Largest remainders preserve the integer budget without giving earlier clicks priority.
function limitAmounts(items, budget) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (total <= budget) return false;
  const shares = items.map(item => ({ item, amount: Math.floor(item.amount * budget / total), remainder: item.amount * budget % total }));
  let extra = budget - shares.reduce((sum, share) => sum + share.amount, 0);
  shares.sort((a, b) => b.remainder - a.remainder || compareId(orderKey(a.item), orderKey(b.item)));
  for (const share of shares) share.item.amount = share.amount + (extra-- > 0 ? 1 : 0);
  return true;
}

function limitByPriority(items, budget) {
  const once = items.filter(m => m.frequency === 'once');
  const repeat = items.filter(m => m.frequency === 'repeat');
  const reducedOnce = limitAmounts(once, budget);
  const remaining = budget - once.reduce((sum, m) => sum + m.amount, 0);
  const reducedRepeat = limitAmounts(repeat, remaining);
  return reducedOnce || reducedRepeat;
}

function allocateMarches(state) {
  const marches = state.orders.map(order => ({ ...order })).sort((a, b) => compareId(orderKey(a), orderKey(b)));
  for (const cell of orderedCells(state)) limitByPriority(marches.filter(m => m.from === cell.id), cell.troops - 1);
  // Friendly capacity includes simultaneous departures. Rejected transfers stay home;
  // reductions propagate backwards until all receiving cells fit, including cycles.
  let changed;
  do {
    changed = false;
    for (const cell of orderedCells(state)) {
      const outgoing = marches.filter(m => m.from === cell.id).reduce((sum, m) => sum + m.amount, 0);
      const incoming = marches.filter(m => m.to === cell.id && m.owner === cell.owner);
      if (limitByPriority(incoming, MAX_TROOPS - cell.troops + outgoing)) changed = true;
    }
  } while (changed);
  return marches.filter(m => m.amount > 0);
}

function battle(armies, seed) {
  const rng = { rng: seed };
  const contenders = [...armies.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1));
  const weights = contenders.map(([, amount]) => amount ** BATTLE_EXPONENT);
  let draw = random(rng) * weights.reduce((sum, weight) => sum + weight, 0);
  let winner = contenders.length - 1;
  for (let i = 0; i < contenders.length; i++) {
    draw -= weights[i];
    if (draw < 0) { winner = i; break; }
  }
  const [owner, strength] = contenders[winner];
  const defeated = contenders.reduce((sum, [side, amount]) => sum + (side === owner ? 0 : amount), 0);
  const baseline = Math.ceil(defeated / 2), variation = Math.max(1, Math.round(baseline * 0.2));
  const casualtyDraw = random(rng);
  const loss = Math.max(0, baseline + (casualtyDraw < 0.2 ? -variation : casualtyDraw < 0.8 ? 0 : variation));
  return { owner, troops: Math.max(1, strength - loss) };
}

function resolveRound(state) {
  const marches = allocateMarches(state), cells = orderedCells(state);
  const survivorsBefore = state.factions.filter(f => alive(state, f.id));
  // One saved round seed; each edge/cell gets its own stream. Reordering unrelated
  // commands or traversing the board differently cannot change a battle's draws.
  random(state);
  const seed = location => hash(state.rng + ':' + state.round + ':' + location);
  const name = owner => owner === null ? '中立守军' : state.factions[owner].name;
  for (const march of marches) state.cells[march.from].troops -= march.amount;

  const byDirection = new Map(marches.map(m => [orderKey(m), m]));
  for (const march of marches) {
    if (compareId(march.from, march.to) >= 0) continue;
    const reverse = byDirection.get(march.to + '>' + march.from);
    if (!reverse || reverse.owner === march.owner) continue;
    const description = march.amount + ' 对 ' + reverse.amount;
    const result = battle(new Map([[march.owner, march.amount], [reverse.owner, reverse.amount]]), seed('edge:' + orderKey(march)));
    march.amount = result.owner === march.owner ? result.troops : 0;
    reverse.amount = result.owner === reverse.owner ? result.troops : 0;
    addLog(state, '途中交战 ' + march.from + ' ↔ ' + march.to + '，' + description + '，' + name(result.owner) + '剩余 ' + result.troops + ' 兵继续行军。', 'clash', result.owner);
  }

  const results = [];
  for (const cell of cells) {
    const arrivals = marches.filter(m => m.to === cell.id && m.amount > 0);
    const armies = new Map([[cell.owner, cell.troops]]);
    for (const march of arrivals) armies.set(march.owner, (armies.get(march.owner) || 0) + march.amount);
    if (armies.size === 1) {
      results.push({ id: cell.id, owner: cell.owner, troops: Math.min(MAX_TROOPS, armies.get(cell.owner)) });
      if (arrivals.length) addLog(state, name(cell.owner) + '向 ' + cell.id + '合并增援 ' + arrivals.reduce((sum, m) => sum + m.amount, 0) + ' 兵。', 'transfer', cell.owner);
    } else {
      const result = battle(armies, seed('cell:' + cell.id));
      results.push({ id: cell.id, owner: result.owner, troops: Math.min(MAX_TROOPS, result.troops) });
      const forces = [...armies.entries()].sort(([a], [b]) => (a ?? -1) - (b ?? -1)).map(([owner, amount]) => name(owner) + ' ' + amount).join(' / ');
      addLog(state, cell.id + ' 合兵交战：' + forces + '，' + name(result.owner) + (result.owner === cell.owner ? '守住' : '攻占') + '，剩余 ' + Math.min(MAX_TROOPS, result.troops) + ' 兵。', result.owner === cell.owner ? 'battle' : 'capture', result.owner);
    }
  }
  for (const result of results) Object.assign(state.cells[result.id], result);
  state.orders = state.orders.filter(order => order.frequency === 'repeat').sort((a, b) => compareId(orderKey(a), orderKey(b)));
  for (const faction of survivorsBefore) if (!alive(state, faction.id)) addLog(state, faction.name + '已被消灭。', 'eliminated', faction.id);
  finishIfNeeded(state);
}

function settleRound(state) {
  state.round++;
  for (const cell of Object.values(state.cells)) if (cell.owner !== null) cell.troops = Math.min(MAX_TROOPS, cell.troops + 1);
  addLog(state, `第 ${state.round} 轮：全境补给 +1。`, 'growth');
}

export function applyCommand(previous, command) {
  requireRule(previous.phase === 'playing', '战役已经结束');
  requireRule(command && command.actor === previous.current, '还没有轮到该势力行动');
  requireRule(alive(previous, command.actor), '该势力已被消灭');
  const state = cloneState(previous);
  switch (command.type) {
    case 'MARCH': setMarch(state, command); break;
    case 'MOVE': setMarch(state, { ...command, frequency: 'once' }); break;
    case 'END_TURN': {
      let next = state.current;
      do {
        next = (next + 1) % state.factions.length;
        if (next === 0) {
          resolveRound(state);
          if (state.phase === 'playing') settleRound(state);
          break;
        }
      } while (!alive(state, next));
      state.current = next;
      state.acted = false;
      state.aiPending = orderedCells(state).filter(c => c.owner === next).map(c => c.id);
      break;
    }
    case 'SET_ROUTE': setMarch(state, { ...command, frequency: 'repeat' }); break;
    case 'CANCEL_MARCH':
    case 'REMOVE_ROUTE':
      state.orders = state.orders.filter(order => !(order.from === command.from && order.owner === command.actor && (command.to === undefined || order.to === command.to)));
      break;
    default: throw new RuleError('未知指令');
  }
  return state;
}

export function chooseAICommand(state) {
  const candidates = [];
  const scratch = { rng: state.rng };
  for (const source of orderedCells(state)) {
    if (source.owner !== state.current || source.troops < 2 || !state.aiPending.includes(source.id)) continue;
    const budget = availableTroops(state, source.id);
    if (budget < 1) continue;
    const ns = neighbors(source, state.cells);
    const hostile = ns.filter(c => c.owner !== source.owner);
    for (const target of (hostile.length ? hostile : ns)) {
      // Random adjacent expansion with a modest preference for viable attacks.
      const amount = Math.max(1, Math.floor(budget * (0.65 + random(scratch) * 0.35)));
      const frontier = neighbors(target, state.cells).some(n => n.owner !== source.owner);
      const score = random(scratch) * 2 + (target.owner !== source.owner ? winChance(amount, target.troops) * 2 : frontier ? 0.6 : 0);
      if (target.owner === source.owner && target.troops + amount > MAX_TROOPS) continue;
      candidates.push({ score, type: 'MARCH', frequency: 'once', actor: state.current, from: source.id, to: target.id, amount });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return { type: 'END_TURN', actor: state.current };
  const { score, ...command } = candidates[0];
  return command;
}

export function serialize(state) { return JSON.stringify(state); }
export function restore(raw) {
  try {
    const state = typeof raw === 'string' ? JSON.parse(raw) : cloneState(raw);
    if (!state || ![1, 2, 3, 4, SAVE_VERSION].includes(state.version) || !state.config || !hasOwn(SIZES, state.config.size)) return null;
    if (!Number.isInteger(state.config.enemies) || state.config.enemies < 1 || state.config.enemies > 5) return null;
    if (!Array.isArray(state.factions) || state.factions.length !== state.config.enemies + 1) return null;
    if (!Number.isInteger(state.rng) || state.rng <= 0 || state.rng > 0xffffffff) return null;
    if (!Number.isInteger(state.round) || state.round < 1 || !Number.isInteger(state.sequence) || state.sequence < 0) return null;
    if (!Number.isInteger(state.current) || !state.factions[state.current] || typeof state.acted !== 'boolean') return null;
    if (!['playing', 'finished'].includes(state.phase)) return null;
    const expected = createGame(state.config);
    if (!state.cells || Object.keys(state.cells).length !== Object.keys(expected.cells).length) return null;
    for (const [id, cell] of Object.entries(state.cells)) {
      if (!expected.cells[id] || cell.id !== id || cell.q !== expected.cells[id].q || cell.r !== expected.cells[id].r) return null;
      if (!(cell.owner === null || Number.isInteger(cell.owner) && !!state.factions[cell.owner])) return null;
      if (!Number.isInteger(cell.troops) || cell.troops < 1 || cell.troops > MAX_TROOPS || ![0, 1, 2].includes(cell.terrain)) return null;
    }
    if (state.version === 1) {
      state.aiPending = state.acted ? [] : Object.values(state.cells).filter(c => c.owner === state.current).map(c => c.id);
    }
    if (!Array.isArray(state.aiPending) || state.aiPending.length > Object.keys(state.cells).length || new Set(state.aiPending).size !== state.aiPending.length || state.aiPending.some(id => !state.cells[id] || state.cells[id].owner !== state.current)) return null;
    if (state.version < 3) {
      if (!Array.isArray(state.routes)) return null;
      state.orders = state.routes.map(route => ({ ...route, frequency: 'repeat' }));
      delete state.routes;
    }
    if (state.version < 4) {
      if (!Array.isArray(state.orders)) return null;
      // Older AI turns already executed earlier factions. Start a fresh planning
      // phase on the existing board, without replaying or undoing those moves.
      if (state.current !== 0) state.orders = state.orders.filter(order => order.frequency === 'repeat');
      state.current = 0; state.acted = false;
      state.aiPending = orderedCells(state).filter(c => c.owner === 0).map(c => c.id);
    }
    if (!Array.isArray(state.orders) || state.orders.length > Object.keys(state.cells).length * 6) return null;
    const seen = new Set();
    for (const order of state.orders) {
      const a = state.cells[order.from], b = state.cells[order.to];
      const key = `${order.from}>${order.to}`;
      if (!['once', 'repeat'].includes(order.frequency) || !adjacent(a, b) || !Number.isInteger(order.owner) || !state.factions[order.owner] || a.owner !== order.owner || seen.has(key)) return null;
      if (order.frequency === 'repeat' ? b.owner !== order.owner : order.owner > state.current) return null;
      if (!Number.isInteger(order.amount) || order.amount < 1 || order.amount > (order.frequency === 'repeat' ? 99 : MAX_TROOPS - 1)) return null;
      seen.add(key);
    }
    for (const cell of orderedCells(state)) {
      const once = state.orders.filter(o => o.from === cell.id && o.frequency === 'once');
      if (once.reduce((sum, o) => sum + o.amount, 0) <= cell.troops - 1) continue;
      if (state.version === SAVE_VERSION) return null;
      // Older versions allowed overbooking. Preserve their proportional split
      // while migrating the plans, without moving troops or replaying battles.
      limitAmounts(once, cell.troops - 1);
    }
    state.orders = state.orders.filter(o => o.amount > 0);
    state.version = SAVE_VERSION;
    if (!Array.isArray(state.logs) || state.logs.length > 60 || state.logs.some(l => typeof l.text !== 'string' || l.text.length > 300 || !Number.isInteger(l.round))) return null;
    if (state.phase === 'playing' && (!alive(state, 0) || !alive(state, state.current) || state.factions.filter(f => alive(state, f.id)).length < 2 || state.winner !== null)) return null;
    if (state.phase === 'finished' && (state.winner !== null && (!Number.isInteger(state.winner) || !alive(state, state.winner)) || alive(state, 0) && state.winner !== 0)) return null;
    // Names and colors come from trusted code, never from storage.
    state.factions = expected.factions;
    return state;
  } catch { return null; }
}
