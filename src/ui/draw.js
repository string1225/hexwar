export const C = {
  bg: '#101715', panel: '#17201d', raised: '#1f2b26', border: '#2b3831',
  ink: '#eef1e5', muted: '#8b9c90', dim: '#596d60', mint: '#a2e4b8',
  gold: '#d8c58e', shadow: '#090f0c', neutral: '#25352e', neutralStroke: '#3c5143',
};
export const FONT = '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
export const MONO = '"SFMono-Regular", Consolas, monospace';

export function box(ctx, x, y, w, h, fill, stroke, radius = 12) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
export function text(ctx, value, x, y, size = 14, color = C.ink, weight = '400', align = 'left', mono = false) {
  ctx.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(String(value), x, y);
}
export function line(ctx, x1, y1, x2, y2, color = C.border, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
export function hex(ctx, x, y, radius, fill, stroke, width = 1) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i - Math.PI / 6;
    const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
export function dot(ctx, x, y, r, color) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); }
export function arrow(ctx, x1, y1, x2, y2, color, dashed = false) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.setLineDash(dashed ? [4, 5] : []);
  line(ctx, x1, y1, x2, y2, color, 2);
  ctx.setLineDash([]);
  line(ctx, x2, y2, x2 - 8 * Math.cos(angle - 0.5), y2 - 8 * Math.sin(angle - 0.5), color, 2);
  line(ctx, x2, y2, x2 - 8 * Math.cos(angle + 0.5), y2 - 8 * Math.sin(angle + 0.5), color, 2);
}
export function wrap(ctx, value, x, y, width, size = 13, color = C.muted, lineHeight = 23) {
  let row = '', dy = 0;
  ctx.font = `400 ${size}px ${FONT}`;
  const tokens = String(value).match(/[A-Za-z0-9²%]+|[^\n]|\n/g) || [];
  for (const token of tokens) {
    if (token !== '\n' && /^[，。；：！？、）]$/.test(token)) { row += token; continue; }
    if (token === '\n' || row && ctx.measureText(row + token).width > width) {
      text(ctx, row, x, y + dy, size, color); dy += lineHeight; row = token === '\n' ? '' : token;
    } else row += token;
  }
  if (row) text(ctx, row, x, y + dy, size, color);
  return dy + lineHeight;
}
