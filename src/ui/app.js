import { createGame, applyCommand, chooseAICommand, availableTroops, SIZES, stats, serialize, restore } from '../core/game.js';
import { adjacent, toPixel, fromPixel } from '../core/hex.js';
import { C, text, box, line, hex, dot, arrow, wrap } from './draw.js';

export class GameApp {
  constructor(platform) {
    this.p = platform;
    this.ctx = platform.canvas.getContext('2d');
    this.buttons = []; this.selected = null; this.target = null; this.amount = 1;
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.hover = null; this.busy = false;
    this.frequency = 'once'; this.toast = ''; this.generation = 0;
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
    this.selectNext = false;
    const home = Object.values(this.state.cells).filter(c => c.owner === 0).sort((a, b) => b.troops - a.troops)[0];
    this.selected = home?.id || null; this.target = null;
    this.amount = home ? Math.max(1, Math.floor((home.troops - 1) / 2)) : 1;
    const planned = this.state.orders.filter(order => order.owner === 0).slice(-1)[0];
    if (planned) {
      this.selected = planned.from; this.target = planned.to;
      this.amount = planned.amount; this.frequency = planned.frequency;
      this.selectNext = true;
    }
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
    this.modal = null; this.zoom = 1; this.pan = { x: 0, y: 0 }; this.frequency = 'once';
    this.selectHome(); this.save(); this.render();
  }
  async runAI() {
    if (this.busy) return;
    this.busy = true;
    const generation = this.generation;
    while (this.state.current !== 0 && this.state.phase === 'playing') {
      this.render();
      await new Promise(resolve => setTimeout(resolve, 80));
      if (generation !== this.generation) return;
      const actor = this.state.current;
      do {
        this.state = applyCommand(this.state, chooseAICommand(this.state));
      } while (this.state.current === actor && this.state.phase === 'playing');
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
    if (this.busy || this.cloudBusy || this.state.phase !== 'playing') return;
    this.target = null; this.selectNext = false;
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
  inMap(x, y) { const m = this.map; return m && x > m.x && x < m.x + m.w && y > m.y + 34 && y < m.y + m.h - 6; }
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
    if (this.selectNext) {
      this.selectNext = false;
      this.selected = id; this.target = null; this.frequency = 'once';
      this.amount = Math.max(1, Math.floor((cell.troops - 1) / 2));
    } else if (cell.owner === 0 && id === this.target) {
      this.selected = id; this.target = null; this.frequency = 'once';
      this.amount = Math.max(1, Math.floor((cell.troops - 1) / 2));
    } else if (source?.owner === 0 && id !== this.selected && adjacent(source, cell)) {
      this.target = id;
      const existing = this.state.orders.find(r => r.from === source.id && r.to === id && r.owner === 0);
      this.frequency = existing?.frequency || 'once';
      this.amount = existing ? existing.amount : Math.max(1, Math.min(this.amount, source.troops - 1));
    } else if (cell.owner === 0) {
      this.selected = id; this.target = null; this.frequency = 'once';
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
      const toastY = this.map.y + 40;
      box(ctx, (width - tw) / 2, toastY, tw, 36, '#e7edda', null, 9);
      text(ctx, this.toast, width / 2, toastY + 18, Math.min(13, (tw - 24) / this.toast.length), '#203327', '500', 'center');
    }
    const modalNames = { setup: '战役准备', rules: '玩法指南', result: '战役结算', cloud: '存档', orders: '本回合指令' };
    this.p.syncControls?.(this.buttons, this.modal ? `六边形战争 · ${modalNames[this.modal]}` : `第 ${this.state.round} 轮，${this.state.factions[this.state.current].name}行动`);
  }
  header() {
    const ctx = this.ctx, y = this.top, pad = 12;
    if (this.logo?.width) ctx.drawImage(this.logo, pad, y + 8, 32, 32);
    else hex(ctx, pad + 16, y + 24, 15, null, C.mint, 2);
    text(ctx, '六边形战争', 52, y + 24, this.w < 350 ? 14 : 17, C.ink, '700');
    if (this.desktop) text(ctx, 'H E X W A R  /  单人战役', 164, y + 25, 10, C.dim);
    const sx = this.w - 48;
    this.button('rules', '?', sx - 118, y + 7, 34, 34, () => { this.modal = 'rules'; });
    this.button('new', '新战役', sx - 76, y + 7, 68, 34, () => { this.setup = { size: this.state.config.size, enemies: this.state.config.enemies }; this.modal = 'setup'; });
    this.button('save', '', sx, y + 7, 36, 34, () => { this.modal = 'cloud'; if (this.p.cloud) this.readCloud(); });
    this.buttons[this.buttons.length - 1].label = '存档';
    // Draw a portable save icon instead of relying on emoji font support in WeChat.
    box(ctx, sx + 9, y + 15, 18, 18, null, C.mint, 2);
    box(ctx, sx + 13, y + 15, 10, 6, C.mint, null, 0);
    box(ctx, sx + 13, y + 26, 10, 7, null, C.mint, 1);
    line(ctx, pad, y + 48, this.w - pad, y + 48);
  }
  statusBar(x, y, w) {
    const ctx = this.ctx, own = stats(this.state, 0);
    text(ctx, '第 ' + this.state.round + ' 轮', x, y + 15, 12, C.ink, '600');
    const fw = Math.min(50, (w - 130) / this.state.factions.length);
    this.state.factions.forEach((f, i) => {
      const land = stats(this.state, f.id).land, fx = x + 66 + i * fw;
      hex(ctx, fx + 4, y + 15, 4, land ? f.color : C.dim, null);
      text(ctx, land, fx + 13, y + 15, 10, land ? f.color : C.dim);
    });
    text(ctx, this.busy ? this.state.factions[this.state.current].short + '方行动中' : own.troops + ' 兵', x + w, y + 15, 11, this.busy ? C.gold : C.mint, '500', 'right');
  }
  desktopLayout() {
    const pad = 16, sideW = 260, y = this.top + 86, h = this.h - y - this.bottom - 40;
    this.statusBar(pad, this.top + 51, this.w - pad * 2);
    this.drawMap(pad, y, this.w - sideW - pad * 3, h);
    this.inspector(this.w - sideW - pad, y, sideW, h, false);
    const entry = this.state.logs[0];
    text(this.ctx, entry ? 'R' + entry.round + '  ·  ' + entry.text : '', pad + 2, this.h - this.bottom - 19, 11, C.muted);
  }
  mobileLayout() {
    const y = this.top + 84, infoH = 184;
    this.statusBar(12, this.top + 49, this.w - 24);
    const mapH = Math.max(100, this.h - y - infoH - this.bottom - 20);
    this.drawMap(8, y, this.w - 16, mapH);
    this.inspector(8, y + mapH + 6, this.w - 16, infoH, true);
  }
  landscapeLayout() {
    const y = this.top + 54, h = this.h - y - this.bottom - 8, infoW = 270;
    this.drawMap(8, y, this.w - infoW - 24, h);
    this.inspector(this.w - infoW - 8, y, infoW, h, false);
  }
  drawMap(x, y, w, h) {
    const ctx = this.ctx, radius = SIZES[this.state.config.size].radius;
    const availableH = h - 46;
    const unit = Math.max(5, Math.min((w - 24) / (Math.sqrt(3) * (2 * radius + 1)), availableH / (3 * radius + 2)));
    this.map = { x, y, w, h, radius: unit * this.zoom, cx: x + w / 2 + this.pan.x, cy: y + 35 + availableH / 2 + this.pan.y };
    box(ctx, x, y, w, h, '#141e18', C.border, 12);
    ctx.save(); box(ctx, x + 1, y + 1, w - 2, h - 2, null, null, 12); ctx.clip();
    for (let gx = x + 18; gx < x + w; gx += 24) for (let gy = y + 16; gy < y + h; gy += 24) dot(ctx, gx, gy, 0.7, '#29362a');
    const grad = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.55);
    grad.addColorStop(0, '#66885e13'); grad.addColorStop(1, '#0b150d00'); ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
    ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 34, w - 2, h - 40); ctx.clip();
    const source = this.state.cells[this.selected];
    const points = {};
    for (const cell of Object.values(this.state.cells)) {
      const pos = toPixel(cell.q, cell.r, this.map.radius);
      const px = pos.x + this.map.cx, py = pos.y + this.map.cy, r = this.map.radius - Math.min(2, unit * 0.07);
      points[cell.id] = { x: px, y: py };
      if (px + r < x || px - r > x + w || py + r < y || py - r > y + h) continue;
      const faction = this.state.factions[cell.owner];
      const selected = this.selected === cell.id, target = this.target === cell.id;
      const reachable = source?.owner === 0 && adjacent(source, cell) && !this.busy && this.state.phase === 'playing';
      const neutralColors = ['#28382e', '#26382e', '#2d3b2f'];
      hex(ctx, px, py + 3, r, '#0a100c', null);
      hex(ctx, px, py, r, faction ? faction.fill : neutralColors[cell.terrain], target ? C.gold : selected ? '#ceefac' : faction ? faction.color : reachable ? '#91a878' : C.neutralStroke, selected || target ? 2.3 : 1);
      if (selected) hex(ctx, px, py, r - 4, null, '#a5e3ac55', 1);
      const numberSize = Math.max(9, Math.min(20, r * 0.56));
      text(ctx, cell.troops, px, py - (faction && r > 18 ? 3 : 0), numberSize, faction ? '#f4f2d9' : reachable ? '#d7dfbc' : '#8da185', faction ? '700' : '500', 'center', true);
      if (faction && r > 18) text(ctx, faction.short, px, py + r * 0.44, Math.max(7, Math.min(9, r * 0.28)), faction.color, '400', 'center');
      if (!faction && r > 24) {
        if (cell.terrain === 1) { line(ctx, px - 6, py + 13, px - 3, py + 9, '#677b5840'); line(ctx, px - 3, py + 9, px, py + 13, '#677b5840'); }
        else if (cell.terrain === 2) { dot(ctx, px - 3, py + 12, 1, '#80916750'); dot(ctx, px + 3, py + 12, 1, '#80916750'); }
      }
    }
    for (const route of this.state.orders.filter(order => order.owner === 0)) {
      const a = points[route.from], b = points[route.to];
      arrow(ctx, a.x + (b.x - a.x) * 0.24, a.y + (b.y - a.y) * 0.24, a.x + (b.x - a.x) * 0.77, a.y + (b.y - a.y) * 0.77, C.mint, route.frequency === 'repeat');
    }
    if (this.target && points[this.selected] && points[this.target]) {
      const a = points[this.selected], b = points[this.target];
      arrow(ctx, a.x + (b.x - a.x) * 0.35, a.y + (b.y - a.y) * 0.35, a.x + (b.x - a.x) * 0.77, a.y + (b.y - a.y) * 0.77, C.gold);
    }
    ctx.restore();
    text(ctx, `${SIZES[this.state.config.size].label}战场 · ${Object.keys(this.state.cells).length} 格`, x + 12, y + 19, 11, C.muted, '500');
    ctx.restore();
    const by = y + 5;
    this.button('zoom-out', '−', x + w - 104, by, 28, 27, () => this.changeZoom(-0.2));
    this.button('zoom-reset', '◎', x + w - 70, by, 28, 27, () => { this.zoom = 1; this.pan = { x: 0, y: 0 }; });
    this.button('zoom-in', '+', x + w - 36, by, 28, 27, () => this.changeZoom(0.2));
  }
  inspector(x, y, w, h, compact) {
    const ctx = this.ctx, source = this.state.cells[this.selected], target = this.state.cells[this.target];
    const budget = availableTroops(this.state, this.selected, this.target);
    this.amount = Math.min(this.frequency === 'repeat' ? 99 : budget, Math.max(1, this.amount));
    const canControl = !this.busy && this.state.current === 0 && this.state.phase === 'playing' && source?.owner === 0;
    const ix = x + 12, iw = w - 24, orders = this.state.orders.filter(o => o.owner === 0);
    const saved = orders.find(o => o.from === this.selected && o.to === this.target);
    const dirty = saved && (saved.amount !== this.amount || saved.frequency !== this.frequency);
    const status = saved ? (dirty ? '有修改 · 待更新' : (saved.frequency === 'once' ? '本回合 ' : '每回合 ') + saved.amount + ' 兵 · 已设定') : this.frequency === 'once' && source?.owner === 0 && budget === 0 ? '本回合额度已用完' : this.frequency === 'repeat' ? '本回合优先 · 余兵执行' : '结束回合后执行';
    const description = target ? source.troops + ' 兵 → ' + (target.owner === 0 ? '友军 ' : '守军 ') + target.troops + ' · 可调 ' + budget : source ? source.troops + ' 兵 · ' + (source.owner === 0 ? '本回合可调 ' + budget : source.owner === null ? '中立地块' : this.state.factions[source.owner].name) : '请选择己方领地';
    box(ctx, x, y, w, h, C.panel, C.border);
    // The map and all main controls retain their bounds through every planning state.
    if (compact) {
      text(ctx, description, ix, y + 18, 12, C.mint, '600');
      this.button('cancel-target', '×', ix + iw - 28, y + 5, 28, 27, () => { this.target = null; }, 'normal', !target);
      this.amountControl(ix, y + 38, iw, canControl && !!target);
      this.frequencyControl(ix, y + 80, iw, canControl && !!target, target);
      this.actionButton(ix, y + 112, (iw - 8) / 2, 32, canControl, target);
      this.endButton(ix + (iw + 8) / 2, y + 112, (iw - 8) / 2, 32);
      this.button('orders', '本回合指令 · ' + orders.length, ix, y + 152, 126, 26, () => { this.modal = 'orders'; });
      text(ctx, status, ix + iw, y + 165, 10, dirty ? C.gold : saved ? C.mint : C.dim, '400', 'right');
    } else {
      text(ctx, '行军计划', ix, y + 24, 15, C.ink, '600');
      this.button('cancel-target', '×', ix + iw - 28, y + 10, 28, 27, () => { this.target = null; }, 'normal', !target);
      text(ctx, target ? source.id + ' → ' + target.id : '选择起点与相邻目标', ix, y + 56, 12, C.mint, '500');
      text(ctx, description, ix, y + 82, 12, C.muted);
      text(ctx, status, ix, y + 110, 13, dirty ? C.gold : saved ? C.mint : C.muted, '600');
      this.amountControl(ix, y + 133, iw, canControl && !!target);
      this.frequencyControl(ix, y + 176, iw, canControl && !!target, target);
      this.button('orders', '本回合指令 · ' + orders.length, ix, y + 219, iw, 30, () => { this.modal = 'orders'; });
      if (h >= 440) {
        orders.slice(0, Math.min(3, Math.floor((h - 360) / 46))).forEach((o, i) => {
          text(ctx, o.from + ' → ' + o.to + '  ·  ' + o.amount + ' 兵', ix, y + 277 + i * 46, 11, C.mint);
          text(ctx, o.frequency === 'once' ? '本回合待执行' : '每回合待执行', ix, y + 296 + i * 46, 10, C.muted);
        });
        if (!orders.length) wrap(ctx, '本回合还没有指令。设置后可以继续修改或取消，地图上的兵力在结束回合时才会变化。', ix, y + 280, iw, 12, C.muted, 24);
      }
      this.actionButton(ix, y + h - 48, (iw - 8) / 2, 36, canControl, target);
      this.endButton(ix + (iw + 8) / 2, y + h - 48, (iw - 8) / 2, 36);
    }
  }
  frequencyControl(x, y, w, canControl, target) {
    this.button('frequency-once', '本回合', x, y, 60, 27, () => { this.frequency = 'once'; }, this.frequency === 'once' ? 'active' : 'normal', !canControl);
    this.button('frequency-repeat', '每回合', x + 66, y, 60, 27, () => { this.frequency = 'repeat'; }, this.frequency === 'repeat' ? 'active' : 'normal', !canControl || target?.owner !== 0);
    const order = this.state.orders.find(o => o.from === this.selected && o.to === this.target && o.owner === 0);
    this.button('cancel-order', '撤销指令', x + w - 92, y, 92, 27, () => this.command({ type: 'CANCEL_MARCH', from: this.selected, to: this.target }), 'normal', !canControl || !order);
  }
  amountControl(x, y, w, canControl) {
    const budget = availableTroops(this.state, this.selected, this.target);
    const max = this.frequency === 'repeat' ? 99 : budget;
    this.amount = Math.min(max, Math.max(1, this.amount));
    this.button('amount-minus', '−', x, y, 28, 34, () => { this.amount = Math.max(1, this.amount - 1); }, 'normal', !canControl || this.amount <= 1);
    box(this.ctx, x + 32, y, 44, 34, C.bg, C.border, 6);
    text(this.ctx, this.amount, x + 54, y + 17, 18, C.ink, '600', 'center', true);
    this.button('amount-plus', '+', x + 80, y, 28, 34, () => { this.amount = Math.min(max, this.amount + 1); }, 'normal', !canControl || this.amount >= max);
    const fw = (w - 126) / 3;
    [0.25, 0.5, 1].forEach((v, i) => this.button('amount-' + i, ['1/4', '1/2', '全部'][i], x + 114 + i * (fw + 6), y, fw, 34, () => { this.amount = Math.min(max, Math.max(1, Math.floor(budget * v))); }, 'normal', !canControl || budget === 0));
  }
  actionButton(x, y, w, h, canControl, target) {
    const source = this.state.cells[this.selected], repeat = this.frequency === 'repeat';
    const saved = this.state.orders.find(o => o.from === this.selected && o.to === this.target && o.owner === 0);
    const unchanged = saved && saved.amount === this.amount && saved.frequency === this.frequency;
    const disabled = !canControl || !target || unchanged || this.amount < 1 || (repeat ? target.owner !== 0 : this.amount > availableTroops(this.state, this.selected, this.target));
    this.button('dispatch', saved ? '更新指令' : '设定指令', x, y, w, h, () => {
      if (this.command({ type: 'MARCH', frequency: this.frequency, from: this.selected, to: this.target, amount: this.amount })) {
        this.selectNext = true; this.p.feedback?.();
      }
    }, 'primary', disabled);
  }
  endButton(x, y, w, h) {
    this.button('end-turn', this.busy ? '统一结算中…' : '结束回合  →', x, y, w, h, () => this.endTurn(), 'normal', this.busy || this.cloudBusy || this.state.phase !== 'playing');
  }
  async readCloud() {
    if (!this.p.cloud || this.cloudBusy) return;
    this.cloudBusy = true; this.cloudError = ''; this.render();
    try { this.cloudRecord = await this.p.cloud.read(); }
    catch (error) { this.cloudError = error.message; this.cloudRecord = null; }
    finally { this.cloudBusy = false; this.render(); }
  }
  async writeCloud() {
    if (this.busy || this.cloudBusy || !this.cloudRecord) return;
    this.cloudBusy = true; this.render();
    const state = JSON.parse(serialize(this.state));
    try {
      const result = await this.p.cloud.write(state, this.cloudRecord.revision);
      this.cloudRecord = { ...result, state }; this.cloudError = ''; this.notify('当前战役已备份到云端。');
    } catch (error) { this.cloudError = error.message; this.cloudRecord = null; }
    finally { this.cloudBusy = false; this.render(); }
  }
  restoreCloud() {
    if (this.busy || this.cloudBusy) return;
    const saved = restore(this.cloudRecord?.state);
    if (!saved) { this.notify('云端暂无有效存档。'); return; }
    this.generation++; this.state = saved; this.busy = false;
    this.zoom = 1; this.pan = { x: 0, y: 0 }; this.frequency = 'once'; this.modal = null;
    this.selectHome(); this.save();
    if (saved.phase === 'finished') this.modal = 'result';
    this.notify('云端战役已读取，本地存档已更新。');
    if (saved.current !== 0 && saved.phase === 'playing') this.runAI();
  }
  cloudPanel(x, y, w, compact) {
    const ctx = this.ctx, record = this.cloudRecord;
    text(ctx, this.cloudBusy ? '正在连接云存档…' : record?.state ? `云端战役 · 第 ${record.state.round} 轮` : record ? '云端暂无备份' : '微信云存档', x, y, 12, C.mint, '600');
    if (this.cloudError) {
      wrap(ctx, this.cloudError, x, y + 25, w, 11, C.muted, 18);
      this.button('cloud-retry', '重新连接', x, y + (compact ? 79 : 110), w, 34, () => this.readCloud(), 'normal', this.cloudBusy);
      return;
    }
    wrap(ctx, '备份会更新云端；读取会替换本机战役。', x, y + 26, w, 10, C.muted, 18);
    const by = y + (compact ? 62 : 90), bw = (w - 8) / 2;
    this.button('cloud-backup', '备份当前', x, by, bw, 34, () => this.writeCloud(), 'primary', this.busy || this.cloudBusy || !record);
    this.button('cloud-restore', '读取云端', x + bw + 8, by, bw, 34, () => this.restoreCloud(), 'normal', this.busy || this.cloudBusy || !record?.state);
    if (!compact) wrap(ctx, '本机每步自动保存。云端由你手动备份，使用当前微信账号识别；断网不影响继续游戏。', x, by + 65, w, 11, C.muted, 21);
  }
  routesPanel(x, y, w, h) {
    const ctx = this.ctx, routes = this.state.orders.filter(r => r.owner === 0);
    if (!routes.length) {
      text(ctx, '本回合还没有指令', x, y + 8, 15, C.mint, '600');
      wrap(ctx, '选择起点、相邻目标和兵力，设定「本回合」或「每回合」指令。结束回合前可随时修改或取消。', x, y + 44, w, 12, C.muted, 24);
      return;
    }
    const perPage = Math.max(1, Math.floor((h - 36) / 65)), maxPage = Math.ceil(routes.length / perPage) - 1;
    this.routePage = Math.max(0, Math.min(this.routePage || 0, maxPage));
    routes.slice(this.routePage * perPage, (this.routePage + 1) * perPage).forEach((r, i) => {
      const ry = y + i * 65, editW = w - 44;
      this.button('edit-' + r.from + '>' + r.to, '', x, ry, editW, 55, () => {
        this.selected = r.from; this.target = r.to; this.frequency = r.frequency; this.amount = r.amount; this.modal = null;
        this.selectNext = true;
      }, 'normal', this.busy || this.state.phase !== 'playing');
      this.buttons[this.buttons.length - 1].label = '编辑 ' + r.from + ' → ' + r.to;
      text(ctx, r.from + ' → ' + r.to, x + 10, ry + 17, 11, C.ink, '500', 'left', true);
      text(ctx, (r.frequency === 'once' ? '本回合 ' : '每回合 ') + r.amount + ' 兵 · 待执行', x + 10, ry + 38, 10, C.mint);
      this.button('remove-' + r.from + '>' + r.to, '×', x + w - 36, ry + 11, 36, 34, () => this.command({ type: 'CANCEL_MARCH', from: r.from, to: r.to }), 'normal', this.busy || this.state.phase !== 'playing');
    });
    const by = y + h - 28;
    if (maxPage > 0) {
      this.button('routes-prev', '‹', x, by, 32, 27, () => { this.routePage--; }, 'normal', this.routePage === 0);
      text(ctx, (this.routePage + 1) + ' / ' + (maxPage + 1), x + w / 2, by + 14, 10, C.muted, '400', 'center');
      this.button('routes-next', '›', x + w - 32, by, 32, 27, () => { this.routePage++; }, 'normal', this.routePage === maxPage);
    }
  }
  drawModal() {
    const ctx = this.ctx, setup = this.modal === 'setup', rules = this.modal === 'rules', cloud = this.modal === 'cloud', orders = this.modal === 'orders';
    ctx.fillStyle = '#050c09dc'; ctx.fillRect(0, 0, this.w, this.h);
    const available = this.h - this.top - this.bottom - 20;
    const w = Math.min(this.w - 28, setup ? 520 : 540), h = Math.min(available, setup ? 542 : rules ? 570 : orders ? 500 : 420);
    const x = (this.w - w) / 2, y = this.top + (this.h - this.top - this.bottom - h) / 2;
    box(ctx, x, y, w, h, '#1a261e', '#465940', 18);
    const tight = h < 490, pad = w < 400 ? 22 : 32;
    const ix = x + pad, iw = w - pad * 2;
    this.button('close-modal', '×', x + w - 48, y + 15, 30, 30, () => { this.modal = null; });
    if (cloud) {
      text(ctx, '存档', ix, y + 43, 23, C.ink, '600');
      text(ctx, '本机每步自动保存', ix, y + 77, 12, C.muted);
      if (this.p.cloud) this.cloudPanel(ix, y + 116, iw, h < 380);
      else {
        text(ctx, '本机进度已保留', ix, y + 127, 14, C.mint, '600');
        wrap(ctx, '刷新页面后可以继续当前战役。微信小游戏内可使用微信账号备份和读取云存档。', ix, y + 164, iw, 12, C.muted, 24);
      }
    } else if (orders) {
      text(ctx, '本回合指令', ix, y + 43, 23, C.ink, '600');
      text(ctx, '本回合优先 · 每回合使用剩余兵力', ix, y + 76, w < 400 ? 10 : 12, C.muted);
      this.routesPanel(ix, y + 107, iw, h - 124);
    } else if (setup) {
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
        [ ['01', '规划行军', '点己方领地，再点相邻目标，设置兵力与方向。设定后下一次点格子会直接切换选中。所有计划在结束回合后一起执行。'], ['02', '本回合与每回合', '「本回合」执行一次后清除；相邻友军可选「每回合」持续调兵。同一起点可设多个方向，本回合指令列表可查看和修改。'], ['03', '合兵与遭遇', '同势力抵达同一格的部队合兵作战。双方沿同一路线互攻，先在途中交战，胜方幸存部队继续攻城。败方全灭，胜方损耗会小幅浮动。'] ],
        [ ['04', '结算与补给', '全部势力锁定后一起结算。每格留 1 兵，本回合指令合计不能超过余兵；先满足本回合，再以剩余兵力按比例执行每回合指令。援军本轮不再出发，整轮后领地各加 1 兵。'], ['05', '管理指令', '同一起点与目标只有一条指令。数量和频率没有改动时，更新按钮置灰；调整后亮起，保存后再次置灰。持续调兵任一端失守后取消。'], ['06', '赢下这片疆土', '整轮全部战斗结束后，消灭所有敌对势力的彩色领地即可获胜。出发地失守不影响已出发的部队。每步自动保存，右上角保存图标可查看云存档。'] ],
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
