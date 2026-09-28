export const DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const cellId = (q, r) => `${q},${r}`;
export const distance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
export const adjacent = (a, b) => !!a && !!b && distance(a, b) === 1;
export const neighbors = (cell, cells) => DIRECTIONS.map(([q, r]) => cells[cellId(cell.q + q, cell.r + r)]).filter(Boolean);
export const toPixel = (q, r, size) => ({ x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r });

export function fromPixel(x, y, size) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / size;
  const r = 2 / 3 * y / size;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return cellId(rq, rr);
}
