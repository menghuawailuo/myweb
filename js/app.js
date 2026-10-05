/* ============================================================
 * app.js — 界面与数据层
 * 计算相关的纯函数全部在 js/calc.js（本文件里直接用全局名调用）
 * ============================================================ */

/* ============ 常量 ============ */
const STORE_KEY = 'cabinetAppData_v1';
const SNAP_KEY = 'cabinetAppData_v1_snapshot';
const RESCUE_KEY = 'cabinetAppData_v1_rescue';
const SAVE_DEBOUNCE = 400;          // 打字时的落盘合并窗口（ms）
const BACKUP_REMIND_DAYS = 7;       // 多少天没备份就提醒
const DAY_MS = 86400000;
const CDN_JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
const CDN_HTML2CANVAS = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const CDN_XLSX = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const PDF_MAX_PIXELS = 24e6;        // html2canvas 位图上限（约 96MB），超过就降清晰度
// 渲染倍数 2 对应 A4 横向约 180 DPI，印出来字口清清楚楚；再往上翻倍像素换来的
// 清晰度肉眼看不出来，文件却要大一倍多。账单特别长时还会再往下退（见 exportPdf）。
const PDF_RENDER_SCALE = 2;
const PDF_JPEG_QUALITY = 0.92;      // 逐页跟 PNG 比大小，JPEG 更小才用它

/* ============ 小工具 ============ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 任意值 → 有限数字，失败时用兜底值
function n0(v, dflt) {
  const n = parseFloat(v);
  return isNaN(n) ? dflt : n;
}

// 任意值 → 字符串
function s0(v, dflt) {
  return (v == null || v === '') ? (dflt == null ? '' : dflt) : String(v);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function billDate(d) {
  d = d || new Date();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// 图表柱顶用的紧凑金额：1284 → "1284"；26000 → "2.6万"
function compactMoney(n) {
  const v = Math.round(Number(n) || 0);
  if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '万';
  return String(v);
}

/* ============ 数据层 ============ */

function defaultState() {
  return {
    projects: [],
    defaultPrice: 50,
    theme: 'teal',
    presets: null,
    defaultMode: 'flat',       // 新建工程默认的录入方式，记住上次用过的
    lastBackupAt: 0,
    backupSnoozeUntil: 0
  };
}

// 录入方式（两者底层数据结构完全一样，只是显示和录入路径不同）：
//   'flat' 直列柜子 —— 不用先建房间，打开工程就能加柜子
//   'room' 按房间分类 —— 先建厨房/主卧，柜子放进对应房间
const MODES = ['flat', 'room'];
const MODE_HINT = {
  flat: '不用先建房间，打开工程就能直接加柜子，适合一次报完一整套',
  room: '先建厨房 / 主卧等房间，柜子放进对应房间，适合分区域对账'
};
const MODE_LABEL = { flat: '直接列柜子', room: '按房间分类' };

// 把任意来源（本地存储 / 导入文件）的数据补全成完整结构。
// 这里必须假设输入是脏的：缺字段、类型不对、值为 null 都要能扛住。
function normalizeState(raw) {
  const s = (raw && typeof raw === 'object') ? raw : {};
  if (!Array.isArray(s.projects)) s.projects = [];

  s.defaultPrice = n0(s.defaultPrice, 50);
  s.theme = typeof s.theme === 'string' ? s.theme : 'teal';
  s.defaultMode = s.defaultMode === 'room' ? 'room' : 'flat';
  s.lastBackupAt = n0(s.lastBackupAt, 0);
  s.backupSnoozeUntil = n0(s.backupSnoozeUntil, 0);
  s.presets = (s.presets && typeof s.presets === 'object') ? s.presets : null;

  s.projects = s.projects
    .filter(p => p && typeof p === 'object')
    .map(p => {
      p.id = s0(p.id) || uid();
      p.name = s0(p.name, '未命名工程');
      p.defaultPrice = n0(p.defaultPrice, s.defaultPrice);
      p.date = s0(p.date);
      p.location = s0(p.location);
      p.factory = s0(p.factory);
      p.designer = s0(p.designer);
      p.createdAt = n0(p.createdAt, Date.now());
      // 老数据（没有 mode 字段）一律按「按房间分类」处理，跟原来的用法保持一致
      p.mode = p.mode === 'flat' ? 'flat' : 'room';
      p.discountType = ['none', 'rate', 'amount'].indexOf(p.discountType) !== -1 ? p.discountType : 'none';
      p.discountRate = clamp01(p.discountRate, 1);
      p.discountAmount = Math.max(0, n0(p.discountAmount, 0));
      p.paidAmount = Math.max(0, n0(p.paidAmount, 0));
      // 注意：不保留 p.settled。「是否结清」由金额推导（见 calc.js），
      // 存下来的旧标记会变成过期状态，反而让两个页面对不上。
      delete p.settled;

      // 关键：把 rooms / cabinets / extras 补成真正的数组，
      // 否则后面 p.rooms.push(...) 会直接抛错。
      // 杂项存在房间上（r.extras），与柜子同级；老数据在柜子上，下面会搬上来。
      p.rooms = (Array.isArray(p.rooms) ? p.rooms : [])
        .filter(r => r && typeof r === 'object')
        .map(r => {
          r.id = s0(r.id) || uid();
          // 名字允许为空：直列模式下柜子装在一个没有名字的容器房间里
          r.name = s0(r.name);
          const moved = [];   // 从柜子上搬下来的杂项，见下面 c.extras 的处理
          r.cabinets = (Array.isArray(r.cabinets) ? r.cabinets : [])
            .filter(c => c && typeof c === 'object')
            .map(c => {
              c.id = s0(c.id) || uid();
              c.name = s0(c.name, '未命名');
              c.pricingType = PRICING_TYPES.indexOf(c.pricingType) !== -1 ? c.pricingType : 'area';
              c.width = n0(c.width, 0);
              c.height = n0(c.height, 0);
              c.length = n0(c.length, 0);
              c.quantity = n0(c.quantity, 1);
              c.unitPrice = n0(c.unitPrice, 0);
              c.fixedAmount = n0(c.fixedAmount, 0);
              c.note = s0(c.note);
              // 杂项已从「柜子下」搬到「房间里」，老数据里挂在柜子上的杂项在这里搬上去。
              // 钱的总额一分不变（房间小计 = 柜子合计 + 杂项合计），只是换了个归属。
              if (Array.isArray(c.extras)) {
                c.extras.forEach(e => { if (e && typeof e === 'object') moved.push(e); });
              }
              delete c.extras;
              return c;
            });
          r.extras = (Array.isArray(r.extras) ? r.extras : []).concat(moved);
          r.extras = r.extras
            .filter(e => e && typeof e === 'object')
            .map(e => ({
              name: s0(e.name),
              qty: n0(e.qty, 0),
              price: n0(e.price, 0),
              unit: s0(e.unit, '个')
            }))
            .filter(e => e.name);
          return r;
        });
      return p;
    });

  return s;
}

/* ---------- 读取 ---------- */

let corruptRaw = null;   // 读取失败时的原始字符串，供用户抢救

function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch (e) {
    // 浏览器禁用存储 / 无痕模式
    return { state: defaultState(), status: 'nostorage' };
  }
  if (!raw) return { state: defaultState(), status: 'new' };

  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') throw new Error('顶层不是对象');
    return { state: normalizeState(data), status: 'ok' };
  } catch (e) {
    // 数据损坏时绝不能静默返回空账本 —— 否则下一次保存就把原件覆盖了
    corruptRaw = raw;
    try { localStorage.setItem(RESCUE_KEY, raw); } catch (e2) { /* 存不下就只留在内存里 */ }
    return { state: defaultState(), status: 'corrupt' };
  }
}

const loaded = load();
let state = loaded.state;
let storageOk = loaded.status !== 'nostorage';

/* ---------- 写入 ---------- */

let saveTimer = null;

function writeState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (!storageOk) { storageOk = true; refreshNotices(); }
  } catch (e) {
    if (storageOk) {
      storageOk = false;
      toast('保存失败：存储空间可能已满，请立即备份');
      refreshNotices();
    }
  }
}

// 结构变更（增删改）→ 立刻落盘
function save() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  writeState();
}

// 连续打字 → 合并写入，避免每敲一个字符就序列化全部工程
function saveSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; writeState(); }, SAVE_DEBOUNCE);
}

// 页面被切走/关闭前把未落盘的改动补齐
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; writeState(); }
}
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

function getProject(id) { return state.projects.find(p => p.id === id); }

function isFlat(p) { return !!p && p.mode === 'flat'; }

// 直列模式也需要一个房间来装柜子，只是不显示出来。
// 这样 calc.js 的所有汇总函数一行都不用改，两种模式共用同一套口径。
function flatRoom(p, create) {
  if (!p) return null;
  const rooms = p.rooms || (p.rooms = []);
  let r = rooms.find(x => !x.name) || rooms[0];
  if (!r && create) { r = { id: uid(), name: '', cabinets: [], extras: [] }; rooms.push(r); }
  return r || null;
}

/* ---------- 后悔药：操作前的快照 ---------- */

let snapCache = null;

function snapshotCurrent(reason) {
  const payload = { at: Date.now(), reason: reason, data: JSON.parse(JSON.stringify(state)) };
  snapCache = payload;   // 内存里留一份，localStorage 写不进去时仍然可恢复
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(payload)); } catch (e) { /* 忽略 */ }
}

function readSnapshot() {
  if (snapCache) return snapCache;
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && p.data && Array.isArray(p.data.projects)) { snapCache = p; return p; }
  } catch (e) { /* 快照坏了就当没有 */ }
  return null;
}

const SNAP_REASON = {
  'before-delete': '删除工程前',
  'before-clear': '清空数据前',
  'before-import': '导入备份前',
  'before-restore': '恢复数据前'
};

/* ---------- 备份 ---------- */

function shouldRemindBackup() {
  if (!state.projects.length) return false;
  if (Date.now() < (state.backupSnoozeUntil || 0)) return false;
  const last = state.lastBackupAt || 0;
  return !last || (Date.now() - last) >= BACKUP_REMIND_DAYS * DAY_MS;
}

function backupReminderText() {
  const last = state.lastBackupAt || 0;
  if (!last) {
    return '这些账单还没有备份过。数据只存在这台设备的浏览器里——清理缓存、换手机就没了，建议导出一份存到微信或网盘。';
  }
  const days = Math.floor((Date.now() - last) / DAY_MS);
  return '距上次备份已 ' + days + ' 天，建议再导出一份备份文件。';
}

function downloadBlob(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportBackup() {
  downloadBlob('橱柜对账备份-' + billDate() + '.json', JSON.stringify(state, null, 2));
  state.lastBackupAt = Date.now();
  state.backupSnoozeUntil = 0;
  save();
  renderMine();
  refreshNotices();
  toast('备份文件已下载，请妥善保存');
}

/* ---------- 主题色 ---------- */

const THEMES = [
  { id: 'teal', name: '青绿', primary: '#0d9488', primary2: '#14b8a6', primaryDark: '#0f766e', primaryLight: '#ccfbf1' },
  { id: 'blue', name: '蓝色', primary: '#2563eb', primary2: '#3b82f6', primaryDark: '#1d4ed8', primaryLight: '#dbeafe' },
  { id: 'violet', name: '紫色', primary: '#7c3aed', primary2: '#8b5cf6', primaryDark: '#6d28d9', primaryLight: '#ede9fe' },
  { id: 'rose', name: '玫红', primary: '#e11d48', primary2: '#f43f5e', primaryDark: '#be123c', primaryLight: '#ffe4e6' },
  { id: 'green', name: '翠绿', primary: '#16a34a', primary2: '#22c55e', primaryDark: '#15803d', primaryLight: '#dcfce7' },
  { id: 'orange', name: '暖橙', primary: '#ea580c', primary2: '#f97316', primaryDark: '#c2410c', primaryLight: '#ffedd5' }
];

function sanitizeTheme() {
  if (!THEMES.some(t => t.id === state.theme)) state.theme = 'teal';
}

function applyTheme(themeId) {
  const t = THEMES.find(x => x.id === themeId) || THEMES[0];
  const root = document.documentElement.style;
  root.setProperty('--primary', t.primary);
  root.setProperty('--primary2', t.primary2);
  root.setProperty('--primary-dark', t.primaryDark);
  root.setProperty('--primary-light', t.primaryLight);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.primary);
}

/* ============ 预选词 ============ */

const ROOM_PRESETS = [
  { group: '卧室', items: ['主卧', '次卧', '老人房', '客卧', '儿童房', '书房', '榻榻米房'] },
  { group: '厨卫', items: ['厨房', '中西厨', '卫生间', '浴室', '洗衣房'] },
  { group: '客厅餐厅', items: ['客厅', '餐厅', '电视柜', '沙发背景墙', '隔断', '吧台'] },
  { group: '阳台入户', items: ['阳台', '生活阳台', '休闲阳台', '阳光房', '露台', '玄关', '门厅', '过道', '楼梯间'] },
  { group: '功能', items: ['衣帽间', '储物间', '鞋柜区', '佛堂', '茶室', '影音室', '阁楼', '地下室'] }
];

const CABINET_PRESETS = [
  { id: 'kitchen', group: '厨房', rooms: ['厨房', '中西厨'], items: ['地柜', '吊柜', '高柜', '中岛台', '吧台', '台面', '水槽柜', '灶台柜', '烟机柜', '转角柜', '拉篮柜', '调味柜', '电器柜'] },
  { id: 'bedroom', group: '卧室', rooms: ['主卧', '次卧', '老人房', '客卧', '客房', '儿童房', '书房', '榻榻米房', '衣帽间'], items: ['衣柜', '顶柜', '飘窗柜', '床头柜', '梳妆台', '书桌', '书柜', '榻榻米', '斗柜'] },
  { id: 'living', group: '客厅餐厅', rooms: ['客厅', '餐厅', '电视柜', '电视墙', '沙发背景墙', '隔断', '吧台', '玄关', '门厅', '鞋柜区'], items: ['电视柜', '背景墙柜', '收纳柜', '展示柜', '酒柜', '餐边柜', '玄关柜', '鞋柜', '隔断柜', '卡座'] },
  { id: 'bath', group: '卫生间阳台', rooms: ['卫生间', '浴室', '洗衣房', '阳台', '生活阳台', '休闲阳台', '阳光房', '露台'], items: ['浴室柜', '镜柜', '洗衣机柜', '阳台柜', '拖把池柜', '家政柜'] }
];

// 分类库存的是用户自己编辑过的版本，所以每次启动都要校验一遍结构
function normalizePresetGroups(groups, defaults) {
  const cloneDefaults = () => JSON.parse(JSON.stringify(defaults));
  if (!Array.isArray(groups)) return cloneDefaults();
  const out = groups
    .filter(g => g && typeof g === 'object' && Array.isArray(g.items))
    .map(g => {
      const item = { group: s0(g.group, '其他'), items: g.items.filter(i => typeof i === 'string' && i.trim()).map(i => i.trim()) };
      if (g.id) item.id = String(g.id);
      if (Array.isArray(g.rooms)) item.rooms = g.rooms.filter(r => typeof r === 'string');
      return item;
    })
    .filter(g => g.items.length);
  return out.length ? out : cloneDefaults();
}

function initPresets() {
  const cur = state.presets || {};
  state.presets = {
    rooms: normalizePresetGroups(cur.rooms, ROOM_PRESETS),
    cabinets: normalizePresetGroups(cur.cabinets, CABINET_PRESETS)
  };
  save();
}

function roomPresets() { return state.presets.rooms; }
function cabinetPresets() { return state.presets.cabinets; }

// 根据房间名推荐对应的柜子分组；无法判断时返回全部分组
function cabinetGroupsForRoom(roomName) {
  const all = cabinetPresets();
  const name = (roomName || '').trim();
  if (!name) return all;
  const exact = all.filter(g => Array.isArray(g.rooms) && g.rooms.indexOf(name) !== -1);
  if (exact.length) return exact;
  const rules = [
    ['厨', 'kitchen'],
    ['卫', 'bath'], ['浴', 'bath'], ['洗', 'bath'], ['阳', 'bath'], ['露台', 'bath'],
    ['卧', 'bedroom'], ['衣帽', 'bedroom'], ['书房', 'bedroom'], ['儿童', 'bedroom'], ['榻榻', 'bedroom'],
    ['客', 'living'], ['厅', 'living'], ['餐', 'living'], ['电视', 'living'], ['酒', 'living'],
    ['吧台', 'living'], ['隔断', 'living'], ['玄关', 'living'], ['鞋', 'living'], ['门厅', 'living']
  ];
  const ids = [];
  rules.forEach(r => { if (name.indexOf(r[0]) !== -1 && ids.indexOf(r[1]) === -1) ids.push(r[1]); });
  const groups = all.filter(g => ids.indexOf(g.id) !== -1);
  return groups.length ? groups : all;
}

function presetChipsHTML(groups, targetId) {
  const target = targetId || 'f-name';
  return groups.map(g => `
    <div class="preset-group">
      <span class="preset-label">${esc(g.group)}</span>
      <div class="chips">${g.items.map(it =>
        `<button type="button" class="chip" data-action="preset-fill" data-target="${esc(target)}" data-value="${esc(it)}">${esc(it)}</button>`
      ).join('')}</div>
    </div>`).join('');
}

/* ============ 弹窗 ============ */

let modalCtx = null;

/* ---------- 打开弹窗 ---------- */

function openModal(type, ctx) {
  modalCtx = Object.assign({ type: type }, ctx || {});
  const sheet = document.getElementById('sheet');
  let html = '';

  if (type === 'project') {
    const p = ctx && ctx.projectId ? getProject(ctx.projectId) : null;
    // 已有工程沿用它的方式；新建的用上次用过的（存在 defaultMode 里）
    const mode = p ? (p.mode === 'flat' ? 'flat' : 'room')
      : (state.defaultMode === 'room' ? 'room' : 'flat');
    modalCtx.mode = mode;
    const modeChip = v =>
      `<button type="button" class="chip ${mode === v ? 'chip-on' : ''}" data-action="set-mode" data-value="${v}">${MODE_LABEL[v]}</button>`;
    html = `
      <h2>${p ? '编辑工程' : '新建工程'}</h2>
      <div class="field"><label>录入方式</label>
        <div class="chips" id="mode-chips">${modeChip('flat') + modeChip('room')}</div>
        <div class="preset-hint" id="mode-hint" style="margin:8px 0 0">${MODE_HINT[mode]}</div>
      </div>
      <div class="field"><label>时间</label><input id="f-date" type="date" value="${p ? esc(p.date || '') : billDate()}"></div>
      <div class="grid2">
      <div class="field"><label>地址（如：卫辉-博士园）</label><input id="f-name" placeholder="请输入城市-小区名称" value="${p ? esc(p.name) : ''}"></div>
      <div class="field"><label>楼号单元号房间号</label><input id="f-location" placeholder="如：21栋1单元1102" value="${p ? esc(p.location) : ''}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>柜板厂房</label><input id="f-factory" placeholder="厂房名称" value="${p ? esc(p.factory) : ''}"></div>
        <div class="field"><label>设计师</label><input id="f-designer" placeholder="设计师姓名" value="${p ? esc(p.designer) : ''}"></div>
      </div>
      <div class="field unit"><label>面积单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${p ? p.defaultPrice : (state.defaultPrice || 50)}"><span>元/m²</span></div>
      <div class="btn-row">
        <button class="btn secondary" data-action="modal-cancel">取消</button>
        <button class="btn" data-action="modal-save">保存</button>
      </div>`;

  } else if (type === 'room') {
    const p = getProject(ctx.projectId);
    const r = ctx.roomId ? (p.rooms || []).find(x => x.id === ctx.roomId) : null;
    html = `
      <h2>${r ? '编辑房间' : '添加房间'}</h2>
      <div class="field"><label>房间名称（如：厨房 / 主卧 / 电视柜）</label><input id="f-name" placeholder="请输入房间名称" value="${r ? esc(r.name) : ''}"></div>
      ${presetChipsHTML(roomPresets())}
      <div class="btn-row">
        <button class="btn secondary" data-action="modal-cancel">取消</button>
        <button class="btn" data-action="modal-save">保存</button>
      </div>`;

  } else if (type === 'cabinet') {
    openCabinetForm(ctx);
    return;
  }

  sheet.innerHTML = html;
  document.getElementById('overlay').classList.add('show');
  const first = sheet.querySelector('input');
  if (first) first.focus();
}

/* ---------- 柜子表单（四种计价方式各自保留草稿） ---------- */

// 草稿按计价方式分开存：切走再切回来能原样恢复，
// 保存时四种方式的字段全部写回记录，切换计价方式不再丢数据。
function cabinetDraft(c, defPrice) {
  const s = v => (v == null || v === '' ? '' : String(v));
  const qty = c ? s(c.quantity) : '1';
  const storedPrice = (c && parseFloat(c.unitPrice) > 0) ? c.unitPrice : defPrice;
  const price = s(storedPrice);
  return {
    area: { width: s(c && c.width), height: s(c && c.height), quantity: qty || '1', unitPrice: price },
    linear: { length: s(c && c.length), quantity: qty || '1', unitPrice: price },
    unit: { quantity: qty || '1', unitPrice: price },
    fixed: { fixedAmount: s(c && c.fixedAmount) }
  };
}

function openCabinetForm(ctx) {
  const p = getProject(ctx.projectId);
  const r = (p.rooms || []).find(x => x.id === ctx.roomId);
  const c = ctx.cabinetId ? (r.cabinets || []).find(x => x.id === ctx.cabinetId) : null;
  const pricingType = ctx.pricingType || (c ? cabinetPricingType(c) : 'area');
  const draft = cabinetDraft(c, p.defaultPrice);

  // 「保存并继续」：把上一笔的数量和单价带过来，方便连续录入同规格的柜子
  if (!c) {
    if (ctx.quantity != null) draft[pricingType].quantity = String(ctx.quantity);
    if (ctx.unitPrice != null && parseFloat(ctx.unitPrice) > 0) draft[pricingType].unitPrice = String(ctx.unitPrice);
  }

  modalCtx = {
    type: 'cabinet',
    projectId: ctx.projectId,
    roomId: ctx.roomId,
    cabinetId: ctx.cabinetId || null,
    pricingType: pricingType,
    draft: draft,
    // 切换计价方式时用来兜底，避免把已存的数字改没
    fallbackQty: c ? n0(c.quantity, 1) : 1,
    fallbackPrice: c ? n0(c.unitPrice, 0) : 0
  };

  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `
    <h2>${c ? '编辑柜子' : '添加柜子'}</h2>
    <div class="field"><label>名称（如：地柜 / 吊柜 / 高柜）</label><input id="f-name" placeholder="请输入柜子名称" value="${c ? esc(c.name) : ''}"></div>
    <div class="preset-hint">${r && r.name ? '当前房间「' + esc(r.name) + '」推荐的柜子：' : '常用柜子：'}</div>
    ${presetChipsHTML(cabinetGroupsForRoom(r ? r.name : ''))}

    <div class="section-label">计价方式</div>
    <div id="pricing-section"></div>

    <div class="section-label">备注</div>
    <div class="field"><input id="f-note" placeholder="可选：含抽屉 / 玻璃门" value="${c ? esc(c.note || '') : ''}"></div>

    <div class="btn-row">
      <button class="btn secondary" data-action="modal-cancel" style="font-size:14px">取消</button>
      <button class="btn secondary" data-action="modal-save-continue" style="font-size:14px">保存并继续</button>
      <button class="btn" data-action="modal-save" style="font-size:14px">保存</button>
    </div>`;
  document.getElementById('overlay').classList.add('show');
  renderPricingSection();
  const first = sheet.querySelector('input');
  if (first) first.focus();
}

// 把当前可见的计价字段读回草稿（切换计价方式 / 保存前调用）
function capturePricingFields() {
  if (!modalCtx || modalCtx.type !== 'cabinet' || !modalCtx.draft) return;
  const type = modalCtx.pricingType || 'area';
  const d = modalCtx.draft[type] || (modalCtx.draft[type] = {});
  const grab = (key, id) => { const el = document.getElementById(id); if (el) d[key] = el.value; };
  if (type === 'area') { grab('width', 'f-width'); grab('height', 'f-height'); grab('quantity', 'f-qty'); grab('unitPrice', 'f-price'); }
  else if (type === 'linear') { grab('length', 'f-length'); grab('quantity', 'f-qty'); grab('unitPrice', 'f-price'); }
  else if (type === 'unit') { grab('quantity', 'f-qty'); grab('unitPrice', 'f-price'); }
  else { grab('fixedAmount', 'f-fixed'); }
}

function renderPricingSection() {
  const el = document.getElementById('pricing-section');
  if (!el || !modalCtx) return;
  const type = modalCtx.pricingType || 'area';
  const d = modalCtx.draft[type] || (modalCtx.draft[type] = {});
  const chip = (v, label) =>
    `<button type="button" class="chip ${type === v ? 'chip-on' : ''}" data-action="set-pricing" data-value="${v}">${label}</button>`;
  el.innerHTML = `
    <div class="field"><label>计价方式</label><div class="chips">${
      chip('area', '面积计价') + chip('linear', '延米计价') + chip('unit', '按件计价') + chip('fixed', '固定金额')
    }</div></div>
    ${pricingFieldsHTML(type, d)}`;
}

function pricingFieldsHTML(type, d) {
  const v = k => esc(d[k] == null ? '' : d[k]);
  if (type === 'linear') {
    return `
      <div class="field unit"><label>长度</label><input id="f-length" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${v('length')}"><span>米</span></div>
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="decimal" step="any" min="0" placeholder="1" value="${v('quantity')}"></div>
        <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${v('unitPrice')}"><span>元/米</span></div>
      </div>`;
  }
  if (type === 'unit') {
    return `
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="decimal" step="any" min="0" placeholder="1" value="${v('quantity')}"></div>
        <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${v('unitPrice')}"><span>元/件</span></div>
      </div>`;
  }
  if (type === 'fixed') {
    return `
      <div class="field unit"><label>固定金额</label><input id="f-fixed" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${v('fixedAmount')}"><span>元</span></div>`;
  }
  return `
    <div class="grid2">
      <div class="field unit"><label>宽</label><input id="f-width" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${v('width')}"><span>米</span></div>
      <div class="field unit"><label>高</label><input id="f-height" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${v('height')}"><span>米</span></div>
    </div>
    <div class="grid2">
      <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="decimal" step="any" min="0" placeholder="1" value="${v('quantity')}"></div>
      <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${v('unitPrice')}"><span>元/m²</span></div>
    </div>`;
}

function closeModal() {
  document.getElementById('overlay').classList.remove('show');
  modalCtx = null;
}

function openSheet(html) {
  document.getElementById('sheet').innerHTML = html;
  document.getElementById('overlay').classList.add('show');
}

function openNewOrder() {
  lastCreatedProjectId = null;
  openModal('project', {
    afterSave: () => {
      if (lastCreatedProjectId) {
        currentProjectId = lastCreatedProjectId;
        expandedRooms.clear();
        switchTab('detail');
        renderProject();
      }
    }
  });
}

/* ---------- 保存弹窗 ---------- */

function saveModal() {
  const t = modalCtx.type;
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  if (t === 'project') {
    const name = v('f-name');
    const price = n0(v('f-price'), 0);
    const date = v('f-date');
    const location = v('f-location');
    const factory = v('f-factory');
    const designer = v('f-designer');
    if (!name) return toast('请输入工程名称');
    const mode = MODES.indexOf(modalCtx.mode) !== -1 ? modalCtx.mode : 'flat';
    state.defaultMode = mode;   // 记住这次的选择，下次新建直接默认它
    if (modalCtx.projectId) {
      const p = getProject(modalCtx.projectId);
      p.name = name; p.defaultPrice = price;
      p.date = date; p.location = location; p.factory = factory; p.designer = designer;
      // 只是换个显示方式，柜子数据原封不动
      p.mode = mode;
    } else {
      const id = uid();
      state.projects.push({
        id: id, name: name, defaultPrice: price, createdAt: Date.now(), rooms: [],
        date: date, location: location, factory: factory, designer: designer,
        mode: mode,
        discountType: 'none', discountRate: 1, discountAmount: 0, paidAmount: 0
      });
      lastCreatedProjectId = id;
    }

  } else if (t === 'room') {
    const name = v('f-name');
    if (!name) return toast('请输入房间名称');
    const p = getProject(modalCtx.projectId);
    if (!p) return toast('工程不存在，请返回重试');
    if (modalCtx.roomId) {
      const r = p.rooms.find(x => x.id === modalCtx.roomId);
      if (r) r.name = name;
    } else {
      p.rooms.push({ id: uid(), name: name, cabinets: [], extras: [] });
    }

  } else if (t === 'cabinet') {
    const p = getProject(modalCtx.projectId);
    const r = (p && p.rooms || []).find(x => x.id === modalCtx.roomId);
    if (!r) return toast('房间不存在，请返回重试');

    capturePricingFields();
    const name = v('f-name') || '未命名';
    const pricingType = modalCtx.pricingType || 'area';
    const note = v('f-note');
    const d = modalCtx.draft;
    const cur = d[pricingType] || {};

    // 四种计价方式的字段各自独立保存 —— 切换计价方式不会把另一种的数据清零
    const data = {
      name: name,
      pricingType: pricingType,
      note: note,
      width: n0(d.area.width, 0),
      height: n0(d.area.height, 0),
      length: n0(d.linear.length, 0),
      fixedAmount: n0(d.fixed.fixedAmount, 0),
      quantity: n0(cur.quantity, modalCtx.fallbackQty),
      unitPrice: n0(cur.unitPrice, modalCtx.fallbackPrice)
    };
    if (modalCtx.cabinetId) {
      const target = r.cabinets.find(x => x.id === modalCtx.cabinetId);
      if (target) Object.assign(target, data);
    } else {
      r.cabinets.push(Object.assign({ id: uid() }, data));
    }

  } else if (t === 'preset-add') {
    const name = v('f-name');
    if (!name) return toast('请输入名称');
    const list = modalCtx.kind === 'room' ? roomPresets() : cabinetPresets();
    const g = list[modalCtx.gi];
    if (!g) return toast('分类不存在');
    if (g.items.indexOf(name) !== -1) return toast('这个分类词已经有了');
    g.items.push(name);
    save();
    closeModal();
    renderCategory();
    return;
  }

  // 「保存并继续」：连开同一个表单，继续录下一个柜子
  if (modalCtx.continueAfterSave) {
    const keep = {
      projectId: modalCtx.projectId,
      roomId: modalCtx.roomId,
      pricingType: modalCtx.pricingType || 'area',
      quantity: n0((modalCtx.draft[modalCtx.pricingType] || {}).quantity, 1),
      unitPrice: n0((modalCtx.draft[modalCtx.pricingType] || {}).unitPrice, 0)
    };
    save();
    renderProject();
    openCabinetForm(keep);
    return;
  }

  const after = modalCtx.afterSave;
  save();
  closeModal();
  render();
  if (after) after();
}

/* ============ 渲染 ============ */

let currentProjectId = null;
let activeTab = 'detail';
let lastCreatedProjectId = null;
const expandedRooms = new Set();

// 「工程信息与收款」卡片的展开状态。存在这里而不是 DOM 上，是因为 renderProject
// 每次都会把卡片内容整个重建一遍，写在 DOM 上的状态一次渲染就没了。
// 默认收起：进工程多半是来录柜子的，不该先滑过一堆设置。
let projSettingsOpen = false;

function render() {
  renderHome();
  renderProject();
}

function refreshNotices() {
  const st = document.getElementById('storage-notice');
  if (st) st.hidden = storageOk;
  const rc = document.getElementById('rescue-notice');
  if (rc) rc.hidden = !corruptRaw;

  const bk = document.getElementById('backup-notice');
  if (bk) {
    const want = shouldRemindBackup();
    bk.hidden = !want;
    if (want) document.getElementById('backup-notice-txt').textContent = backupReminderText();
  }
}

function renderHome() {
  const list = document.getElementById('home-list');
  const empty = document.getElementById('home-empty');
  if (!list) return;
  refreshNotices();

  if (!state.projects.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // 最近创建的在最前面，找工程更顺手
  const sorted = state.projects.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  list.innerHTML = sorted.map(p => {
    const final = projectFinal(p);
    const out = projectOutstanding(p);
    const locDate = [p.location, p.date].filter(Boolean).join(' · ');
    const status = projectIsSettled(p)
      ? `<span class="badge-clear">已结清</span>`
      : `<span class="badge-out">未收 ¥${fmt(out)}</span>`;
    return `
    <div class="list-item" data-action="open-project" data-id="${p.id}">
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        ${locDate ? `<div class="sub">${esc(locDate)}</div>` : ''}
        <div class="sub">${isFlat(p)
          ? projectCabCount(p) + ' 个柜子'
          : (p.rooms || []).length + ' 个房间 · ' + projectCabCount(p) + ' 个柜子'} · ${fmt(projectArea(p))} m²</div>
      </div>
      <div class="amount">
        <div class="amt-line">¥${fmt(final)}</div>
        ${status}
      </div>
    </div>`;
  }).join('');
}

function renderSummary(p) {
  const totalEl = document.getElementById('proj-total');
  const bdEl = document.getElementById('proj-breakdown');
  if (!totalEl || !bdEl) return;
  const gross = projectTotal(p);
  const discount = projectDiscount(p);
  const final = projectFinal(p);
  const paid = projectPaid(p);
  const out = projectOutstanding(p);

  totalEl.textContent = '¥' + fmt(final);
  bdEl.innerHTML = `
    <div class="bd-row"><span>原始金额</span><span class="bd-v">¥${fmt(gross)}</span></div>
    ${discount > 0 ? `<div class="bd-row"><span>优惠${p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''}</span><span class="bd-v">−¥${fmt(discount)}</span></div>` : ''}
    <div class="bd-row"><span>已收</span><span class="bd-v">¥${fmt(paid)}</span></div>
    ${out > 0
      ? `<div class="bd-row bd-out"><span>未收</span><span class="bd-v">¥${fmt(out)}</span></div>`
      : (final > 0 ? '<div class="bd-row"><span>状态</span><span class="bd-v">已结清</span></div>' : '')}`;
}

// 收起状态下的那一行摘要，让用户不展开也能看到关键信息。
// 只挑有内容的写，全空时给一句引导，避免卡片头右边空着像坏了。
function settingsSummary(p) {
  const bits = [];
  if (p.designer) bits.push(p.designer);
  if (p.discountType === 'rate' && projectDiscount(p) > 0) bits.push(discountLabel(p.discountRate));
  else if (projectDiscount(p) > 0) bits.push('已优惠 ¥' + fmt(projectDiscount(p)));

  const final = projectFinal(p);
  const out = projectOutstanding(p);
  if (final > 0 && out <= 0) bits.push('已结清');
  else if (out > 0) bits.push('未收 ¥' + fmt(out));
  else bits.push('未填金额');

  return bits.join(' · ');
}

// 折叠卡片的开合。状态存在 projSettingsOpen 里，见那个变量的注释。
function renderProjectSettings(p) {
  const head = document.querySelector('#proj-settings .card-head');
  const body = document.getElementById('proj-settings-body');
  const sub = document.getElementById('proj-settings-sub');
  if (!head || !body) return;
  head.classList.toggle('open', projSettingsOpen);
  body.hidden = !projSettingsOpen;
  if (sub) sub.textContent = settingsSummary(p);
}

function renderProject() {
  if (!currentProjectId) return;
  const p = getProject(currentProjectId);
  if (!p) { currentProjectId = null; return; }
  document.getElementById('proj-title').textContent = p.name;

  const infoEl = document.getElementById('proj-info');
  const infos = [];
  if (p.date) infos.push(['装修时间', p.date]);
  if (p.location) infos.push(['装修地点', p.location]);
  if (p.factory) infos.push(['厂房', p.factory]);
  if (p.designer) infos.push(['设计师', p.designer]);
  // 只填行，卡片外壳由 index.html 那层提供 —— 这里再包一层会变成卡片套卡片
  infoEl.innerHTML = infos.length
    ? `<div class="info-title">基础信息</div>
       ${infos.map(([k, v]) => `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${esc(v)}</span></div>`).join('')}`
    : '';

  document.getElementById('proj-meta').innerHTML =
    `<span>面积 ${fmt(projectArea(p))} m²</span>` +
    (isFlat(p) ? '' : `<span>${(p.rooms || []).length} 个房间</span>`) +
    `<span>${projectCabCount(p)} 个柜子</span>`;
  renderSummary(p);
  renderProjectSettings(p);

  const priceEl = document.getElementById('default-price');
  if (document.activeElement !== priceEl) priceEl.value = p.defaultPrice;
  const paidEl = document.getElementById('paid-amount');
  if (document.activeElement !== paidEl) paidEl.value = p.paidAmount || 0;
  document.getElementById('settled-check').checked = projectIsSettled(p);

  // 折扣 UI
  const dt = p.discountType || 'none';
  document.querySelectorAll('#discount-type-chips .chip').forEach(ch => {
    ch.classList.toggle('chip-on', ch.getAttribute('data-value') === dt);
  });
  const dInput = document.getElementById('discount-input');
  if (dt === 'rate') {
    dInput.innerHTML = `<div class="field"><label>折扣（10 = 不打折，9.5 = 95 折，也可直接填 95）</label><input id="f-discount-rate" data-field="discount-rate" type="text" inputmode="decimal" value="${discountInputValue(p.discountRate != null ? p.discountRate : 1)}"></div>`;
  } else if (dt === 'amount') {
    dInput.innerHTML = `<div class="field unit"><label>优惠金额</label><input id="f-discount-amount" data-field="discount-amount" type="number" inputmode="decimal" step="any" min="0" value="${p.discountAmount || 0}"><span>元</span></div>`;
  } else {
    dInput.innerHTML = '';
  }

  const list = document.getElementById('room-list');
  const flat = isFlat(p);

  // 两种模式要显示的按钮不一样：直列模式没有「添加房间」，
  // 房间模式每个房间自带「添加柜子」，不需要外面这个大按钮
  const addRoomBtn = document.getElementById('add-room-btn');
  const addCabBtn = document.getElementById('add-cabinet-btn');
  if (addRoomBtn) addRoomBtn.hidden = flat;
  if (addCabBtn) addCabBtn.hidden = !flat;

  if (flat) { list.innerHTML = flatListHTML(p); return; }

  if (!(p.rooms || []).length) {
    list.innerHTML = `<div class="empty" style="padding:32px 16px"><p>还没有房间，先添加「厨房」或「卧室」吧</p></div>`;
    return;
  }

  list.innerHTML = p.rooms.map(r => {
    const open = expandedRooms.has(r.id) ? 'open' : '';
    const cabs = (r.cabinets || []).map(c => cabRowHTML(r, c, true, false)).join('');
    return `
      <div class="card room ${open}" data-room-id="${r.id}">
        <div class="room-head" data-action="toggle-room" data-id="${r.id}">
          <span class="chev">▶</span>
          <span class="name">${esc(r.name || '未命名房间')}</span>
          <span class="subtotal">¥${fmt(roomSubtotal(r))}</span>
          <button class="icon-btn drag-handle" data-action="drag-handle" data-type="room" data-id="${r.id}" title="长按拖动排序">≡</button>
          <button class="icon-btn" data-action="edit-room" data-id="${r.id}">✎</button>
          <button class="icon-btn danger" data-action="delete-room" data-id="${r.id}">🗑</button>
        </div>
        <div class="room-body">
          <div class="cab-list" data-room="${r.id}">${cabs}</div>
          ${extrasBlockHTML(r, false)}
          <div class="btn-row" style="margin-top:10px;gap:8px">
            <button class="btn secondary" data-action="copy-room" data-id="${r.id}" style="font-size:14px">⧉ 复制房间</button>
            <button class="btn secondary" data-action="add-cabinet" data-id="${r.id}" style="font-size:14px">＋ 添加柜子</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

// 一行柜子。两种模式共用，保证金额、尺寸、操作的写法永远一致。
function cabRowHTML(r, c, showHandle, showTag) {
  const d = getCabinetDisplayData(c);
  const tag = (showTag && r.name) ? `<span class="tag">${esc(r.name)}</span>` : '';
  return `
    <div class="cab" data-cab-id="${c.id}">
      ${showHandle ? `<button class="icon-btn drag-handle" data-action="drag-handle" data-type="cabinet" data-id="${c.id}" title="拖动排序">≡</button>` : ''}
      <div class="info">
        <div class="cname">${tag}${esc(c.name)}</div>
        <div class="dims">${d.dimText}${c.note ? ' · ' + esc(c.note) : ''}</div>
      </div>
      <div class="money">
        <div class="amt">¥${fmt(d.amount)}</div>
        <div class="area">${d.type === 'area' ? d.areaText + ' m²' : '—'}</div>
      </div>
      <button class="icon-btn" data-action="copy-cabinet" data-id="${c.id}" data-room="${r.id}" title="复制">⧉</button>
      <button class="icon-btn" data-action="edit-cabinet" data-id="${c.id}" data-room="${r.id}">✎</button>
      <button class="icon-btn danger" data-action="delete-cabinet" data-id="${c.id}" data-room="${r.id}">🗑</button>
    </div>`;
}

/* ---------- 杂项（与柜子同级，挂在房间上） ---------- */

// 一行杂项：就地改，改了立刻存。数量/单价为 0 时显示成空框 + 占位符，
// 免得用户还要先删掉那个 0 才能输入。
function extraRowHTML(r, e, i, showTag) {
  const d = getExtraDisplayData(e);
  const tag = (showTag && r.name) ? `<span class="tag">${esc(r.name)}</span>` : '';
  const iv = v => (v ? esc(v) : '');
  const f = 'data-extra-field';
  return `
    <div class="extra-row">
      <div class="extra-name-wrap">
        ${tag}<input class="extra-name-in" type="text" ${f}="name" data-room="${r.id}" data-index="${i}"
          placeholder="杂项名称（如：灯管）" value="${esc(d.name)}" aria-label="杂项名称">
      </div>
      <input type="number" inputmode="decimal" step="any" min="0" ${f}="qty" data-room="${r.id}" data-index="${i}"
        placeholder="数量" value="${iv(d.qty)}" aria-label="数量">
      <input class="unit-in" type="text" ${f}="unit" data-room="${r.id}" data-index="${i}"
        placeholder="单位" value="${esc(d.unit)}" aria-label="单位">
      <input type="number" inputmode="decimal" step="any" min="0" ${f}="price" data-room="${r.id}" data-index="${i}"
        placeholder="单价" value="${iv(d.price)}" aria-label="单价">
      <span class="extra-amt">¥${fmt(d.amount)}</span>
      <button type="button" class="icon-btn danger" data-action="delete-extra" data-room="${r.id}" data-index="${i}" title="删除">✕</button>
    </div>`;
}

// 一个房间的杂项区。房间模式放在柜子下面；直列模式也用它，只是没有房间层级。
// showTag：直列模式下如果房里不止一个房间，得标出这一行属于哪间。
function extrasBlockHTML(r, showTag) {
  const ex = r.extras || [];
  const total = extrasTotal(r);
  return `
    <div class="extras" data-extras-room="${esc(r.id)}">
      ${showTag && r.name ? `<div class="extras-head"><span class="tag">${esc(r.name)}</span>杂项</div>` : ''}
      ${ex.map((e, i) => extraRowHTML(r, e, i, showTag)).join('')}
      <div class="chips" style="margin-top:8px">
        <button type="button" class="chip chip-add" data-action="add-extra" data-room="${r.id}">＋ 杂项</button>
        <button type="button" class="chip" data-action="add-extra" data-room="${r.id}" data-value="灯管">灯管 ¥10/个</button>
        <button type="button" class="chip" data-action="add-extra" data-room="${r.id}" data-value="指纹锁">指纹锁 /套</button>
      </div>
      ${total > 0 ? `<div class="extras-total">杂项合计 ¥${fmt(total)}</div>` : ''}
    </div>`;
}

// 刚点「＋ 杂项」加出来的空行，把光标直接放到名称框，省得还要再点一次
function focusLastExtraName(roomId) {
  const inputs = document.querySelectorAll('[data-extras-room="' + roomId + '"] input[data-extra-field="name"]');
  const target = inputs[inputs.length - 1];
  if (target && typeof target.focus === 'function') target.focus();
}

// 直列模式：不显示房间层级，所有柜子排成一个列表。
// 柜子仍然存在 rooms 里，所以汇总、账单、导出的口径和房间模式完全一样。
function flatListHTML(p) {
  const rooms = p.rooms || [];
  // 只有一个（隐藏的）容器房间时，整列可以自由拖动排序；
  // 如果是从房间模式切换过来的、有多个房间，跨房间排序没有明确含义，就不给拖。
  const single = rooms.length <= 1;
  const hasCab = rooms.some(r => (r.cabinets || []).length);
  const hasEx = rooms.some(r => (r.extras || []).length);

  // showTag 传 true：房间有名字才真的显示标签，隐藏容器房间（名字为空）自然就不显示
  const cabBlocks = rooms.map(r => {
    const cabs = (r.cabinets || []).map(c => cabRowHTML(r, c, single, true)).join('');
    return cabs ? `<div class="cab-list" data-room="${single ? esc(r.id) : ''}">${cabs}</div>` : '';
  }).join('');

  // 杂项跟柜子同级，所以排在柜子后面。
  // 只有一个容器房间时合成一块；从房间模式切过来、有多个房间时按房间分块并标出房间名。
  const exBlocks = single
    ? extrasBlockHTML(rooms[0] || { id: '', extras: [] }, true)
    : rooms.map(r => extrasBlockHTML(r, true)).join('');

  const empty = (!hasCab && !hasEx)
    ? `<div class="empty" style="padding:32px 16px"><p>还没有柜子<br>点下面「＋ 添加柜子」开始</p></div>` : '';

  return empty + `<div class="card flat-card">${cabBlocks}${exBlocks}</div>`;
}

function renderCategory() {
  const roomsEl = document.getElementById('category-rooms');
  const cabsEl = document.getElementById('category-cabinets');
  if (!roomsEl || !cabsEl) return;

  // 房间分类只在「按房间分类」的工程里用得上。全都用直列模式时整张卡片收起来，
  // 免得用户对着一个永远不出现的词表发愁。一个工程都还没有时不收（还没选过）。
  const roomCard = document.getElementById('category-rooms-card');
  if (roomCard) {
    roomCard.hidden = state.projects.length > 0 && !state.projects.some(p => !isFlat(p));
  }

  const groupHTML = (g, gi, kind) => `
    <div class="preset-group">
      <span class="preset-label">${esc(g.group)}</span>
      <div class="chips">
        ${g.items.map((it, ii) => `<span class="chip chip-edit">${esc(it)}<button type="button" class="chip-x" data-action="del-preset-item" data-kind="${kind}" data-gi="${gi}" data-ii="${ii}" title="删除">✕</button></span>`).join('')}
        <button type="button" class="chip chip-add" data-action="add-preset-item" data-kind="${kind}" data-gi="${gi}">＋</button>
      </div>
    </div>`;
  const hint = `<div class="preset-hint">这些词会出现在「添加房间 / 添加柜子」的快捷标签里，可以自己增删。</div>`;

  roomsEl.innerHTML = hint + roomPresets().map((g, gi) => groupHTML(g, gi, 'room')).join('');
  cabsEl.innerHTML = hint + cabinetPresets().map((g, gi) => groupHTML(g, gi, 'cabinet')).join('');
}

function renderMine() {
  const el = document.getElementById('mine-default-price');
  if (el) el.value = state.defaultPrice || 50;

  const tc = document.getElementById('theme-chips');
  if (tc) {
    tc.innerHTML = THEMES.map(t => `
      <button type="button" class="theme-swatch ${state.theme === t.id ? 'on' : ''}" data-action="set-theme" data-value="${t.id}" style="background:${t.primary}" title="${t.name}"></button>`).join('');
  }

  const lastEl = document.getElementById('last-backup-text');
  if (lastEl) {
    lastEl.textContent = state.lastBackupAt
      ? fmtTime(state.lastBackupAt) + '（' + Math.floor((Date.now() - state.lastBackupAt) / DAY_MS) + ' 天前）'
      : '还没有备份过';
  }

  const sizeEl = document.getElementById('data-size-text');
  if (sizeEl) {
    let bytes = 0;
    try { bytes = JSON.stringify(state).length; } catch (e) { bytes = 0; }
    sizeEl.textContent = state.projects.length + ' 个工程 · 约 ' +
      (bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
  }

  const snap = readSnapshot();
  const card = document.getElementById('snapshot-card');
  if (card) {
    card.hidden = !snap;
    if (snap) {
      document.getElementById('snapshot-text').textContent =
        fmtTime(snap.at) + '（' + (SNAP_REASON[snap.reason] || '上一次操作前') + '，' + snap.data.projects.length + ' 个工程）';
    }
  }
}

/* ============ 统计 ============ */

function computeStats() {
  const projects = state.projects;
  const totalFinal = r2(projects.reduce((s, p) => s + projectFinal(p), 0));
  const totalPaid = r2(projects.reduce((s, p) => s + Math.min(projectPaid(p), projectFinal(p)), 0));
  const totalOut = r2(projects.reduce((s, p) => s + projectOutstanding(p), 0));
  const totalArea = r4(projects.reduce((s, p) => s + projectArea(p), 0));

  const byProject = projects
    .map(p => ({ id: p.id, label: p.name, value: projectFinal(p), done: projectIsSettled(p) }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // 只统计有名字的房间。直列模式的容器房间没名字，统计进去只会多一行
  // 和「应收合计」重复的「未分类」——那种情况这张图本来也没有信息量。
  const roomMap = {};
  projects.forEach(p => (p.rooms || []).forEach(r => {
    const v = roomSubtotal(r);
    if (v > 0 && r.name) roomMap[r.name] = r2((roomMap[r.name] || 0) + v);
  }));
  const byRoom = Object.keys(roomMap)
    .map(name => ({ label: name, value: roomMap[name] }))
    .sort((a, b) => b.value - a.value);
  const roomTotal = r2(byRoom.reduce((s, x) => s + x.value, 0));

  const monthMap = {};
  projects.forEach(p => {
    const key = String(p.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) return;
    monthMap[key] = r2((monthMap[key] || 0) + projectFinal(p));
  });
  const months = Object.keys(monthMap).sort().slice(-12).map(k => ({ key: k, value: monthMap[k] }));

  // 柜子 / 杂项按「名字」归并。直列模式没有房间层级，按名字排行才是
  // 能回答"我这一年到底在做什么"的那张榜。
  const cabMap = {}, exMap = {};
  let totalCabs = 0, totalExtras = 0;
  projects.forEach(p => {
    totalCabs += projectCabCount(p);
    (p.rooms || []).forEach(r => {
      (r.cabinets || []).forEach(c => {
        const name = trimStr(c.name);
        if (!name) return;
        const hit = cabMap[name] || (cabMap[name] = { count: 0, value: 0 });
        hit.count++;
        hit.value += cabinetAmount(c);
      });
      (r.extras || []).forEach(e => {
        const name = trimStr(e.name);
        if (!name) return;
        totalExtras++;
        const hit = exMap[name] || (exMap[name] = { count: 0, value: 0 });
        hit.count++;
        hit.value += extraAmount(e);
      });
    });
  });
  const toRank = map => Object.keys(map)
    .map(label => ({ label: label, count: map[label].count, value: r2(map[label].value) }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const byCabinet = toRank(cabMap);
  const byExtra = toRank(exMap);

  // 高光时刻用的几个"最"：金额最大的一单、做得最多的柜子、
  // 最忙的一个月、以及这个账本是从哪天开始记的
  const biggest = byProject[0] || null;
  const favorite = byCabinet.slice().sort((a, b) => b.count - a.count)[0] || null;
  const peak = months.length
    ? months.reduce((a, b) => (b.value > a.value ? b : a), months[0]) : null;
  const stamps = projects.map(p => p.createdAt).filter(t => typeof t === 'number' && t > 0);
  const earliestDate = stamps.length ? billDate(new Date(Math.min.apply(null, stamps))) : null;

  return {
    count: projects.length, totalFinal, totalPaid, totalOut, totalArea,
    byProject, byRoom, roomTotal, months,
    hasFlat: projects.some(isFlat),
    hasRoom: projects.some(p => !isFlat(p)),
    byCabinet, byExtra, totalCabs, totalExtras,
    settledCount: projects.filter(projectIsSettled).length,
    biggest, favorite, peak, earliestDate
  };
}

// 横向排行：一个系列 → 所有柱子同一个颜色（主题色），
// 不做"越大越深"的色阶（那是把长度重复编码成颜色）。
function rankSection(title, rows, base, note) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(r => r.value)) || 1;
  const total = base || rows.reduce((s, r) => s + r.value, 0);
  const shown = rows.slice(0, 10);
  const body = shown.map(r => {
    const pct = total > 0 ? (r.value / total * 100) : 0;
    const w = Math.max(2, Math.round(r.value / max * 100));
    return `
      <div class="rank-row" title="${esc(r.label)} ¥${fmt(r.value)}">
        <div class="rank-name">${esc(r.label)}</div>
        <div class="rank-meter"><div class="rank-fill" style="width:${w}%"></div></div>
        <div class="rank-value">¥${fmt(r.value)}<span class="rank-pct">${pct.toFixed(pct >= 10 ? 0 : 1)}%</span></div>
      </div>`;
  }).join('');
  const more = rows.length > shown.length
    ? `<div class="rank-more">仅显示前 ${shown.length} 项，共 ${rows.length} 项</div>` : '';
  return `
    <div class="card"><div class="card-body">
      <h3>${title}</h3>
      ${note ? `<div class="chart-note">${note}</div>` : ''}
      <div class="rank-list">${body}</div>${more}
    </div></div>`;
}

function monthSection(months) {
  if (!months.length) return '';
  const max = Math.max(...months.map(m => m.value)) || 1;
  const peakKey = months.reduce((a, b) => (b.value > a.value ? b : a), months[0]).key;
  const lastKey = months[months.length - 1].key;

  const cols = months.map(m => {
    const h = Math.max(2, Math.round(m.value / max * 100));
    // 只在"最高"和"最新"两根柱子上标数字，其余交给轴标签和下面的明细表
    const showValue = m.key === peakKey || m.key === lastKey;
    return `
      <div class="trend-col" title="${m.key} ¥${fmt(m.value)}">
        <div class="trend-amt">${showValue ? compactMoney(m.value) : ''}</div>
        <div class="trend-track"><div class="trend-fill" style="height:${h}%"></div></div>
        <div class="trend-label">${m.key.slice(5)}月</div>
      </div>`;
  }).join('');

  const table = months.slice().reverse().map(m =>
    `<tr><td>${m.key}</td><td class="num">¥${fmt(m.value)}</td></tr>`).join('');

  return `
    <div class="card"><div class="card-body">
      <h3>月度应收</h3>
      <div class="chart-note">按「装修时间」归月，没填日期的工程就不好意思上榜了</div>
      <div class="trend">${cols}</div>
      <details class="table-toggle">
        <summary>查看每月明细</summary>
        <table class="mini-table"><tbody>${table}</tbody></table>
      </details>
    </div></div>`;
}

// 一块成就牌：一个 emoji、一个数字、一句俏皮话
function achieveTile(emoji, value, unit, caption) {
  return `
    <div class="achieve-tile">
      <div class="ach-emoji">${emoji}</div>
      <div class="ach-value">${value}${unit ? `<span class="ach-unit">${unit}</span>` : ''}</div>
      <div class="ach-cap">${caption}</div>
    </div>`;
}

// 高光时刻里的一行。icon + 一句话，数字用 <b> 挑出来。
function superRow(emoji, text) {
  return `<div class="super-row"><span class="super-ico">${emoji}</span><span>${text}</span></div>`;
}

function renderStats() {
  const el = document.getElementById('stats-body');
  if (!el) return;
  const s = computeStats();

  if (!s.count) {
    el.innerHTML = `<div class="empty"><div class="big">📊</div><p>还没有数据<br>先「记一笔」，你的战绩还等着你来书写 ✍️</p></div>`;
    return;
  }

  const outRatio = s.totalFinal > 0 ? Math.round(s.totalPaid / s.totalFinal * 100) : 0;

  // ——— 成就牌：财务之外的"点点滴滴" ———
  const tiles = [
    achieveTile('📋', s.count, '单', '一单一单，都是心血'),
    achieveTile('🗄', s.totalCabs, '个', '手都画酸了吧'),
    achieveTile('📐', fmt(s.totalArea), 'm²', '量过的家，比想象中多'),
    achieveTile('✅', s.settledCount, '单', '已结清，落袋为安')
  ];
  if (s.totalExtras > 0) tiles.push(achieveTile('🧩', s.totalExtras, '件', '灯管锁具，一个不落'));

  // ——— 高光时刻：逐条判空，没有的就不写 ———
  const supers = [];
  if (s.biggest) {
    supers.push(superRow('🏆', `最大的一单是「<b>${esc(s.biggest.label)}</b>」，一单就 <b>¥${fmt(s.biggest.value)}</b>`));
  }
  if (s.favorite) {
    supers.push(superRow('🌟', `王牌柜子「<b>${esc(s.favorite.label)}</b>」，一共做了 <b>${s.favorite.count}</b> 次`));
  }
  if (s.peak) {
    supers.push(superRow('📅', `最忙的一个月是 <b>${parseInt(s.peak.key.slice(5), 10)} 月</b>，一口气 <b>¥${fmt(s.peak.value)}</b>`));
  }
  if (s.earliestDate) {
    supers.push(superRow('🎬', `故事从 <b>${s.earliestDate}</b> 开始`));
  }
  const superCard = supers.length ? `
    <div class="card"><div class="card-body">
      <h3>高光时刻 ✨</h3>
      <div class="super-list">${supers.join('')}</div>
    </div></div>` : '';

  // 柜子排行是直列模式下的主榜，label 里带上次数，"当家花旦"才看得出来
  const cabTotal = r2(s.byCabinet.reduce((t, x) => t + x.value, 0));
  const cabRank = rankSection('柜子排行 · 谁是你的当家花旦',
    s.byCabinet.map(x => ({ label: x.label + '（' + x.count + ' 次）', value: x.value })), cabTotal);
  const exRank = rankSection('杂项排行 · 小配件的大功劳',
    s.byExtra.map(x => ({ label: x.label + '（' + x.count + ' 件）', value: x.value })));

  el.innerHTML = `
    <div class="summary">
      <div class="hero-kicker">📖 你和柜子的故事</div>
      <div class="label">应收合计（全部时间）</div>
      <div class="total">¥${fmt(s.totalFinal)}</div>
      <div class="meta">
        <span>${s.count} 个工程</span><span>${s.totalCabs} 个柜子</span><span>面积 ${fmt(s.totalArea)} m²</span>
      </div>
      <div class="breakdown">
        <div class="bd-row"><span>已收（${outRatio}%）</span><span class="bd-v">¥${fmt(s.totalPaid)}</span></div>
        <div class="bd-row ${s.totalOut > 0 ? 'bd-out' : ''}"><span>未收</span><span class="bd-v">¥${fmt(s.totalOut)}</span></div>
      </div>
      <div class="hero-cheer">${s.totalOut > 0
        ? `还有 ¥${fmt(s.totalOut)} 在外流浪，记得催款哦 💌`
        : '全部回款，完美收工 🎉'}</div>
    </div>

    <div class="achieve-grid">${tiles.join('')}</div>

    ${superCard}
    ${cabRank}
    ${exRank}
    ${rankSection('工程金额排行', s.byProject, s.totalFinal)}
    ${s.hasRoom ? rankSection('房间金额分布', s.byRoom, s.roomTotal,
      s.hasFlat ? '仅统计按房间录入的工程，直列录入的柜子不计入房间分类' : '') : ''}
    ${monthSection(s.months)}

    <div class="annual-foot">每一块板子都算数，每一单都值得。辛苦了 ✨</div>`;
}

/* ============ 账单导出 ============ */

function buildBill(p) {
  const lines = [];
  lines.push('【' + p.name + ' · 橱柜对账单】');
  if (p.date) lines.push('装修时间：' + p.date);
  if (p.location) lines.push('装修地点：' + p.location);
  if (p.factory) lines.push('厂　　房：' + p.factory);
  if (p.designer) lines.push('设 计 师：' + p.designer);
  lines.push('------------------------------');
  (p.rooms || []).forEach(r => {
    // 直列模式下的容器房间没有名字，就不打这一行分组标题
    if (r.name) lines.push('▍' + r.name + '（小计 ¥' + fmt(roomSubtotal(r)) + '）');
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      let s = '  ' + c.name + '：' + d.dimText;
      if (d.type === 'area') s += ' = ' + d.areaText + 'm² ×¥' + d.priceText + '/' + d.priceBasis + ' = ¥' + fmt(d.base);
      else if (d.type === 'linear' || d.type === 'unit') s += ' ×¥' + d.priceText + '/' + d.priceBasis + ' = ¥' + fmt(d.base);
      else s += ' = ¥' + fmt(d.base);
      if (c.note) s += '（' + c.note + '）';
      lines.push(s);
    });
    // 杂项与柜子同级，紧跟在柜子后面，缩进也一致
    (r.extras || []).forEach(e => {
      const x = getExtraDisplayData(e);
      if (!x.name) return;
      lines.push('  ' + x.name + '：×' + fmt(x.qty) + ' ' + x.unit + ' ×¥' + fmt(x.price) + ' = ¥' + fmt(x.amount));
    });
  });
  lines.push('------------------------------');
  lines.push('总面积：' + fmt(projectArea(p)) + ' m²');
  lines.push('原始金额：¥' + fmt(projectTotal(p)));
  const dsc = projectDiscount(p);
  if (dsc > 0) lines.push('优惠：−¥' + fmt(dsc) + (p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''));
  lines.push('应收金额：¥' + fmt(projectFinal(p)));
  lines.push('已收：¥' + fmt(projectPaid(p)));
  lines.push('未收：¥' + fmt(projectOutstanding(p)));
  return lines.join('\n');
}

// PDF 与「打印/存PDF」共用的 HTML
function buildPrintHTML(p) {
  const pc = priceColumn(p);
  const qc = qtyColumn(p);
  let rows = '';
  let info = '';
  if (p.date) info += `<div>装修时间：${esc(p.date)}</div>`;
  if (p.location) info += `<div>装修地点：${esc(p.location)}</div>`;
  if (p.factory) info += `<div>厂房：${esc(p.factory)}</div>`;
  if (p.designer) info += `<div>设计师：${esc(p.designer)}</div>`;

  (p.rooms || []).forEach(r => {
    if (r.name) rows += `<tr class="room-row"><td colspan="6">${esc(r.name)}</td></tr>`;
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      rows += `<tr>
        <td>${esc(c.name)}${c.note ? '（' + esc(c.note) + '）' : ''}</td>
        <td>${esc(d.specText)}</td>
        <td>${d.type === 'fixed' ? '—' : fmt(d.qty)}</td>
        <td>${esc(d.areaText)}</td>
        <td>${esc(d.priceText)}${pc.perRow && d.priceBasis ? `<span class="unit">元/${esc(d.priceBasis)}</span>` : ''}</td>
        <td>${fmt(d.base)}</td>
      </tr>`;
    });
    // 杂项与柜子同级：不缩进、单独一行，用浅色跟柜子区分开
    (r.extras || []).forEach(e => {
      const x = getExtraDisplayData(e);
      if (!x.name) return;
      rows += `<tr class="extra-tr">
        <td>${esc(x.name)}</td>
        <td></td>
        <td>${fmt(x.qty)}</td>
        <td></td>
        <td>${esc(fmt(x.price))}<span class="unit">元/${esc(x.unit)}</span></td>
        <td>${fmt(x.amount)}</td>
      </tr>`;
    });
  });

  // 末尾只落一个「应收金额」。已收 / 未收是自己跟客户的账，写在给客户的对账单上
  // 就成了催款单 —— 收款情况在工程页和「我的」里看，这张单子只回答「一共多少钱」。
  const dsc = projectDiscount(p);
  return `
    <h1>橱柜对账单</h1>
    <div class="print-meta">工程：${esc(p.name)}　·　日期：${billDate()}</div>
    ${info ? '<div class="print-info">' + info + '</div>' : ''}
    <table>
      <thead>
        <tr><th>名称</th><th>规格(m×m)</th><th>${qc}</th><th>面积(m²)</th><th>${pc.header}</th><th>金额(元)</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="3">合计</td>
          <td>${fmt(projectArea(p))}</td>
          <td></td>
          <td>${fmt(projectTotal(p))}</td>
        </tr>
        ${dsc > 0 ? `<tr><td colspan="5">优惠${p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''}</td><td>−${fmt(dsc)}</td></tr>` : ''}
        <tr class="final-row"><td colspan="5">应收金额</td><td>${fmt(projectFinal(p))}</td></tr>
      </tbody>
    </table>`;
}

/* ---------- 脚本加载（失败后可重试） ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-lib="' + src + '"]');
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('加载失败')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.setAttribute('data-lib', src);
    s.onload = () => { s.setAttribute('data-loaded', '1'); resolve(); };
    s.onerror = () => { s.remove(); reject(new Error('加载失败')); };  // 移除失败节点，下次还能重试
    document.head.appendChild(s);
  });
}

async function ensureLib(urls, what) {
  const results = await Promise.all(urls.map(u => loadScript(u).then(() => true, () => false)));
  if (results.indexOf(false) !== -1) {
    toast(what + '组件加载失败，请检查网络后重试');
    return false;
  }
  return true;
}

/* ---------- 导出 PDF ---------- */

async function exportPdf(p) {
  if (!await ensureLib([CDN_JSPDF, CDN_HTML2CANVAS], 'PDF')) return;
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  const html2canvas = window.html2canvas;
  if (!jsPDF || !html2canvas) { toast('PDF 组件加载失败，请检查网络后重试'); return; }

  const src = document.getElementById('pdf-src');
  src.innerHTML = buildPrintHTML(p);
  toast('正在生成 PDF…');

  try {
    // 账单很长时自动降清晰度：倍率再往上，上亿像素会把手机/浏览器直接拖崩
    const cssW = src.scrollWidth || 1000;
    const cssH = src.scrollHeight || 1;
    let scale = PDF_RENDER_SCALE;
    const budget = Math.sqrt(PDF_MAX_PIXELS / (cssW * cssH));
    if (budget < scale) {
      scale = Math.max(1.5, budget);
      toast('账单较长，已自动降低清晰度以保证生成成功');
    }

    const canvas = await html2canvas(src, { scale: scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const pdf = new jsPDF('l', 'mm', 'a4');
    const margin = 10;
    const contentW = 297 - margin * 2;
    const contentH = 210 - margin * 2;
    const pxPerMm = canvas.width / contentW;
    const pagePx = contentH * pxPerMm;

    // 量出每个表格行的上边界，作为允许断页的位置（按行断页，不截断行）
    const srcTop = src.getBoundingClientRect().top;
    const rowTops = Array.from(src.querySelectorAll('tr'))
      .map(tr => (tr.getBoundingClientRect().top - srcTop) * scale)
      .filter(y => y > 0)
      .sort((a, b) => a - b);
    const breaks = [0].concat(rowTops, [canvas.height]);

    const slices = [];
    let start = 0;
    let guard = 0;
    while (start < canvas.height && guard++ < 2000) {
      const ideal = start + pagePx;
      const candidates = breaks.filter(b => b > start && b <= ideal);
      let end = candidates.length ? candidates[candidates.length - 1] : Math.min(ideal, canvas.height);
      if (end <= start) end = Math.min(ideal, canvas.height);
      slices.push({ start: start, end: end });
      start = end;
    }

    slices.forEach((s, i) => {
      const sh = s.end - s.start;
      if (sh <= 0) return;
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sh;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      ctx.drawImage(canvas, 0, s.start, canvas.width, sh, 0, 0, canvas.width, sh);
      // 一页白底黑字的表格，PNG 无损但抗锯齿文字的熵很高，压不下去；JPEG 通常能小好几倍。
      // 但短账单大片留白时反而是 PNG 更小，所以不写死格式，逐页比一下谁小用谁 ——
      // 这样既拿到压缩，又保证任何一页都不会比原来更大。
      const png = pageCanvas.toDataURL('image/png');
      const jpeg = pageCanvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
      const useJpeg = jpeg.length < png.length;
      if (i > 0) pdf.addPage();
      pdf.addImage(useJpeg ? jpeg : png, useJpeg ? 'JPEG' : 'PNG',
        margin, margin, contentW, sh / pxPerMm);
      // 及时释放，长账单下这几张位图很吃内存
      pageCanvas.width = 0;
      pageCanvas.height = 0;
    });

    pdf.save('橱柜对账单-' + p.name + '.pdf');
    toast('PDF 已生成');
  } catch (err) {
    toast('生成 PDF 失败：' + ((err && err.message) || '未知错误'));
  } finally {
    src.innerHTML = '';
  }
}

/* ---------- 打印 / 存为 PDF（矢量、可选中文字） ---------- */

function printBill(p) {
  const src = document.getElementById('pdf-src');
  src.innerHTML = buildPrintHTML(p);
  document.body.classList.add('printing');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('printing');
    window.removeEventListener('afterprint', cleanup);
    src.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup);
  // 部分浏览器（iOS Safari）不派发 afterprint，用焦点回来自行收尾
  window.addEventListener('focus', () => setTimeout(cleanup, 500), { once: true });
  setTimeout(cleanup, 120000);   // 兜底
  setTimeout(() => window.print(), 60);
}

/* ---------- 导出 Excel ---------- */

// 以 = + - @ 开头的内容会被 Excel 当公式执行，加个前缀撇号挡掉
function xlsSafe(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// 单价这一列的单位怎么标。柜子的计价基准随计价方式变（面积是元/m²、延米是元/m、按件是元/个）：
//   - 全表的柜子都是一种计价方式（绝大多数工程都是这样）→ 写进表头，格子里的数字保持干净
//   - 混着用好几种（一个工程里既有地柜又有台面）→ 表头只写「元」，基准标到每一行上，
//     免得表头对其中某些行说谎
// 杂项不参与这个判断：灯管按个、指纹锁按套，那是它自带的单位，一直跟在行里。
// PDF 和 Excel 共用这一份判断，两个导出口径就不会打架。
function priceColumn(p) {
  const bases = new Set();
  (p.rooms || []).forEach(r => (r.cabinets || []).forEach(c => {
    const b = getCabinetDisplayData(c).priceBasis;
    if (b) bases.add(b);
  }));
  if (bases.size === 1) return { header: '单价(元/' + bases.values().next().value + ')', perRow: false };
  return { header: '单价(元)', perRow: bases.size > 1 };
}

// 数量这一列的单位。柜子一律按「个」数，杂项用它自己的单位（灯管按个、指纹锁按套）。
// 把表里实际出现过的单位都写进表头，格子里就只留纯数字，不用每行重复一遍。
// 用户自己的数据是「个 + 套」，表头就正好是「数量(个/套)」；哪天杂项改成按米算，
// 表头会跟着变成「数量(个/米)」，不会出现格子里是个没有说法的数字。
function qtyColumn(p) {
  const units = [];
  const add = u => { if (u && units.indexOf(u) === -1) units.push(u); };
  (p.rooms || []).forEach(r => {
    // 固定金额的柜子不分数量，那一行写「—」，所以不把「个」算进来
    (r.cabinets || []).forEach(c => { if (cabinetPricingType(c) !== 'fixed') add('个'); });
    (r.extras || []).forEach(e => add(trimStr(e.unit) || '个'));
  });
  return '数量(' + (units.length ? units.join('/') : '个') + ')';
}

function buildExcelData(p) {
  const aoa = [];
  const merges = [];
  const cols = 6;
  const mergeRow = r => merges.push({ s: { r: r, c: 0 }, e: { r: r, c: cols - 1 } });
  const mergeLabel = r => merges.push({ s: { r: r, c: 0 }, e: { r: r, c: cols - 2 } });

  aoa.push(['橱柜对账单']);
  mergeRow(0);
  aoa.push(['工程：' + p.name + '　·　日期：' + billDate()]);
  mergeRow(1);
  if (p.date) { aoa.push(['装修时间：' + p.date]); mergeRow(aoa.length - 1); }
  if (p.location) { aoa.push(['装修地点：' + p.location]); mergeRow(aoa.length - 1); }
  if (p.factory) { aoa.push(['厂房：' + p.factory]); mergeRow(aoa.length - 1); }
  if (p.designer) { aoa.push(['设计师：' + p.designer]); mergeRow(aoa.length - 1); }
  aoa.push(['名称', '规格(m×m)', qtyColumn(p), '面积(m²)', priceColumn(p).header, '金额(元)']);

  (p.rooms || []).forEach(r => {
    if (r.name) {
      aoa.push([r.name]);
      mergeRow(aoa.length - 1);
    }
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      aoa.push([
        xlsSafe(c.name + (c.note ? '（' + c.note + '）' : '')),
        d.specText,
        d.type === 'fixed' ? '' : r2(d.qty),
        d.type === 'area' ? r2(d.area) : '',
        d.type === 'fixed' ? '' : r2(d.price),
        r2(d.base)
      ]);
    });
    // 杂项与柜子同级，跟柜子排在同一层
    (r.extras || []).forEach(e => {
      const x = getExtraDisplayData(e);
      if (!x.name) return;
      aoa.push([xlsSafe(x.name), '', r2(x.qty), '', r2(x.price), r2(x.amount)]);
    });
  });

  aoa.push(['合计', '', '', r2(projectArea(p)), '', r2(projectTotal(p))]);
  merges.push({ s: { r: aoa.length - 1, c: 0 }, e: { r: aoa.length - 1, c: 2 } });

  const dsc = projectDiscount(p);
  if (dsc > 0) {
    aoa.push(['优惠' + (p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''), '', '', '', '', r2(dsc)]);
    mergeLabel(aoa.length - 1);
  }
  aoa.push(['应收金额', '', '', '', '', r2(projectFinal(p))]); mergeLabel(aoa.length - 1);
  aoa.push(['已收', '', '', '', '', r2(projectPaid(p))]); mergeLabel(aoa.length - 1);
  aoa.push(['未收', '', '', '', '', r2(projectOutstanding(p))]); mergeLabel(aoa.length - 1);

  return { aoa: aoa, merges: merges };
}

async function exportExcel(p) {
  if (!await ensureLib([CDN_XLSX], 'Excel')) return;
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel 组件加载失败，请检查网络后重试'); return; }
  toast('正在生成 Excel…');
  try {
    const { aoa, merges } = buildExcelData(p);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '对账单');
    XLSX.writeFile(wb, '橱柜对账单-' + p.name + '.xlsx');
    toast('Excel 已生成');
  } catch (err) {
    toast('生成 Excel 失败：' + ((err && err.message) || '未知错误'));
  }
}

/* ---------- 复制文本 ---------- */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}

/* ============ 交互 ============ */

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function highlightTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab));
}

function switchTab(tab) {
  highlightTab(tab);
  if (tab === 'detail') {
    if (currentProjectId) showPage('page-project');
    else { renderHome(); showPage('page-home'); }
  } else if (tab === 'category') {
    renderCategory();
    showPage('page-category');
  } else if (tab === 'stats') {
    renderStats();
    showPage('page-stats');
  } else if (tab === 'mine') {
    renderMine();
    showPage('page-mine');
  }
}

// 清空 / 导入之后必须把视图拉回首页 —— 否则用户会对着一个已经不存在的工程详情页
function resetView() {
  expandedRooms.clear();
  currentProjectId = null;
  lastCreatedProjectId = null;
  projSettingsOpen = false;
  activeTab = 'detail';
  highlightTab('detail');
  renderHome();
  renderProject();
  renderMine();
  refreshNotices();
  showPage('page-home');
}

// 开关只是「把已收填成应收」的快捷方式，不单独记状态。
// 所以每次操作的结果都直接体现在「已收」输入框里，看得见、也能改回去。
function setSettled(p, on) {
  const due = projectFinal(p);
  if (on) {
    if (due <= 0) { toast('这个工程应收是 ¥0，先添加柜子吧'); return false; }
    p.paidAmount = due;
    toast('已结清，已收金额回填为 ¥' + fmt(due));
  } else {
    p.paidAmount = 0;
    toast('已取消结清，已收金额清零');
  }
  return true;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.getAttribute('data-action');
  const id = el.getAttribute('data-id');

  // 「⋯」菜单里的项：先收菜单再干活，否则删除工程这种带确认框的会两层叠在一起。
  // 放在这里统一处理，就不用每个 case 自己记得关。
  if (el.getAttribute('data-close-modal')) closeModal();

  switch (action) {
    case 'new-project': openNewOrder(); break;

    // 顶栏「⋯」：导出这类低频操作用一次就走，收进菜单里，别占着录柜子的版面
    case 'more-menu': {
      openSheet(`
        <h2>${esc((getProject(currentProjectId) || {}).name || '工程')}</h2>
        <div class="menu">
          <button class="menu-item" data-action="copy-bill" data-close-modal="1"><span class="menu-icon">⧉</span>复制账单</button>
          <button class="menu-item" data-action="print-bill" data-close-modal="1"><span class="menu-icon">🖨</span>打印 / 存 PDF</button>
          <button class="menu-item" data-action="export-pdf" data-close-modal="1"><span class="menu-icon">📄</span>导出 PDF</button>
          <button class="menu-item" data-action="export-excel" data-close-modal="1"><span class="menu-icon">📊</span>导出 Excel</button>
          <div class="menu-divider"></div>
          <button class="menu-item danger" data-action="delete-project" data-close-modal="1"><span class="menu-icon">🗑</span>删除工程</button>
        </div>`);
      break;
    }

    case 'toggle-project-settings':
      projSettingsOpen = !projSettingsOpen;
      renderProject();
      break;

    case 'open-project':
      currentProjectId = id;
      expandedRooms.clear();
      projSettingsOpen = false;   // 每次进工程都从收起开始
      showPage('page-project');
      renderProject();
      break;

    case 'back-home':
      currentProjectId = null;
      renderHome();
      showPage('page-home');
      break;

    case 'edit-project': openModal('project', { projectId: currentProjectId }); break;

    case 'delete-project': {
      const p = getProject(currentProjectId);
      if (!p) break;
      if (confirm('确定删除工程「' + p.name + '」？\n\n删除前的数据会留一份在「我的 → 后悔药」里，可随时恢复。')) {
        snapshotCurrent('before-delete');
        state.projects = state.projects.filter(x => x.id !== currentProjectId);
        save();
        currentProjectId = null;
        renderHome();
        renderMine();
        showPage('page-home');
      }
      break;
    }

    case 'set-discount': {
      const p = getProject(currentProjectId);
      if (!p) break;
      p.discountType = el.getAttribute('data-value');
      save();
      renderProject();
      break;
    }

    case 'set-theme': {
      state.theme = el.getAttribute('data-value');
      save();
      applyTheme(state.theme);
      renderMine();
      break;
    }

    case 'add-room': openModal('room', { projectId: currentProjectId }); break;
    case 'edit-room': openModal('room', { projectId: currentProjectId, roomId: id }); break;

    case 'delete-room': {
      const p = getProject(currentProjectId);
      const r = p && (p.rooms || []).find(x => x.id === id);
      if (!r) break;
      if (confirm('确定删除房间「' + r.name + '」及其所有柜子？')) {
        p.rooms = p.rooms.filter(x => x.id !== id);
        expandedRooms.delete(id);
        save();
        renderProject();
      }
      break;
    }

    case 'toggle-room': {
      if (expandedRooms.has(id)) expandedRooms.delete(id); else expandedRooms.add(id);
      const card = el.closest('.room');
      if (card) card.classList.toggle('open', expandedRooms.has(id));
      break;
    }

    // 直列模式没有房间可选，「添加柜子」直接落到那个隐藏的容器房间里
    case 'add-cabinet': {
      const p = getProject(currentProjectId);
      if (!p) break;
      const room = isFlat(p) ? flatRoom(p, true) : (p.rooms || []).find(x => x.id === id);
      if (!room) break;
      openModal('cabinet', { projectId: p.id, roomId: room.id });
      break;
    }
    case 'edit-cabinet': openModal('cabinet', { projectId: currentProjectId, roomId: el.getAttribute('data-room'), cabinetId: id }); break;

    case 'delete-cabinet': {
      const p = getProject(currentProjectId);
      const r = p && (p.rooms || []).find(x => x.id === el.getAttribute('data-room'));
      const c = r && (r.cabinets || []).find(x => x.id === id);
      if (!c) break;
      if (confirm('确定删除柜子「' + c.name + '」？')) {
        r.cabinets = r.cabinets.filter(x => x.id !== id);
        save();
        renderProject();
      }
      break;
    }

    case 'copy-cabinet': {
      const p = getProject(currentProjectId);
      const r = p && (p.rooms || []).find(x => x.id === el.getAttribute('data-room'));
      const c = r && (r.cabinets || []).find(x => x.id === id);
      if (!c) break;
      const clone = JSON.parse(JSON.stringify(c));
      clone.id = uid();
      clone.name = c.name + '（副本）';
      r.cabinets.push(clone);
      save();
      renderProject();
      toast('已复制到本房间');
      break;
    }

    case 'copy-room': {
      const p = getProject(currentProjectId);
      const r = p && (p.rooms || []).find(x => x.id === id);
      if (!r) break;
      const clone = JSON.parse(JSON.stringify(r));
      clone.id = uid();
      clone.name = r.name + '（副本）';
      (clone.cabinets || []).forEach(c => { c.id = uid(); });
      p.rooms.push(clone);
      save();
      renderProject();
      toast('已复制房间');
      break;
    }

    case 'copy-bill': {
      const p = getProject(currentProjectId);
      if (!p) break;
      const ok = await copyText(buildBill(p));
      toast(ok ? '账单已复制，可粘贴发送' : '复制失败，请改用「导出PDF」');
      break;
    }

    case 'print-bill': {
      const p = getProject(currentProjectId);
      if (p) printBill(p);
      break;
    }

    case 'export-pdf': {
      const p = getProject(currentProjectId);
      if (p) exportPdf(p);
      break;
    }

    case 'export-excel': {
      const p = getProject(currentProjectId);
      if (p) exportExcel(p);
      break;
    }

    /* ---------- 我的 ---------- */

    case 'backup-now': exportBackup(); break;

    case 'backup-snooze':
      state.backupSnoozeUntil = Date.now() + DAY_MS;
      save();
      refreshNotices();
      toast('好的，明天再提醒');
      break;

    case 'download-rescue': {
      if (!corruptRaw) { toast('没有需要下载的数据'); break; }
      downloadBlob('橱柜对账-损坏数据-' + billDate() + '.json', corruptRaw);
      break;
    }

    case 'export-data': exportBackup(); break;
    case 'import-data': document.getElementById('import-file').click(); break;

    case 'restore-snapshot': {
      const snap = readSnapshot();
      if (!snap) { toast('没有可恢复的备份'); break; }
      if (!confirm('将用「' + fmtTime(snap.at) + '」（' + (SNAP_REASON[snap.reason] || '上一次操作前') +
        '）的数据替换当前数据。\n\n当前数据会先存一份，恢复错了还能再换回来。确定继续？')) break;
      snapshotCurrent('before-restore');
      state = normalizeState(snap.data);
      initPresets();
      sanitizeTheme();
      save();
      resetView();
      toast('已恢复到 ' + fmtTime(snap.at));
      break;
    }

    case 'clear-data': {
      if (state.projects.length && !confirm('确定清空全部数据？共 ' + state.projects.length + ' 个工程。\n\n清空前的数据会留一份在「后悔药」里，可随时恢复。')) break;
      if (!state.projects.length && !confirm('当前没有数据，仍要重置全部设置吗？')) break;
      snapshotCurrent('before-clear');
      state = defaultState();
      initPresets();
      sanitizeTheme();
      applyTheme(state.theme);
      save();
      resetView();
      toast('已清空');
      break;
    }

    /* ---------- 弹窗内 ---------- */

    case 'modal-cancel': closeModal(); break;
    case 'modal-save': saveModal(); break;

    case 'modal-save-continue':
      modalCtx.continueAfterSave = true;
      saveModal();
      break;

    case 'preset-fill': {
      const input = document.getElementById(el.getAttribute('data-target'));
      if (input) { input.value = el.getAttribute('data-value'); input.focus(); }
      break;
    }

    // 只更新这两个格子，不重渲染整个表单 —— 否则用户已经填好的名称/地址会被清掉
    case 'set-mode': {
      const mode = el.getAttribute('data-value');
      if (MODES.indexOf(mode) === -1) break;
      modalCtx.mode = mode;
      const box = document.getElementById('mode-chips');
      if (box) box.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('chip-on', c.getAttribute('data-value') === mode);
      });
      const hint = document.getElementById('mode-hint');
      if (hint) hint.textContent = MODE_HINT[mode];
      break;
    }

    case 'set-pricing': {
      capturePricingFields();         // 先把当前填的值收进草稿，否则切换就会丢
      modalCtx.pricingType = el.getAttribute('data-value');
      renderPricingSection();
      break;
    }

    // 杂项与柜子同级：直接加到房间里，不再走柜子表单
    case 'add-extra': {
      const p = getProject(currentProjectId);
      if (!p) break;
      let r = (p.rooms || []).find(x => x.id === el.getAttribute('data-room'));
      // 直列模式下一个房间都还没建时，按需建那个隐藏的容器房间
      if (!r && isFlat(p)) r = flatRoom(p, true);
      if (!r) break;
      if (!Array.isArray(r.extras)) r.extras = [];
      const nm = el.getAttribute('data-value') || '';
      // 数据里一律存数字（0 就是"还没填"），显示时再把 0 渲染成空框。
      // 点「＋ 杂项」加出来的空行三项全空，失焦时会被收掉。
      r.extras.push({
        name: nm,
        qty: nm ? 1 : 0,
        unit: nm === '指纹锁' ? '套' : '个',
        price: nm === '灯管' ? 10 : 0
      });
      save();
      renderProject();
      if (!nm) focusLastExtraName(r.id);
      break;
    }

    case 'delete-extra': {
      const p = getProject(currentProjectId);
      const r = p && (p.rooms || []).find(x => x.id === el.getAttribute('data-room'));
      const idx = parseInt(el.getAttribute('data-index'), 10);
      if (!r || !Array.isArray(r.extras) || isNaN(idx)) break;
      r.extras.splice(idx, 1);
      save();
      renderProject();
      break;
    }

    case 'switch-tab': {
      const tab = el.getAttribute('data-tab');
      // 已经在「账单」页里再点一次「账单」＝ 返回首页
      if (tab === 'detail' && activeTab === 'detail' && currentProjectId) currentProjectId = null;
      switchTab(tab);
      break;
    }

    case 'record': openNewOrder(); break;

    case 'add-preset-item': {
      modalCtx = { type: 'preset-add', kind: el.getAttribute('data-kind'), gi: parseInt(el.getAttribute('data-gi'), 10) };
      openSheet(`
        <h2>添加${modalCtx.kind === 'room' ? '房间' : '柜子'}分类词</h2>
        <div class="field"><label>名称</label><input id="f-name" placeholder="请输入名称"></div>
        <div class="btn-row">
          <button class="btn secondary" data-action="modal-cancel">取消</button>
          <button class="btn" data-action="modal-save">保存</button>
        </div>`);
      const first = document.querySelector('#sheet input');
      if (first) first.focus();
      break;
    }

    case 'del-preset-item': {
      const kind = el.getAttribute('data-kind');
      const gi = parseInt(el.getAttribute('data-gi'), 10);
      const ii = parseInt(el.getAttribute('data-ii'), 10);
      const list = kind === 'room' ? roomPresets() : cabinetPresets();
      if (!list[gi]) break;
      list[gi].items.splice(ii, 1);
      save();
      renderCategory();
      break;
    }
  }
});

/* ---------- 工程详情页的实时输入 ---------- */

document.getElementById('default-price').addEventListener('change', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  p.defaultPrice = Math.max(0, n0(e.target.value, 0));
  e.target.value = p.defaultPrice;
  save();
  toast('默认单价已更新为 ' + p.defaultPrice + ' 元/m²');
});

document.getElementById('paid-amount').addEventListener('input', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  p.paidAmount = Math.max(0, n0(e.target.value, 0));
  // 收满了开关自动跟着亮（状态是从金额推出来的，不需要单独记）
  document.getElementById('settled-check').checked = projectIsSettled(p);
  saveSoon();
  renderSummary(p);
});

// 失焦时把输入框改写成规范值（挡住 "-5" 这种会让显示和实际不一致的输入）
document.getElementById('paid-amount').addEventListener('change', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  e.target.value = fmt(p.paidAmount);
});

document.getElementById('settled-check').addEventListener('change', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  if (!setSettled(p, e.target.checked)) {
    e.target.checked = false;
    return;
  }
  document.getElementById('paid-amount').value = fmt(p.paidAmount);
  save();
  renderSummary(p);
});

/* 折扣（动态字段，实时更新） */
document.addEventListener('input', e => {
  const field = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
  if (!field) return;
  const p = getProject(currentProjectId);
  if (!p) return;

  if (field === 'discount-rate') {
    const raw = e.target.value.trim();
    if (raw === '') return;              // 清空中，等失焦再处理
    p.discountRate = parseDiscountInput(raw);
    // 超出范围的写法（比如 999）给个视觉提示，而不是默默算成别的数
    e.target.classList.toggle('input-warn', parseFloat(raw.replace(/[折\s]/g, '')) > 100);
  } else if (field === 'discount-amount') {
    p.discountAmount = Math.max(0, n0(e.target.value, 0));
  }
  // 折扣会改变应收，开关状态要跟着走，否则会看到「已结清」和「未收」并存
  document.getElementById('settled-check').checked = projectIsSettled(p);
  saveSoon();
  renderSummary(p);
});

document.addEventListener('change', e => {
  const field = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
  if (!field) return;
  const p = getProject(currentProjectId);
  if (!p) return;

  if (field === 'discount-rate') {
    if (e.target.value.trim() === '') p.discountRate = 1;   // 清空 = 不打折
    e.target.value = discountInputValue(p.discountRate);
    e.target.classList.remove('input-warn');
    save();
  } else if (field === 'discount-amount') {
    e.target.value = fmt(p.discountAmount);
    save();
  }
  renderSummary(p);
});

/* 杂项：与柜子同级挂在房间上，就地改，失焦即存 */
document.addEventListener('change', e => {
  const t = e.target;
  const field = t && t.getAttribute && t.getAttribute('data-extra-field');
  if (!field) return;
  const p = getProject(currentProjectId);
  const r = p && (p.rooms || []).find(x => x.id === t.getAttribute('data-room'));
  const idx = parseInt(t.getAttribute('data-index'), 10);
  const ex = r && Array.isArray(r.extras) && r.extras[idx];
  if (!ex) return;

  if (field === 'name') ex.name = (t.value || '').trim();
  else if (field === 'unit') ex.unit = (t.value || '').trim() || '个';
  else ex[field] = Math.max(0, n0(t.value, 0));

  // 一行什么都没填就走人，说明是点错了 —— 直接收掉，别在账本里留垃圾行
  if (!ex.name && !n0(ex.qty, 0) && !n0(ex.price, 0)) r.extras.splice(idx, 1);

  save();
  renderProject();
});

/* 我的：全局默认单价 */
document.getElementById('mine-default-price').addEventListener('change', e => {
  state.defaultPrice = Math.max(0, n0(e.target.value, 0));
  e.target.value = state.defaultPrice;
  save();
  toast('全局默认单价已更新为 ' + state.defaultPrice + ' 元/m²');
});

/* 我的：导入备份 */
document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';                       // 允许重复选择同一个文件
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      toast('导入失败：文件不是合法的 JSON');
      return;
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
      toast('导入失败：不是本应用导出的备份文件');
      return;
    }
    const count = data.projects.length;
    if (!confirm('将用备份里的 ' + count + ' 个工程替换当前全部数据。\n\n当前数据会先留一份在「后悔药」里。确定继续？')) return;

    snapshotCurrent('before-import');
    state = normalizeState(data);
    initPresets();
    sanitizeTheme();
    applyTheme(state.theme);
    save();
    resetView();
    toast('已导入 ' + count + ' 个工程');
  };
  reader.onerror = () => toast('读取文件失败');
  reader.readAsText(file);
});

/* 点击遮罩空白处关闭弹窗 */
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

/* ============ 拖拽排序 ============ */

let dragCtx = null;

function activateDrag() {
  if (!dragCtx) return;
  dragCtx.dragging = true;
  dragCtx.itemEl.classList.add('dragging');
  document.body.classList.add('dragging-active');
}

function commitOrder(type, container) {
  const ids = Array.from(container.children)
    .map(el => el.getAttribute(type === 'room' ? 'data-room-id' : 'data-cab-id'));
  const p = getProject(currentProjectId);
  if (!p) return;
  if (type === 'room') {
    p.rooms.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  } else {
    const roomId = container.getAttribute('data-room');
    const r = p.rooms.find(x => x.id === roomId);
    if (r) r.cabinets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  }
  save();
  renderProject();
}

document.addEventListener('pointerdown', e => {
  const handle = e.target.closest('[data-action="drag-handle"]');
  if (!handle) return;
  e.preventDefault();
  const type = handle.getAttribute('data-type');
  const id = handle.getAttribute('data-id');
  const itemEl = handle.closest(type === 'room' ? '.room' : '.cab');
  if (!itemEl) return;
  dragCtx = {
    type: type, id: id, itemEl: itemEl, container: itemEl.parentElement,
    startX: e.clientX, startY: e.clientY, dragging: false, moved: false, timer: null
  };
  // 触屏要长按 400ms 才进入拖拽，避免和页面滚动打架；鼠标直接拖
  if (e.pointerType === 'touch') dragCtx.timer = setTimeout(activateDrag, 400);
  else activateDrag();
});

document.addEventListener('pointermove', e => {
  if (!dragCtx) return;
  if (!dragCtx.dragging) {
    const dx = e.clientX - dragCtx.startX;
    const dy = e.clientY - dragCtx.startY;
    if (dx * dx + dy * dy > 64) { clearTimeout(dragCtx.timer); dragCtx = null; }
    return;
  }
  e.preventDefault();
  const y = e.clientY;
  const container = dragCtx.container;
  let before = null;
  for (const sib of Array.from(container.children)) {
    if (sib === dragCtx.itemEl) continue;
    const rect = sib.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) { before = sib; break; }
  }
  if (before) {
    if (before !== dragCtx.itemEl.nextElementSibling) {
      container.insertBefore(dragCtx.itemEl, before);
      dragCtx.moved = true;
    }
  } else if (dragCtx.itemEl !== container.lastElementChild) {
    container.appendChild(dragCtx.itemEl);
    dragCtx.moved = true;
  }
});

function endDrag() {
  if (!dragCtx) return;
  clearTimeout(dragCtx.timer);
  if (dragCtx.dragging) {
    dragCtx.itemEl.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    if (dragCtx.moved) commitOrder(dragCtx.type, dragCtx.container);
  }
  dragCtx = null;
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ============ 初始化 ============ */

initPresets();
sanitizeTheme();
applyTheme(state.theme);
highlightTab('detail');
switchTab('detail');
render();
renderMine();

// 数据坏了 / 存储不可用 —— 都要在主界面明确告诉用户
if (loaded.status === 'corrupt') {
  refreshNotices();
  setTimeout(() => toast('本地数据读取失败，请查看首页提示'), 300);
} else if (loaded.status === 'nostorage') {
  refreshNotices();
  setTimeout(() => toast('当前浏览器无法保存数据，请用 Chrome / Edge 打开'), 300);
} else if (shouldRemindBackup()) {
  refreshNotices();
}

/* 注册 Service Worker（离线 + 可安装为 App） */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;

  // 新版接管后提示刷新，避免用户长期跑着旧代码
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    flushSave();
    if (confirm('已更新到新版本，刷新后生效。\n\n现在刷新？')) location.reload();
    else reloading = false;
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 用 file:// 打开或非 HTTPS 环境时注册必然失败，属于预期情况
    });
  });
}
