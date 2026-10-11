import { cellId, neighbors } from './hex.js';

export const SHAPES = { hexagon: { label: '六边形' }, rectangle: { label: '长方形' } };

export function mapLayout(radius, shape) {
  const cells = {};
  const add = (q, r) => { const id = cellId(q, r); cells[id] = { id, q, r }; };
  if (shape === 'rectangle') {
    // Offset rows keep the outline rectangular while retaining six neighbors.
    for (let r = 1 - radius; r < radius; r++) {
      for (let col = -radius; col <= radius; col++) add(col - Math.floor(r / 2), r);
    }
  } else {
    for (let q = -radius; q <= radius; q++) {
      for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) add(q, r);
    }
  }
  return cells;
}

export function pathDistances(cells, starts) {
  const distances = new Map(starts.map(id => [id, 0])), queue = [...starts];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of neighbors(cells[id], cells)) {
      if (distances.has(next.id)) continue;
      distances.set(next.id, distances.get(id) + 1); queue.push(next.id);
    }
  }
  return distances;
}

export function carveHoles(cells, nextRandom) {
  const candidates = Object.values(cells).filter(c => neighbors(c, cells).length === 6);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const desired = Math.max(1, Math.round(Object.keys(cells).length * (0.08 + nextRandom() * 0.04)));
  let removed = 0;
  for (const cell of candidates) {
    if (removed === desired) break;
    delete cells[cell.id];
    const ids = Object.keys(cells);
    if (pathDistances(cells, [ids[0]]).size === ids.length) removed++;
    else cells[cell.id] = cell;
  }
}

export function randomSpawns(cells, count, nextRandom) {
  const candidates = Object.values(cells).filter(c => neighbors(c, cells).length >= 3);
  const spawns = [candidates[Math.floor(nextRandom() * candidates.length)]];
  while (spawns.length < count) {
    const distances = pathDistances(cells, spawns.map(c => c.id));
    const ranked = candidates.filter(c => distances.get(c.id) >= 2).map(cell => ({ cell, score: distances.get(cell.id) + nextRandom() * 2 }));
    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) throw new Error('地图无法容纳所有势力');
    spawns.push(ranked[0].cell);
  }
  // The human is not always the randomly chosen first starting point.
  for (let i = spawns.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    [spawns[i], spawns[j]] = [spawns[j], spawns[i]];
  }
  return spawns;
}
