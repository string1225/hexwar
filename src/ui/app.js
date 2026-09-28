import { createGame, applyCommand, chooseAICommand, SIZES, stats, winChance, serialize, restore } from '../core/game.js';
import { adjacent, toPixel, fromPixel } from '../core/hex.js';
import { C, text, box, line, hex, dot, arrow, wrap } from './draw.js';

export class GameApp {
  constructor(platform) {
    this.p = platform;
    this.ctx = platform.canvas.getContext('2d');
    this.buttons = []; this.selected = null; this.target = null; this.amount = 1;
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.hover = null; this.busy = false;
    this.transport = false; this.tab = 'forces'; this.toast = ''; this.generation = 0;
    this.setup = { size: 'medium', enemies: 3 };
    let saved;
    try { saved = restore(platform.load()); } catch { /* Storage can be disabled. */ }
    this.state = saved || createGame(this.setup);
    this.modal = saved ? saved.phase === 'finished' ? 'result' : null : 'setup';
    this.logo = platform.image('assets/logo.png', () => this.render());
    this.selectHome();
    platform.onResize(() => this.render());
    platform.onPointer((type, x, y) => this.pointer(type, x, y));
    platform.onKey?.(key => this.key(key));
    platform.onWheel?.((delta, x, y) => { if (!this.modal && this.inMap(x, y)) this.changeZoom(delta < 0 ? 0.15 : -0.15); });
    this.render();
    if (this.state.current !== 0 && this.state.phase === 'playing') this.runAI();
  }

  selectHome() {
    const home = Object.values(this.state.cells).filter(c => c.owner === 0).sort((a, b) => b.troops - a.troops)[0];
    this.selected = home?.id || null; this.target = null;
    this.amount = home ? Math.max(1, Math.floor((home.troops - 1) / 2)) : 1;
  }
  save() {
    try { this.p.save(serialize(this.state)); } catch { this.notify('本机存档不可用，本局仍可继续。'); }
  }
  notify(message) {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = ''; this.render(); }, 3600);
    this.render();
  }
  command(command) {
    try {
      this.state = applyCommand(this.state, { actor: 0, ...command });
      this.save();
      if (this.state.phase === 'finished') { this.modal = 'result'; this.busy = false; }
      this.render(); return true;
    } catch (error) { this.notify(error.message); return false; }
  }
  newGame() {
    this.generation++; this.busy = false;
    this.state = createGame({ size: this.setup.size, enemies: this.setup.enemies });
    this.modal = null; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.transport = false; this.tab = 'forces';
    this.selectHome(); this.save(); this.render();
  }
  async runAI() {
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    while (this.state.current !== 0 && this.state.phase === 'playing') {
      this.render();
      await new Promise(resolve => setTimeout(resolve, 380));
      if (generation !== this.generation) return;
      const command = chooseAICommand(this.state);
      this.state = applyCommand(this.state, command);
      this.save();
    }
    if (generation !== this.generation) return;
    this.busy = false;
    if (this.state.phase === 'finished') this.modal = 'result';
    if (this.state.cells[this.selected]?.owner !== 0) this.selectHome();
    this.target = null;
    this.render();
  }
  endTurn() {
    if (this.busy || this.state.phase !== 'playing') return;
    this.target = null;
    if (this.command({ type: 'END_TURN' })) this.runAI();
  }
  key(key) {
    if (key === 'Escape') { if (this.modal) this.modal = null; else this.target = null; this.render(); }
    else if (key === ' ' && !this.modal) this.endTurn();
    else if (key === '+' || key === '=') this.changeZoom(0.2);
    else if (key === '-') this.changeZoom(-0.2);
  }
  changeZoom(delta) {
    this.zoom = Math.max(0.75, Math.min(3, this.zoom + delta)); this.constrainPan(); this.render();
  }
  constrainPan() {
    if (!this.map) return;
    const limit = Math.max(0, this.zoom - 0.65);
    this.pan.x = Math.max(-this.map.w * limit / 2, Math.min(this.map.w * limit / 2, this.pan.x));
    this.pan.y = Math.max(-this.map.h * limit / 2, Math.min(this.map.h * limit / 2, this.pan.y));
  }
  inMap(x, y) { const m = this.map; return m && x > m.x && x < m.x + m.w && y > m.y + 40 && y < m.y + m.h - 42; }
  pointer(type, x, y) {
    if (type === 'cancel') { this.press = null; return; }
    if (type === 'down') { this.press = { x, y, px: this.pan.x, py: this.pan.y, drag: false, map: !this.modal && this.inMap(x, y) && !this.hitButton(x, y) }; return; }
    if (type === 'move') {
      if (this.press?.map && Math.hypot(x - this.press.x, y - this.press.y) > 6) {
        this.press.drag = true; this.pan = { x: this.press.px + x - this.press.x, y: this.press.py + y - this.press.y }; this.constrainPan(); this.render();
      } else {
        const button = this.hitButton(x, y);
        this.p.cursor?.(button || !this.modal && this.inMap(x, y) ? 'pointer' : 'default');
        const hover = button?.id || null;
        if (hover !== this.hover) { this.hover = hover; this.render(); }
      }
      return;
    }
    if (type !== 'up') return;
    const pressed = this.press; this.press = null;
    if (!pressed || pressed.drag) return;
    const hit = this.hitButton(x, y);
    if (hit) { if (!hit.disabled) hit.action(); this.render(); return; }
    if (this.modal || !this.inMap(x, y) || this.busy || this.state.phase !== 'playing') return;
    const id = fromPixel(x - this.map.cx, y - this.map.cy, this.map.radius);
    this.chooseCell(id);
  }
  hitButton(x, y) { return [...this.buttons].reverse().find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); }
  chooseCell(id) {
    const cell = this.state.cells[id]; if (!cell) return;
    const source = this.state.cells[this.selected];
    if (cell.owner === 0 && id === this.target) {
      this.selected = id; this.target = null;
      this.amount = Math.max(1, Math.floor((cell.troops - 1) / 2));
    } else if (source?.owner === 0 && id !== this.selected && adjacent(source, cell)) {
      this.target = id;
      this.amount = this.transport ? Math.min(99, Math.max(1, this.amount)) : Math.max(1, Math.min(this.amount, source.troops - 1));
    } else if (cell.owner === 0) {
      this.selected = id; this.target = null;
      this.amount = Math.max(1, Math.floor((cell.troops - 1) / 2));
    } else this.notify('先选择己方领地，再选择它旁边的目标。');
    this.render();
  }
  button(id, label, x, y, w, h, action, style = 'normal', disabled = false) {
    const ctx = this.ctx, hover = this.hover === id;
    const primary = style === 'primary', active = style === 'active';
    box(ctx, x, y, w, h, disabled ? '#243029' : primary ? (hover ? '#c0f5ce' : C.mint) : active ? '#2e4637' : hover ? '#2b3c31' : C.raised, primary || disabled ? null : active ? '#6d9e79' : C.border, 8);
    text(ctx, label, x + w / 2, y + h / 2, h > 42 ? 14 : 12, disabled ? C.dim : primary ? '#173421' : active ? C.mint : C.ink, primary ? '700' : '500', 'center');
    this.buttons.push({ id, label, x, y, w, h, action, disabled });
  }
  render() {
    if (!this.ctx) return;
    const { width, height, dpr, top = 0, bottom = 0 } = this.p.size();
    this.w = width; this.h = height; this.top = top; this.bottom = bottom;
    const canvas = this.p.canvas;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, height);
    this.buttons = [];
    this.desktop = width >= 1000; this.landscape = !this.desktop && width > height;
    this.header();
    if (this.desktop) this.desktopLayout();
    else if (this.landscape) this.landscapeLayout();
    else this.mobileLayout();
    if (this.state.phase === 'finished' && !this.modal) {
      this.button('show-result', this.state.winner === 0 ? '查看胜利结算' : '查看战役结算', width / 2 - 90, this.map.y + this.map.h / 2 - 20, 180, 44, () => { this.modal = 'result'; }, 'primary');
    }
    if (this.modal) { this.buttons = []; this.drawModal(); }
    if (this.toast) {
      ctx.font = '13px sans-serif'; const tw = Math.min(width - 24, ctx.measureText(this.toast).width + 40);
      box(ctx, (width - tw) / 2, height - bottom - 64, tw, 42, '#e7edda', null, 9);
      text(ctx, this.toast, width / 2, height - bottom - 43, Math.min(13, (tw - 24) / this.toast.length), '#203327', '500', 'center');
    }
    this.p.syncControls?.(this.buttons, this.modal ? `六边形战争 · ${this.modal === 'setup' ? '战役准备' : this.modal === 'rules' ? '玩法指南' : '战役结算'}` : `第 ${this.state.round} 轮，${this.state.factions[this.state.current].name}行动`);
  }
  header() {
    const ctx = this.ctx, compact = !this.desktop, pad = compact ? 16 : 30, y = this.top;
    const logoSize = compact ? 36 : 43;
    if (this.logo?.width) ctx.drawImage(this.logo, pad, y + 15, logoSize, logoSize);
    else hex(ctx, pad + 21, y + 36, 19, null, C.mint, 2);
    text(ctx, '六边形战争', pad + logoSize + 12, y + 30, compact ? 17 : 20, C.ink, '700');
    text(ctx, 'H E X W A R', pad + logoSize + 13, y + 50, 9, C.muted, '600');
    if (this.desktop) {
      text(ctx, '战场', 310, y + 36, 13, C.mint, '600'); line(ctx, 295, y + 70, 352, y + 70, C.mint, 2);
      text(ctx, '单人战役', 390, y + 36, 13, C.muted);
      dot(ctx, this.w - 346, y + 36, 3, C.mint); text(ctx, '本地自动存档', this.w - 332, y + 36, 11, C.muted);
    }
    this.button('rules', compact ? '?' : '玩法指南', this.w - (compact ? 134 : 232), y + 20, compact ? 38 : 94, 34, () => { this.modal = 'rules'; });
    this.button('new', compact ? '新战役' : '＋ 新建战役', this.w - (compact ? 86 : 122), y + 20, compact ? 70 : 94, 34, () => { this.setup = { size: this.state.config.size, enemies: this.state.config.enemies }; this.modal = 'setup'; });
    line(ctx, pad, y + 72, this.w - pad, y + 72);
  }
  desktopLayout() {
    const ctx = this.ctx, w = this.w, h = this.h, pad = 30, gap = 18, y = this.top;
    text(ctx, '每一格，皆是疆土。', pad, y + 113, 27, C.ink, '600');
    text(ctx, '扩张领土 · 调度军团 · 让战场成为你的颜色', pad, y + 142, 12, C.muted);
    text(ctx, 'SINGLE PLAYER  /  STRATEGY', w - pad, y + 110, 10, C.muted, '500', 'right', true);
    text(ctx, `${SIZES[this.state.config.size].label}地图   ·   ${Object.keys(this.state.cells).length} 块领地   ·   ${this.state.config.enemies + 1} 方角逐`, w - pad, y + 139, 12, C.muted, '400', 'right');
    const leftW = w < 1250 ? 184 : 214, rightW = w < 1250 ? 246 : 274;
    const panelY = y + (h < 790 ? 158 : 175), panelH = Math.max(444, h - panelY - 141);
    const mx = pad + leftW + gap, mw = w - pad * 2 - leftW - rightW - gap * 2;
    this.forces(pad, panelY, leftW, panelH);
    this.drawMap(mx, panelY, mw, panelH);
    this.inspector(w - pad - rightW, panelY, rightW, panelH, false);
    this.logPanel(pad, panelY + panelH + 18, w - pad * 2, 88);
    if (h >= 790) {
      text(ctx, 'HEXWAR  /  01', pad, h - 15, 9, C.dim, '400', 'left', true);
      text(ctx, '拖动平移 · 滚轮缩放 · 空格结束回合', w - pad, h - 15, 10, C.dim, '400', 'right');
    }
  }
  mobileLayout() {
    const ctx = this.ctx, w = this.w, y = this.top;
    const own = stats(this.state, 0);
    text(ctx, `第 ${String(this.state.round).padStart(2, '0')} 轮`, 17, y + 96, 18, C.ink, '600');
    dot(ctx, 115, y + 96, 3, this.busy ? C.gold : C.mint);
    text(ctx, this.busy ? '敌方行动中' : this.state.acted ? '行动已完成' : '轮到你了', 126, y + 96, 12, C.muted);
    text(ctx, `${own.land} 领地  /  ${own.troops} 兵`, w - 17, y + 96, 12, C.mint, '500', 'right');
    const factions = this.state.factions, gap = 6, fw = (w - 32 - gap * (factions.length - 1)) / factions.length;
    factions.forEach((f, i) => {
      const s = stats(this.state, f.id), x = 16 + i * (fw + gap);
      box(ctx, x, y + 118, fw, 28, s.land ? f.dark : C.bg, s.land ? f.fill : C.border, 6);
      text(ctx, `${f.short} ${s.land}`, x + fw / 2, y + 132, 11, s.land ? f.color : C.dim, '500', 'center');
    });
    const mapY = y + 158, infoH = 232;
    const mapH = Math.max(112, this.h - mapY - infoH - this.bottom - 20);
    this.drawMap(12, mapY, w - 24, mapH);
    this.inspector(12, mapY + mapH + 10, w - 24, infoH, true);
  }
  landscapeLayout() {
    const y = this.top + 85, h = this.h - y - this.bottom - 12, infoW = Math.min(300, this.w * 0.4);
    this.drawMap(12, y, this.w - infoW - 36, h);
    this.inspector(this.w - infoW - 12, y, infoW, h, true);
  }
  forces(x, y, w, h) {
    const ctx = this.ctx;
    box(ctx, x, y, w, h, C.panel, C.border);
    text(ctx, '战场态势', x + 18, y + 27, 13, C.ink, '600');
    text(ctx, 'LIVE', x + w - 18, y + 27, 9, C.mint, '500', 'right', true);
    line(ctx, x + 18, y + 47, x + w - 18, y + 47);
    text(ctx, 'ROUND', x + 18, y + 71, 10, C.muted, '500', 'left', true);
    text(ctx, String(this.state.round).padStart(2, '0'), x + 16, y + 109, 44, C.ink, '500', 'left', true);
    box(ctx, x + 18, y + 142, w - 36, 30, '#243d2f', null, 6);
    dot(ctx, x + 30, y + 157, 3, this.busy ? C.gold : C.mint);
    text(ctx, this.busy ? `${this.state.factions[this.state.current].short}方正在行动` : this.state.acted ? '等待结束回合' : '你的行动回合', x + 42, y + 157, 11, C.mint);
    text(ctx, '势力', x + 18, y + 201, 10, C.muted);
    text(ctx, '领地 / 兵力', x + w - 18, y + 201, 10, C.muted, '400', 'right');
    const rowH = Math.min(55, (h - 300) / this.state.factions.length);
    this.state.factions.forEach((f, i) => {
      const sy = y + 227 + i * rowH, s = stats(this.state, f.id);
      hex(ctx, x + 25, sy + 2, 7, s.land ? f.fill : C.bg, s.land ? f.color : C.dim);
      text(ctx, f.name, x + 41, sy - 2, 11, s.land ? C.ink : C.dim, f.id === 0 ? '600' : '400');
      text(ctx, s.land ? `${s.land} / ${s.troops}` : '已消灭', x + w - 18, sy - 2, 11, s.land ? f.color : C.dim, '500', 'right', true);
      box(ctx, x + 41, sy + 14, w - 60, 3, C.border, null, 1);
      if (s.land) box(ctx, x + 41, sy + 14, Math.max(3, (w - 60) * s.land / Object.keys(this.state.cells).length), 3, f.color, null, 1);
    });
    line(ctx, x + 18, y + h - 61, x + w - 18, y + h - 61);
    text(ctx, '胜利目标', x + 18, y + h - 40, 10, C.muted);
    text(ctx, '消灭其他所有势力', x + 18, y + h - 19, 12, C.gold, '500');
  }
  drawMap(x, y, w, h) {
    const ctx = this.ctx, radius = SIZES[this.state.config.size].radius;
    const shortMap = h < 230;
    const availableH = h - (shortMap ? 68 : 102);
    const unit = Math.max(5, Math.min((w - 38) / (Math.sqrt(3) * (2 * radius + 1)), availableH / (3 * radius + 2)));
    this.map = { x, y, w, h, radius: unit * this.zoom, cx: x + w / 2 + this.pan.x, cy: y + (shortMap ? 34 : 49) + availableH / 2 + this.pan.y };
    box(ctx, x, y, w, h, '#141e18', C.border, 12);
    ctx.save(); box(ctx, x + 1, y + 1, w - 2, h - 2, null, null, 12); ctx.clip();
    for (let gx = x + 18; gx < x + w; gx += 24) for (let gy = y + 16; gy < y + h; gy += 24) dot(ctx, gx, gy, 0.7, '#29362a');
    const grad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.55);
    grad.addColorStop(0, '#66885e13'); grad.addColorStop(1, '#0b150d00'); ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + (shortMap ? 31 : 43), w - 2, h - (shortMap ? 60 : 87)); ctx.clip();
    const source = this.state.cells[this.selected];
    const points = {};
    for (const cell of Object.values(this.state.cells)) {
      const pos = toPixel(cell.q, cell.r, this.map.radius);
      const px = pos.x + this.map.cx, py = pos.y + this.map.cy, r = this.map.radius - Math.min(2, unit * 0.07);
      points[cell.id] = { x: px, y: py };
      if (px + r < x || px - r > x + w || py + r < y || py - r > y + h) continue;
      const faction = this.state.factions[cell.owner];
      const selected = this.selected === cell.id, target = this.target === cell.id;
      const reachable = source?.owner === 0 && adjacent(source, cell) && !this.busy && !this.state.acted;
      const neutralColors = ['#28382e', '#26382e', '#2d3b2f'];
      hex(ctx, px, py + 3, r, '#0a100c', null);
      if (selected) { ctx.shadowColor = '#81d69755'; ctx.shadowBlur = 20; }
      hex(ctx, px, py, r, faction ? faction.fill : neutralColors[cell.terrain], target ? C.gold : selected ? '#ceefac' : faction ? faction.color : reachable ? '#91a878' : C.neutralStroke, selected || target ? 2.3 : 1);
      ctx.shadowBlur = 0;
      if (selected) hex(ctx, px, py, r - 4, null, '#a5e3ac55', 1);
      const numberSize = Math.max(9, Math.min(20, r * 0.56));
      text(ctx, cell.troops, px, py - (faction && r > 18 ? 3 : 0), numberSize, faction ? '#f4f2d9' : reachable ? '#d7dfbc' : '#8da185', faction ? '700' : '500', 'center', true);
      if (faction && r > 18) text(ctx, faction.short, px, py + r * 0.44, Math.max(7, Math.min(9, r * 0.28)), faction.color, '400', 'center');
      if (!faction && r > 24) {
        if (cell.terrain === 1) { line(ctx, px - 6, py + 13, px - 3, py + 9, '#677b5840'); line(ctx, px - 3, py + 9, px, py + 13, '#677b5840'); }
        else if (cell.terrain === 2) { dot(ctx, px - 3, py + 12, 1, '#80916750'); dot(ctx, px + 3, py + 12, 1, '#80916750'); }
      }
    }
    for (const route of this.state.routes) {
      const a = points[route.from], b = points[route.to];
      arrow(ctx, a.x + (b.x - a.x) * 0.24, a.y + (b.y - a.y) * 0.24, a.x + (b.x - a.x) * 0.77, a.y + (b.y - a.y) * 0.77, C.mint, true);
    }
    if (this.target && points[this.selected] && points[this.target]) {
      const a = points[this.selected], b = points[this.target];
      arrow(ctx, a.x + (b.x - a.x) * 0.35, a.y + (b.y - a.y) * 0.35, a.x + (b.x - a.x) * 0.77, a.y + (b.y - a.y) * 0.77, C.gold);
    }
    ctx.restore();
    text(ctx, this.desktop ? '作 战 地 图' : `${SIZES[this.state.config.size].label}战场`, x + 18, y + 25, 11, C.muted, '500');
    text(ctx, `${Object.keys(this.state.cells).length} HEX`, x + w - 18, y + 25, 10, C.dim, '400', 'right', true);
    if (!shortMap) text(ctx, this.busy ? '各势力正在依次行动…' : this.state.acted ? '行动完成，结束回合以获得补给' : this.target ? '确认派遣兵力，或改选目标' : '选择己方领地 → 点击相邻地块', x + w / 2, y + h - 23, Math.min(11, w / 30), C.muted, '400', 'center');
    ctx.restore();
    const by = y + h - (shortMap ? 34 : 79);
    this.button('zoom-out', '−', x + w - 114, by, 30, 29, () => this.changeZoom(-0.2));
    this.button('zoom-reset', '◎', x + w - 79, by, 30, 29, () => { this.zoom = 1; this.pan = { x: 0, y: 0 }; });
    this.button('zoom-in', '+', x + w - 44, by, 30, 29, () => this.changeZoom(0.2));
    if (this.desktop) { dot(ctx, x + 20, by + 14, 3, C.mint); text(ctx, '己方', x + 31, by + 14, 10, C.muted); dot(ctx, x + 76, by + 14, 3, '#607358'); text(ctx, '中立', x + 87, by + 14, 10, C.muted); }
  }
  inspector(x, y, w, h, compact) {
    const ctx = this.ctx, source = this.state.cells[this.selected], target = this.state.cells[this.target];
    const canControl = !this.busy && this.state.phase === 'playing' && source?.owner === 0;
    box(ctx, x, y, w, h, C.panel, C.border);
    const pad = compact ? 14 : 18, ix = x + pad, iw = w - 2 * pad;
    const tabY = y + (compact ? 10 : 15);
    this.button('tab-order', '行军指令', ix, tabY, (iw - 6) / 2, 31, () => { this.tab = 'forces'; }, this.tab === 'forces' ? 'active' : 'normal');
    this.button('tab-routes', `运输路线${this.state.routes.length ? ` · ${this.state.routes.length}` : ''}`, ix + (iw + 6) / 2, tabY, (iw - 6) / 2, 31, () => { this.tab = 'routes'; }, this.tab === 'routes' ? 'active' : 'normal');
    if (this.tab === 'routes') {
      this.routesPanel(ix, tabY + 48, iw, h - (compact ? 115 : 142), compact);
    } else if (compact) {
      const rowY = y + 62;
      text(ctx, source ? `驻军 ${source.troops}  ·  ${source.id}` : '选择己方领地', ix, rowY, 12, C.mint, '600');
      text(ctx, target ? target.owner === 0 ? '友军调遣' : `敌军 ${target.troops} · 胜率 ${Math.round(winChance(this.amount, target.troops) * 100)}%` : '点击相邻格子选择目标', x + w - pad, rowY, 11, C.muted, '400', 'right');
      this.amountControl(ix, y + 82, iw, canControl, true);
      this.button('transport', this.transport ? '✓ 每轮自动运输' : '○ 每轮自动运输', ix, y + 129, iw, 30, () => { this.transport = !this.transport; this.amount = Math.min(this.amount, this.transport ? 99 : Math.max(1, (source?.troops || 2) - 1)); }, this.transport ? 'active' : 'normal', !canControl);
      this.actionButton(ix, y + 170, (iw - 8) * 0.52, 44, canControl, target);
    } else {
      const cy = y + 68;
      text(ctx, '出发领地', ix, cy, 11, C.muted);
      text(ctx, source ? `HEX  ${source.id}` : '尚未选择', x + w - pad, cy, 11, C.mint, '400', 'right', true);
      text(ctx, source?.troops ?? '—', ix, cy + 36, 38, C.ink, '500', 'left', true);
      text(ctx, '驻守兵力', ix + 83, cy + 42, 11, C.muted);
      line(ctx, ix, cy + 64, ix + iw, cy + 64);
      text(ctx, target ? target.owner === 0 ? '友军支援' : '进攻目标' : '等待选择目标', ix, cy + 87, 12, C.ink, '600');
      if (target) {
        const f = this.state.factions[target.owner];
        text(ctx, `${f ? f.name : '中立领地'} · ${target.troops} 兵`, ix, cy + 111, 12, f?.color || C.muted);
        text(ctx, target.owner === 0 ? '100%' : `${Math.round(winChance(this.amount, target.troops) * 100)}%`, ix + iw, cy + 89, 20, C.gold, '500', 'right', true);
      } else text(ctx, '点选高亮的相邻六边形', ix, cy + 112, 11, C.muted);
      this.amountControl(ix, cy + 137, iw, canControl, false);
      this.button('transport', this.transport ? '✓ 每轮自动运输' : '○ 每轮自动运输', ix, cy + 232, iw, 33, () => { this.transport = !this.transport; this.amount = Math.min(this.amount, this.transport ? 99 : Math.max(1, (source?.troops || 2) - 1)); }, this.transport ? 'active' : 'normal', !canControl);
      if (h > 505) text(ctx, '相邻友军间，按设定兵力持续补给', ix, cy + 285, 10, C.dim);
      this.actionButton(ix, y + h - 103, iw, 40, canControl, target);
    }
    if (compact && this.tab === 'forces') this.endButton(ix + (iw - 8) * 0.52 + 8, y + 170, (iw - 8) * 0.48, 44);
    else this.endButton(ix, y + h - (compact ? 56 : 53), iw, 39);
  }
  amountControl(x, y, w, canControl, compact) {
    const source = this.state.cells[this.selected];
    const max = this.transport ? 99 : Math.max(1, (source?.troops || 2) - 1);
    this.amount = Math.max(1, Math.min(this.amount, max));
    const ctx = this.ctx;
    if (!compact) { text(ctx, '派遣兵力', x, y, 11, C.muted); y += 17; }
    this.button('amount-minus', '−', x, y, 34, 34, () => { this.amount = Math.max(1, this.amount - 1); }, 'normal', !canControl);
    box(ctx, x + 40, y, compact ? 54 : w - 80, 34, C.bg, C.border, 6);
    text(ctx, this.amount, x + 40 + (compact ? 27 : (w - 80) / 2), y + 17, 18, C.ink, '600', 'center', true);
    const plusX = compact ? x + 100 : x + w - 34;
    this.button('amount-plus', '+', plusX, y, 34, 34, () => { this.amount = Math.min(max, this.amount + 1); }, 'normal', !canControl);
    const fractions = [0.25, 0.5, 1], labels = ['1/4', '1/2', '全部'];
    const fx = compact ? x + 144 : x, fy = compact ? y : y + 43, fw = compact ? (w - 156) / 3 : (w - 12) / 3;
    fractions.forEach((v, i) => this.button(`amount-${i}`, labels[i], fx + i * (fw + 6), fy, fw, compact ? 34 : 28, () => { this.amount = Math.max(1, Math.floor(Math.max(1, (source?.troops || 2) - 1) * v)); this.amount = Math.min(this.amount, max); }, 'normal', !canControl));
  }
  actionButton(x, y, w, h, canControl, target) {
    const source = this.state.cells[this.selected];
    const disabled = !canControl || !target || (this.transport ? target.owner !== 0 : this.state.acted || !source || source.troops < 2);
    this.button('dispatch', this.transport ? '建立运输路线' : this.state.acted ? '本回合已行动' : target?.owner === 0 ? '调遣军团 →' : '派遣军团 →', x, y, w, h, () => {
      const ok = this.command({ type: this.transport ? 'SET_ROUTE' : 'MOVE', from: this.selected, to: this.target, amount: this.amount });
      if (ok) {
        this.p.feedback?.();
        if (this.transport) { this.notify('运输路线已建立，下轮补给后开始运兵。'); this.tab = 'routes'; }
        else if (this.state.phase === 'playing') {
          const updated = this.state.cells[target.id];
          this.notify(target.owner === 0 ? `调遣完成 · 目标现有 ${updated.troops} 兵` : updated.owner === 0 ? `攻占成功 · 驻军剩余 ${updated.troops} 兵` : `进攻失利 · 守军剩余 ${updated.troops} 兵`);
        }
        this.target = null;
      }
    }, 'primary', disabled);
  }
  endButton(x, y, w, h) {
    this.button('end-turn', this.busy ? '敌方行动中…' : '结束回合  →', x, y, w, h, () => this.endTurn(), 'normal', this.busy || this.state.phase !== 'playing');
  }
  routesPanel(x, y, w, h, compact) {
    const ctx = this.ctx, routes = this.state.routes.filter(r => r.owner === 0);
    if (!routes.length) {
      text(ctx, '让补给线，连起你的疆土。', x, y + 4, 12, C.mint, '600');
      wrap(ctx, '在「行军指令」选择两块相邻己方领地，开启每轮自动运输后建立路线。每个起点可设置一条路线。', x, y + 32, w, 11, C.muted, 21);
      return;
    }
    const perPage = Math.max(1, Math.floor((h - 38) / 59));
    const maxPage = Math.ceil(routes.length / perPage) - 1;
    this.routePage = Math.min(this.routePage || 0, maxPage);
    routes.slice(this.routePage * perPage, (this.routePage + 1) * perPage).forEach((r, i) => {
      const ry = y + i * 59;
      box(ctx, x, ry - 9, w, 51, C.raised, C.border, 7);
      text(ctx, `${r.from} → ${r.to}`, x + 10, ry + 5, 11, C.ink, '500', 'left', true);
      text(ctx, `每轮 ${r.amount} 兵 · 自动执行`, x + 10, ry + 24, 10, C.mint);
      this.button(`remove-${r.from}`, '×', x + w - 39, ry + 1, 29, 29, () => this.command({ type: 'REMOVE_ROUTE', from: r.from }), 'normal', this.busy);
    });
    const by = y + perPage * 59;
    if (maxPage > 0) {
      this.button('routes-prev', '‹', x, by, 30, 27, () => { this.routePage--; }, 'normal', this.routePage === 0);
      text(ctx, `${this.routePage + 1} / ${maxPage + 1}`, x + w / 2, by + 14, 10, C.muted, '400', 'center');
      this.button('routes-next', '›', x + w - 30, by, 30, 27, () => { this.routePage++; }, 'normal', this.routePage === maxPage);
    } else if (!compact) wrap(ctx, '每轮补给后执行。保留 1 兵；不足时按实际余量运输。领地失守后路线自动取消。', x, by + 10, w, 11, C.muted, 21);
  }
  logPanel(x, y, w, h) {
    const ctx = this.ctx; box(ctx, x, y, w, h, C.panel, C.border, 10);
    text(ctx, '战 地 简 报', x + 18, y + 22, 11, C.muted, '600');
    text(ctx, 'BATTLE LOG', x + w - 18, y + 22, 9, C.dim, '400', 'right', true);
    this.state.logs.slice(0, 2).forEach((entry, i) => {
      text(ctx, `R${String(entry.round).padStart(2, '0')}`, x + 18, y + 47 + i * 22, 10, C.dim, '400', 'left', true);
      dot(ctx, x + 65, y + 47 + i * 22, 2, this.state.factions[entry.owner]?.color || C.mint);
      text(ctx, entry.text, x + 79, y + 47 + i * 22, 11, i === 0 ? C.ink : C.muted);
    });
  }
  drawModal() {
    const ctx = this.ctx, setup = this.modal === 'setup', rules = this.modal === 'rules';
    ctx.fillStyle = '#050c09dc'; ctx.fillRect(0, 0, this.w, this.h);
    const available = this.h - this.top - this.bottom - 20;
    const w = Math.min(this.w - 28, setup ? 520 : 540), h = Math.min(available, setup ? 542 : rules ? 570 : 420);
    const x = (this.w - w) / 2, y = this.top + (this.h - this.top - this.bottom - h) / 2;
    box(ctx, x, y, w, h, '#1a261e', '#465940', 18);
    const tight = h < 490, pad = w < 400 ? 22 : 32;
    const ix = x + pad, iw = w - pad * 2;
    this.button('close-modal', '×', x + w - 48, y + 15, 30, 30, () => { this.modal = null; });
    if (setup) {
      const scale = Math.min(1, (h - 90) / 445);
      const sy = n => y + 24 + n * scale;
      if (this.logo?.width) ctx.drawImage(this.logo, ix - 4, sy(0), 52 * scale, 52 * scale);
      text(ctx, '一场新的征途', ix, sy(85), 27 * Math.max(0.8, scale), C.ink, '600');
      text(ctx, '从一格领地开始，改写整个战场。', ix, sy(118), 12, C.muted);
      text(ctx, '01  选择战场规模', ix, sy(164), 12, C.ink, '600');
      const cw = (iw - 16) / 3;
      Object.entries(SIZES).forEach(([id, size], i) => {
        const cx = ix + i * (cw + 8), cy = sy(186), ch = 94 * scale;
        const active = this.setup.size === id;
        box(ctx, cx, cy, cw, ch, active ? '#2b4431' : '#202e24', active ? C.mint : C.border, 9);
        text(ctx, size.label, cx + cw / 2, cy + ch * 0.25, 16, active ? C.mint : C.ink, '600', 'center');
        text(ctx, `${size.cells} 格`, cx + cw / 2, cy + ch * 0.54, 12, C.muted, '400', 'center');
        if (scale > 0.75) text(ctx, size.duration, cx + cw / 2, cy + ch * 0.79, 10, C.dim, '400', 'center');
        this.buttons.push({ id: `size-${id}`, label: `${size.label}地图 ${size.cells} 格`, x: cx, y: cy, w: cw, h: ch, action: () => { this.setup.size = id; } });
      });
      text(ctx, '02  敌对势力数量', ix, sy(313), 12, C.ink, '600');
      const nw = (iw - 32) / 5;
      for (let n = 1; n <= 5; n++) this.button(`enemies-${n}`, String(n), ix + (n - 1) * (nw + 8), sy(335), nw, Math.max(29, 39 * scale), () => { this.setup.enemies = n; }, this.setup.enemies === n ? 'active' : 'normal');
      text(ctx, '单人模式  ·  随机地图  ·  每轮领地兵力 +1', ix, sy(406), w < 400 ? 10 : 11, C.muted);
      this.button('start-game', '开启战役  →', ix, y + h - 71, iw, 46, () => this.newGame(), 'primary');
    } else if (rules) {
      text(ctx, '指挥官手册', ix, y + 46, 25, C.ink, '600');
      text(ctx, '少一点规则，多一点谋略。', ix, y + 78, 12, C.muted);
      const pages = [
        [ ['01', '选择与进军', '先点自己的彩色地块，再点相邻地块。选择出兵数量后派遣；每个势力每轮可行动一次，至少留 1 兵驻守。'], ['02', '兵力决定胜算', '胜率 = 出兵² ÷（出兵² + 守军²）。10 兵对 5 兵有 80% 胜率；优势越大越稳，但不是必胜。'], ['03', '战斗与伤亡', '进攻胜利：占领目标，出兵减去守军一半（向上取整），至少剩 1。失败：派出兵力全部损失，守军减去出兵一半（向下取整），至少剩 1。'] ],
        [ ['04', '轮转与补给', '点「结束回合」后，电脑依次向相邻地块扩展。所有势力行动完，每块已占领地 +1 兵，中立格不增长。兵力上限 9999。'], ['05', '每轮自动运兵', '选择相邻友军格，开启自动运输并建立路线。每轮补给后运输，保留 1 兵，不足按余量执行。每个起点一条路线，到达的兵下一轮才能继续转运。'], ['06', '赢下这片疆土', '消灭所有敌对势力的彩色领地即可获胜，无需占领全部中立格。运输路线不占行动次数；格子失守时相关路线自动取消。'] ],
      ];
      const perPage = h < 430 ? 1 : w < 420 ? 2 : 3;
      const entries = pages.flat(), pageCount = Math.ceil(entries.length / perPage);
      const page = (this.rulePage || 0) % pageCount;
      const startY = y + (tight ? 111 : 126), stride = (h - 205) / perPage;
      entries.slice(page * perPage, (page + 1) * perPage).forEach(([n, title, body], i) => {
        const ry = startY + i * stride;
        text(ctx, n, ix, ry, 11, C.mint, '500', 'left', true);
        text(ctx, title, ix + 31, ry, 13, C.ink, '600');
        wrap(ctx, body, ix + 31, ry + 25, iw - 31, tight ? 10 : 12, C.muted, tight ? 17 : 21);
      });
      this.button('rule-page', `下一页  →   ${page + 1} / ${pageCount}`, ix, y + h - 59, iw, 36, () => { this.rulePage = (page + 1) % pageCount; });
    } else {
      const won = this.state.winner === 0, own = stats(this.state, 0);
      hex(ctx, x + w / 2, y + 67, 28, '#2e4a35', won ? C.mint : C.gold, 2);
      text(ctx, won ? '胜' : '终', x + w / 2, y + 67, 22, won ? C.mint : C.gold, '600', 'center');
      text(ctx, won ? '疆土，尽归于你。' : '征途尚未结束。', x + w / 2, y + 131, 25, C.ink, '600', 'center');
      text(ctx, won ? '所有敌对势力已被消灭' : '最后一块领地失守，重整旗鼓再战', x + w / 2, y + 168, 12, C.muted, '400', 'center');
      text(ctx, `${this.state.round} 轮战役   /   ${own.land} 块领地   /   ${own.troops} 兵`, x + w / 2, y + 218, 14, C.gold, '500', 'center');
      this.button('play-again', '再启一场战役  →', ix, y + h - 118, iw, 46, () => { this.modal = 'setup'; }, 'primary');
      this.button('review-map', '回看战场', ix, y + h - 61, iw, 36, () => { this.modal = null; });
    }
  }
}
