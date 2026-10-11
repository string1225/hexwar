import { neighbors } from './hex.js';

export const DIFFICULTIES = {
  easy: { label: '初级', strategy: '随机扩张' },
  standard: { label: '中级', strategy: '稳健扩张' },
  advanced: { label: '高级', strategy: '协同进攻' },
};

export function aiCommand(state, { budget, chance, nextRandom }) {
  const owner = state.current, level = state.config.difficulty || 'standard';
  const owned = Object.values(state.cells).filter(c => c.owner === owner).sort((a, b) => a.id.localeCompare(b.id));
  const pending = new Set(state.aiPending);
  const fronts = owned.filter(c => neighbors(c, state.cells).some(n => n.owner !== owner));
  // Supply paths only cross our own territories and respect missing cells.
  const depth = new Map(fronts.map(c => [c.id, 0])), queue = [...fronts];
  for (let i = 0; i < queue.length; i++) for (const next of neighbors(queue[i], state.cells)) {
    if (next.owner !== owner || depth.has(next.id)) continue;
    depth.set(next.id, depth.get(queue[i].id) + 1); queue.push(next);
  }
  const spend = source => {
    const maximum = budget(source.id);
    if (level === 'easy') return maximum;
    const threats = neighbors(source, state.cells).filter(c => c.owner !== null && c.owner !== owner);
    const pressure = Math.max(0, ...threats.map(c => c.troops - 1));
    const reserve = Math.max(1, Math.ceil(pressure * (level === 'advanced' ? 0.5 : 0.3)));
    return Math.max(0, Math.min(maximum, source.troops - reserve));
  };
  const planned = state.orders.filter(o => o.owner === owner);
  const incoming = target => planned.filter(o => o.to === target.id).reduce((sum, o) => sum + o.amount, 0);
  const candidates = [];
  for (const source of owned) {
    if (!pending.has(source.id)) continue;
    const maximum = spend(source);
    if (maximum < 1) continue;
    for (const target of neighbors(source, state.cells)) {
      const friendly = target.owner === owner;
      let amount = maximum, score;
      if (level === 'easy') {
        amount = Math.max(1, Math.floor(maximum * (0.4 + nextRandom() * 0.6)));
        score = nextRandom() + (friendly ? 0 : 0.3);
      } else if (friendly) {
        // A transfer must move closer to a frontier, preventing supply loops.
        if (!depth.has(source.id) || !(depth.get(target.id) < depth.get(source.id))) continue;
        const pressure = neighbors(target, state.cells).filter(c => c.owner !== null && c.owner !== owner).reduce((sum, c) => sum + c.troops, 0);
        score = 1.2 + (level === 'advanced' ? Math.min(1.5, pressure / Math.max(1, target.troops + incoming(target))) : 0) - depth.get(target.id) * 0.1 + nextRandom() * 0.1;
      } else {
        const already = incoming(target);
        const potential = level === 'advanced' ? neighbors(target, state.cells).filter(c => c.owner === owner && pending.has(c.id)).reduce((sum, c) => sum + spend(c), 0) : maximum;
        const odds = chance(already + potential, target.troops);
        if (odds < (level === 'advanced' ? 0.72 : 0.6)) continue;
        // Higher difficulty plans a shared target using only this faction's
        // orders. It never reads the opponent's hidden turn intentions.
        score = odds * (target.owner === null ? 4 : 5) + (level === 'advanced' ? Math.min(1.5, already / Math.max(1, target.troops)) : 0) + nextRandom() * 0.15;
        if (level === 'standard') amount = Math.min(maximum, Math.max(1, Math.ceil(target.troops * 1.8)));
      }
      if (friendly) amount = Math.min(amount, Math.max(0, 9999 - target.troops));
      if (amount < 1) continue;
      candidates.push({ score, type: 'MARCH', frequency: 'once', actor: owner, from: source.id, to: target.id, amount });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  if (!candidates.length) return { type: 'END_TURN', actor: owner };
  const { score, ...command } = candidates[0];
  return command;
}
