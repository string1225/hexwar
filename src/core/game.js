import { adjacent, cellId, distance, neighbors } from './hex.js';

export const SAVE_VERSION = 1;
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
    routes: [], logs: [], sequence: 0,
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
  addLog(state, '战役开始。选择翡翠领地，向相邻地块进军。', 'system');
  return state;
}

export function stats(state, owner) {
  const cells = Object.values(state.cells).filter(c => c.owner === owner);
  return { land: cells.length, troops: cells.reduce((sum, c) => sum + c.troops, 0) };
}
export const alive = (state, owner) => Object.values(state.cells).some(c => c.owner === owner);
export const winChance = (attack, defense) => attack > 0 ? attack ** 2 / (attack ** 2 + defense ** 2) : 0;
export const cloneState = state => JSON.parse(JSON.stringify(state));

function addLog(state, text, type = 'system', owner = null) {
  state.logs.unshift({ id: ++state.sequence, round: state.round, text, type, owner });
  state.logs = state.logs.slice(0, 60);
}

function finishIfNeeded(state) {
  state.routes = state.routes.filter(route => state.cells[route.from].owner === route.owner && state.cells[route.to].owner === route.owner);
  const survivors = state.factions.filter(f => alive(state, f.id));
  if (survivors.length === 1 || !alive(state, 0)) {
    state.phase = 'finished';
    state.winner = survivors.length === 1 ? survivors[0].id : null;
    addLog(state, state.winner === 0 ? '所有敌对势力已被消灭。战场归于翡翠军团！' : '翡翠军团失去了最后一块领地。战役结束。', 'result');
  }
}

function move(state, command) {
  const { from, to, amount, actor } = command;
  const source = state.cells[from], target = state.cells[to];
  requireRule(!state.acted, '本回合已行动，请结束回合');
  requireRule(source && target && adjacent(source, target), '只能向相邻格子派兵');
  requireRule(source.owner === actor, '只能调遣自己的兵力');
  requireRule(Number.isInteger(amount) && amount >= 1 && amount < source.troops, '出兵后至少保留 1 兵驻守');
  if (target.owner === actor) requireRule(target.troops + amount <= MAX_TROOPS, '目标格子兵力已达上限');
  source.troops -= amount;
  if (target.owner === actor) {
    target.troops += amount;
    addLog(state, `${state.factions[actor].name}向友军调遣 ${amount} 兵。`, 'transfer', actor);
  } else {
    const defender = target.owner;
    const defense = target.troops;
    const chance = winChance(amount, defense);
    if (random(state) < chance) {
      target.owner = actor;
      target.troops = Math.max(1, amount - Math.ceil(defense / 2));
      addLog(state, `${state.factions[actor].name}攻占 ${to}，${amount} 对 ${defense}，剩余 ${target.troops} 兵。`, 'capture', actor);
      if (defender !== null && !alive(state, defender)) addLog(state, `${state.factions[defender].name}已被消灭。`, 'eliminated', defender);
    } else {
      target.troops = Math.max(1, defense - Math.floor(amount / 2));
      addLog(state, `${state.factions[actor].name}进攻 ${to} 失利，${amount} 兵阵亡，守军剩余 ${target.troops} 兵。`, 'battle', actor);
    }
  }
  state.acted = true;
  finishIfNeeded(state);
}

function settleRound(state) {
  state.round++;
  for (const cell of Object.values(state.cells)) if (cell.owner !== null) cell.troops = Math.min(MAX_TROOPS, cell.troops + 1);
  // Resolve from a snapshot: incoming troops cannot travel twice in the same round.
  const available = Object.fromEntries(Object.values(state.cells).map(c => [c.id, c.troops - 1]));
  const deltas = {};
  for (const route of state.routes) {
    const source = state.cells[route.from], target = state.cells[route.to];
    if (source.owner !== route.owner || target.owner !== route.owner) continue;
    const amount = Math.min(route.amount, available[source.id], MAX_TROOPS - target.troops - (deltas[target.id] || 0));
    if (amount <= 0) continue;
    available[source.id] -= amount;
    deltas[source.id] = (deltas[source.id] || 0) - amount;
    deltas[target.id] = (deltas[target.id] || 0) + amount;
  }
  for (const [id, amount] of Object.entries(deltas)) state.cells[id].troops += amount;
  addLog(state, `第 ${state.round} 轮：全境补给 +1${state.routes.length ? '，运输路线已结算' : ''}。`, 'growth');
}

export function applyCommand(previous, command) {
  requireRule(previous.phase === 'playing', '战役已经结束');
  requireRule(command && command.actor === previous.current, '还没有轮到该势力行动');
  requireRule(alive(previous, command.actor), '该势力已被消灭');
  const state = cloneState(previous);
  switch (command.type) {
    case 'MOVE': move(state, command); break;
    case 'END_TURN': {
      let next = state.current;
      do {
        next = (next + 1) % state.factions.length;
        if (next === 0) settleRound(state);
      } while (!alive(state, next));
      state.current = next;
      state.acted = false;
      break;
    }
    case 'SET_ROUTE': {
      const source = state.cells[command.from], target = state.cells[command.to];
      requireRule(adjacent(source, target) && source.owner === command.actor && target.owner === command.actor, '运输路线必须连接两个相邻的己方格子');
      requireRule(Number.isInteger(command.amount) && command.amount >= 1 && command.amount <= 99, '每轮运输量须为 1–99');
      const existing = state.routes.find(route => route.from === command.from);
      if (existing) Object.assign(existing, { to: command.to, amount: command.amount });
      else state.routes.push({ from: command.from, to: command.to, amount: command.amount, owner: command.actor });
      addLog(state, `运输路线 ${command.from} → ${command.to}：每轮 ${command.amount} 兵。`, 'route', command.actor);
      break;
    }
    case 'REMOVE_ROUTE':
      state.routes = state.routes.filter(route => !(route.from === command.from && route.owner === command.actor));
      break;
    default: throw new RuleError('未知指令');
  }
  return state;
}

export function chooseAICommand(state) {
  if (state.acted) return { type: 'END_TURN', actor: state.current };
  const candidates = [];
  const scratch = { rng: state.rng };
  for (const source of Object.values(state.cells)) {
    if (source.owner !== state.current || source.troops < 2) continue;
    const ns = neighbors(source, state.cells);
    const hostile = ns.filter(c => c.owner !== source.owner);
    for (const target of (hostile.length ? hostile : ns)) {
      // Random adjacent expansion with a modest preference for viable attacks.
      const amount = Math.max(1, Math.floor((source.troops - 1) * (0.65 + random(scratch) * 0.35)));
      const frontier = neighbors(target, state.cells).some(n => n.owner !== source.owner);
      const score = random(scratch) * 2 + (target.owner !== source.owner ? winChance(amount, target.troops) * 2 : frontier ? 0.6 : 0);
      if (target.owner === source.owner && target.troops + amount > MAX_TROOPS) continue;
      candidates.push({ score, type: 'MOVE', actor: state.current, from: source.id, to: target.id, amount });
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
    if (!state || state.version !== SAVE_VERSION || !state.config || !hasOwn(SIZES, state.config.size)) return null;
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
    if (!Array.isArray(state.routes) || state.routes.length > Object.keys(state.cells).length) return null;
    const seen = new Set();
    for (const route of state.routes) {
      const a = state.cells[route.from], b = state.cells[route.to];
      if (!adjacent(a, b) || !Number.isInteger(route.owner) || !state.factions[route.owner] || a.owner !== route.owner || b.owner !== route.owner || seen.has(route.from)) return null;
      if (!Number.isInteger(route.amount) || route.amount < 1 || route.amount > 99) return null;
      seen.add(route.from);
    }
    if (!Array.isArray(state.logs) || state.logs.length > 60 || state.logs.some(l => typeof l.text !== 'string' || l.text.length > 300 || !Number.isInteger(l.round))) return null;
    if (state.phase === 'playing' && (!alive(state, 0) || !alive(state, state.current) || state.factions.filter(f => alive(state, f.id)).length < 2 || state.winner !== null)) return null;
    if (state.phase === 'finished' && (state.winner !== null && (!Number.isInteger(state.winner) || !alive(state, state.winner)) || alive(state, 0) && state.winner !== 0)) return null;
    // Names and colors come from trusted code, never from storage.
    state.factions = expected.factions;
    return state;
  } catch { return null; }
}
