/* ============ 数据层 ============ */
const STORE_KEY = 'cabinetAppData_v1';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function defaultState() {
  return { projects: [], defaultPrice: 50, theme: 'teal' };
}

function normalizeState(s) {
  s = s || {};
  if (!Array.isArray(s.projects)) s.projects = [];
  if (s.defaultPrice == null) s.defaultPrice = 50;
  if (s.theme == null) s.theme = 'teal';
  s.projects.forEach(p => {
    if (p.discountType == null) p.discountType = 'none';
    if (p.discountRate == null) p.discountRate = 1;
    if (p.discountAmount == null) p.discountAmount = 0;
    if (p.paidAmount == null) p.paidAmount = 0;
    if (p.settled == null) p.settled = false;
    (p.rooms || []).forEach(r => {
      (r.cabinets || []).forEach(c => {
        if (c.pricingType == null) c.pricingType = 'area';
        (c.extras || []).forEach(e => { if (e.unit == null) e.unit = '个'; });
      });
    });
  });
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch (e) {}
  return defaultState();
}

let state = load();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function getProject(id) {
  return state.projects.find(p => p.id === id);
}

/* ============ 主题色 ============ */
const THEMES = [
  { id: 'teal', name: '青绿', primary: '#0d9488', primary2: '#14b8a6', primaryDark: '#0f766e', primaryLight: '#ccfbf1' },
  { id: 'blue', name: '蓝色', primary: '#2563eb', primary2: '#3b82f6', primaryDark: '#1d4ed8', primaryLight: '#dbeafe' },
  { id: 'violet', name: '紫色', primary: '#7c3aed', primary2: '#8b5cf6', primaryDark: '#6d28d9', primaryLight: '#ede9fe' },
  { id: 'rose', name: '玫红', primary: '#e11d48', primary2: '#f43f5e', primaryDark: '#be123c', primaryLight: '#ffe4e6' },
  { id: 'green', name: '翠绿', primary: '#16a34a', primary2: '#22c55e', primaryDark: '#15803d', primaryLight: '#dcfce7' },
  { id: 'orange', name: '暖橙', primary: '#ea580c', primary2: '#f97316', primaryDark: '#c2410c', primaryLight: '#ffedd5' }
];

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

// 预选词持久化（可编辑的分类库）
function initPresets() {
  if (!state.presets) {
    state.presets = {
      rooms: JSON.parse(JSON.stringify(ROOM_PRESETS)),
      cabinets: JSON.parse(JSON.stringify(CABINET_PRESETS))
    };
    save();
  }
}
function roomPresets() { return state.presets.rooms; }
function cabinetPresets() { return state.presets.cabinets; }

// 根据房间名推荐对应的柜子分组；无法判断时返回全部分组
function cabinetGroupsForRoom(roomName) {
  const all = cabinetPresets();
  const name = (roomName || '').trim();
  if (!name) return all;
  const exact = all.filter(g => g.rooms.indexOf(name) !== -1);
  if (exact.length) return exact;
  const rules = [
    ['厨', 'kitchen'],
    ['卫', 'bath'], ['浴', 'bath'], ['洗', 'bath'], ['阳', 'bath'], ['露台', 'bath'],
    ['卧', 'bedroom'], ['衣帽', 'bedroom'], ['书房', 'bedroom'], ['儿童', 'bedroom'], ['榻榻', 'bedroom'],
    ['客', 'living'], ['厅', 'living'], ['餐', 'living'], ['电视', 'living'], ['酒', 'living'], ['吧台', 'living'], ['隔断', 'living'], ['玄关', 'living'], ['鞋', 'living'], ['门厅', 'living']
  ];
  const ids = [];
  rules.forEach(r => { if (name.indexOf(r[0]) !== -1 && ids.indexOf(r[1]) === -1) ids.push(r[1]); });
  const groups = all.filter(g => ids.indexOf(g.id) !== -1);
  return groups.length ? groups : all;
}

function presetChipsHTML(groups) {
  return groups.map(g => `
    <div class="preset-group">
      <span class="preset-label">${esc(g.group)}</span>
      <div class="chips">${g.items.map(it => `<button type="button" class="chip" data-action="preset-fill" data-target="f-name" data-value="${esc(it)}">${esc(it)}</button>`).join('')}</div>
    </div>`).join('');
}

/* ============ 计算（统一核心） ============ */
function cabinetArea(c) {
  const w = parseFloat(c.width) || 0;
  const h = parseFloat(c.height) || 0;
  return w * h;
}

function cabinetPricingType(c) {
  return c.pricingType || 'area';
}

function extrasTotal(c) {
  return (c.extras || []).reduce((s, e) => s + (parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0), 0);
}

// 柜体基础金额（唯一计算入口，多计价方式）
function cabinetBaseAmount(c) {
  const q = parseFloat(c.quantity) || 0;
  const p = parseFloat(c.unitPrice) || 0;
  const type = cabinetPricingType(c);
  if (type === 'linear') {
    const len = parseFloat(c.length != null && c.length !== '' ? c.length : c.width) || 0;
    return len * q * p;
  }
  if (type === 'unit') {
    return q * p;
  }
  if (type === 'fixed') {
    return parseFloat(c.fixedAmount) || 0;
  }
  return cabinetArea(c) * q * p; // area（默认）
}

function cabinetAmount(c) {
  return cabinetBaseAmount(c) + extrasTotal(c);
}

// 面积贡献：只有“面积计价”才计入工程面积
function cabinetAreaContribution(c) {
  if (cabinetPricingType(c) !== 'area') return 0;
  return cabinetArea(c) * (parseFloat(c.quantity) || 0);
}

function roomSubtotal(r) {
  return (r.cabinets || []).reduce((s, c) => s + cabinetAmount(c), 0);
}
function roomArea(r) {
  return (r.cabinets || []).reduce((s, c) => s + cabinetAreaContribution(c), 0);
}
function projectTotal(p) { // 原始金额 gross
  return (p.rooms || []).reduce((s, r) => s + roomSubtotal(r), 0);
}
function projectArea(p) {
  return (p.rooms || []).reduce((s, r) => s + roomArea(r), 0);
}
function projectCabCount(p) {
  return (p.rooms || []).reduce((s, r) => s + (r.cabinets || []).length, 0);
}

// 折扣与收款（统一金额层级）
function projectDiscount(p) {
  const gross = projectTotal(p);
  const type = p.discountType || 'none';
  if (type === 'rate') {
    const rate = Math.max(0, Math.min(1, parseFloat(p.discountRate) || 1));
    return gross * (1 - rate);
  }
  if (type === 'amount') {
    const amt = parseFloat(p.discountAmount) || 0;
    return Math.min(Math.max(0, amt), gross);
  }
  return 0;
}
function projectFinal(p) { // 应收金额
  return Math.max(0, projectTotal(p) - projectDiscount(p));
}
function projectPaid(p) { // 累计已收金额
  return Math.max(0, parseFloat(p.paidAmount) || 0);
}
function projectOutstanding(p) { // 未收金额（永不负数）
  return Math.max(0, projectFinal(p) - projectPaid(p));
}

function discountLabel(rate) {
  const r = Number(rate);
  if (!r || r >= 1) return '原价';
  const x = Math.round(r * 100);
  return (x % 10 === 0 ? x / 10 : x) + '折';
}

function fmt(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toString();
}

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 统一柜子显示模型（页面 / 账单 / PDF / Excel 共用，避免重复逻辑）
function getCabinetDisplayData(c) {
  const type = cabinetPricingType(c);
  const q = parseFloat(c.quantity) || 0;
  const p = parseFloat(c.unitPrice) || 0;
  const w = parseFloat(c.width) || 0;
  const h = parseFloat(c.height) || 0;
  const len = parseFloat(c.length != null && c.length !== '' ? c.length : c.width) || 0;
  const area = cabinetAreaContribution(c);
  const base = cabinetBaseAmount(c);
  const extras = extrasTotal(c);
  const amount = base + extras;

  let specText, areaText, priceText, dimText;
  if (type === 'linear') {
    specText = fmt(len) + 'm';
    areaText = '—';
    priceText = fmt(p);
    dimText = fmt(len) + 'm ×' + fmt(q);
  } else if (type === 'unit') {
    specText = '—';
    areaText = '—';
    priceText = fmt(p);
    dimText = '×' + fmt(q) + '件';
  } else if (type === 'fixed') {
    specText = '—';
    areaText = '—';
    priceText = '—';
    dimText = '固定金额';
  } else {
    specText = fmt(w) + '×' + fmt(h);
    areaText = fmt(area);
    priceText = fmt(p);
    dimText = fmt(w) + '×' + fmt(h) + 'm ×' + fmt(q);
  }
  return {
    type: type, qty: q, price: p, width: w, height: h, length: len,
    base: base, extras: extras, amount: amount, area: area,
    specText: specText, areaText: areaText, priceText: priceText, dimText: dimText
  };
}

/* ============ 弹窗 ============ */
let modalCtx = null; // { type, projectId, roomId, cabinetId }

function renderExtrasList() {
  const list = document.getElementById('extras-list');
  if (!list) return;
  const ex = modalCtx.extras || [];
  list.innerHTML = ex.length
    ? ex.map((e, i) => `
      <div class="extra-row">
        <span class="extra-name">${esc(e.name)}</span>
        <input id="extra-qty-${i}" type="number" inputmode="numeric" step="any" min="0" placeholder="数量" value="${e.qty}">
        <input id="extra-unit-${i}" type="text" class="unit-in" placeholder="单位" value="${esc(e.unit || '个')}">
        <input id="extra-price-${i}" type="number" inputmode="decimal" step="any" min="0" placeholder="单价" value="${e.price}">
        <button type="button" class="icon-btn danger" data-action="del-extra" data-index="${i}">✕</button>
      </div>`).join('')
    : '<div class="extra-empty">暂无杂项，点下方标签快速添加</div>';
}

function collectExtras() {
  const ex = modalCtx.extras || [];
  ex.forEach((e, i) => {
    const q = document.getElementById('extra-qty-' + i);
    const p = document.getElementById('extra-price-' + i);
    const u = document.getElementById('extra-unit-' + i);
    if (q) e.qty = parseFloat(q.value) || 0;
    if (p) e.price = parseFloat(p.value) || 0;
    if (u) e.unit = u.value.trim() || '个';
  });
  return ex;
}

function openModal(type, ctx) {
  modalCtx = Object.assign({ type: type }, ctx || {});
  const sheet = document.getElementById('sheet');
  let html = '';
  if (type === 'project') {
    const p = ctx && ctx.projectId ? getProject(ctx.projectId) : null;
    html = `
      <h2>${p ? '编辑工程' : '新建工程'}</h2>
      <div class="field"><label>时间</label><input id="f-date" type="date" value="${p ? esc(p.date || '') : ''}"></div>
      <div class="grid2">
      <div class="field"><label>地址（如：卫辉-博士园）</label><input id="f-name" placeholder="请输入城市-小区名称" value="${p ? esc(p.name) : ''}"></div>
      <div class="field"><label>楼号单元号房间号</label><input id="f-location" placeholder="如：21栋1单元1102" value="${p ? esc(p.location || '') : ''}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>柜板厂房</label><input id="f-factory" placeholder="厂房名称" value="${p ? esc(p.factory || '') : ''}"></div>
        <div class="field"><label>设计师</label><input id="f-designer" placeholder="设计师姓名" value="${p ? esc(p.designer || '') : ''}"></div>
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

function openCabinetForm(ctx) {
  const p = getProject(ctx.projectId);
  const r = (p.rooms || []).find(x => x.id === ctx.roomId);
  const c = ctx.cabinetId ? (r.cabinets || []).find(x => x.id === ctx.cabinetId) : null;
  modalCtx = Object.assign({ type: 'cabinet' }, ctx || {});
  modalCtx.pricingType = ctx.pricingType || (c ? cabinetPricingType(c) : 'area');
  modalCtx.unitPrice = ctx.unitPrice != null ? ctx.unitPrice : (c ? c.unitPrice : p.defaultPrice);
  modalCtx.extras = (c && c.extras ? c.extras : []).map(e => ({ name: e.name, qty: e.qty, price: e.price, unit: e.unit || '个' }));

  const sheet = document.getElementById('sheet');
  sheet.innerHTML = `
    <h2>${c ? '编辑柜子' : '添加柜子'}</h2>
    <div class="field"><label>名称（如：地柜 / 吊柜 / 高柜）</label><input id="f-name" placeholder="请输入柜子名称" value="${c ? esc(c.name) : ''}"></div>
    <div class="preset-hint">当前房间「${esc(r ? r.name : '')}」推荐的柜子：</div>
    ${presetChipsHTML(cabinetGroupsForRoom(r ? r.name : ''))}

    <div class="section-label">计价方式</div>
    <div id="pricing-section"></div>

    <div class="section-label">杂项（按件计价）</div>
    <div id="extras-list"></div>
    <div class="chips" style="margin-top:8px">
      <button type="button" class="chip" data-action="add-extra" data-value="灯管">灯管 ¥10/个</button>
      <button type="button" class="chip" data-action="add-extra" data-value="指纹锁">指纹锁 /套</button>
    </div>
    <div class="extra-add" style="margin-top:8px">
      <input id="extra-name-input" placeholder="其他杂项名称，如：反弹器">
      <button type="button" class="btn secondary" data-action="add-extra-custom" style="width:auto;padding:10px 14px">添加</button>
    </div>

    <div class="section-label">备注</div>
    <div class="field"><input id="f-note" placeholder="可选：含抽屉 / 玻璃门" value="${c ? esc(c.note || '') : ''}"></div>

    <div class="btn-row">
      <button class="btn secondary" data-action="modal-cancel" style="font-size:14px">取消</button>
      <button class="btn secondary" data-action="modal-save-continue" style="font-size:14px">保存并继续</button>
      <button class="btn" data-action="modal-save" style="font-size:14px">保存</button>
    </div>`;
  document.getElementById('overlay').classList.add('show');
  renderPricingSection();
  renderExtrasList();
  const first = sheet.querySelector('input');
  if (first) first.focus();
}

function renderPricingSection() {
  const el = document.getElementById('pricing-section');
  if (!el) return;
  const p = getProject(modalCtx.projectId);
  const r = p.rooms.find(x => x.id === modalCtx.roomId);
  const c = modalCtx.cabinetId ? (r.cabinets || []).find(x => x.id === modalCtx.cabinetId) : null;
  const type = modalCtx.pricingType || 'area';
  const defPrice = c ? c.unitPrice : (modalCtx.unitPrice != null ? modalCtx.unitPrice : p.defaultPrice);
  const chip = (v, label) => `<button type="button" class="chip ${type === v ? 'chip-on' : ''}" data-action="set-pricing" data-value="${v}">${label}</button>`;
  el.innerHTML = `
    <div class="field"><label>计价方式</label><div class="chips">${chip('area','面积计价')}${chip('linear','延米计价')}${chip('unit','按件计价')}${chip('fixed','固定金额')}</div></div>
    ${pricingFieldsHTML(type, c, defPrice)}`;
}

function pricingFieldsHTML(type, c, defPrice) {
  if (type === 'linear') {
    return `
      <div class="field unit"><label>长度</label><input id="f-length" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${c ? c.length : ''}"><span>米</span></div>
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="numeric" step="any" min="0" placeholder="1" value="${c ? c.quantity : 1}"></div>
        <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${c ? c.unitPrice : defPrice}"><span>元/米</span></div>
      </div>`;
  }
  if (type === 'unit') {
    return `
      <div class="grid2">
        <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="numeric" step="any" min="0" placeholder="1" value="${c ? c.quantity : 1}"></div>
        <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${c ? c.unitPrice : defPrice}"><span>元/件</span></div>
      </div>`;
  }
  if (type === 'fixed') {
    return `
      <div class="field unit"><label>固定金额</label><input id="f-fixed" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${c ? c.fixedAmount : ''}"><span>元</span></div>`;
  }
  return `
    <div class="grid2">
      <div class="field unit"><label>宽</label><input id="f-width" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${c ? c.width : ''}"><span>米</span></div>
      <div class="field unit"><label>高</label><input id="f-height" type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${c ? c.height : ''}"><span>米</span></div>
    </div>
    <div class="grid2">
      <div class="field"><label>数量</label><input id="f-qty" type="number" inputmode="numeric" step="any" min="0" placeholder="1" value="${c ? c.quantity : 1}"></div>
      <div class="field unit"><label>单价</label><input id="f-price" type="number" inputmode="decimal" step="any" min="0" value="${c ? c.unitPrice : defPrice}"><span>元/m²</span></div>
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
  openModal('project', { afterSave: () => {
    if (lastCreatedProjectId) {
      currentProjectId = lastCreatedProjectId;
      expandedRooms.clear();
      switchTab('detail');
      renderProject();
    }
  }});
}

function saveModal() {
  const t = modalCtx.type;
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  if (t === 'project') {
    const name = v('f-name');
    const price = parseFloat(v('f-price')) || 0;
    const date = v('f-date');
    const location = v('f-location');
    const factory = v('f-factory');
    const designer = v('f-designer');
    if (!name) return toast('请输入工程名称');
    if (modalCtx.projectId) {
      const p = getProject(modalCtx.projectId);
      p.name = name; p.defaultPrice = price;
      p.date = date; p.location = location; p.factory = factory; p.designer = designer;
    } else {
      const id = uid();
      state.projects.push({ id: id, name: name, defaultPrice: price, createdAt: Date.now(), rooms: [], date: date, location: location, factory: factory, designer: designer });
      lastCreatedProjectId = id;
    }
  } else if (t === 'room') {
    const name = v('f-name');
    if (!name) return toast('请输入房间名称');
    const p = getProject(modalCtx.projectId);
    if (modalCtx.roomId) {
      p.rooms.find(x => x.id === modalCtx.roomId).name = name;
    } else {
      p.rooms.push({ id: uid(), name: name, cabinets: [] });
    }
  } else if (t === 'cabinet') {
    const name = v('f-name') || '未命名';
    const pricingType = modalCtx.pricingType || 'area';
    const note = v('f-note');
    const extras = collectExtras().filter(e => e.name);
    const p = getProject(modalCtx.projectId);
    const r = p.rooms.find(x => x.id === modalCtx.roomId);

    let width = 0, height = 0, quantity = 1, price = 0, length = 0, fixedAmount = 0;
    if (pricingType === 'area') {
      width = parseFloat(v('f-width')) || 0;
      height = parseFloat(v('f-height')) || 0;
      quantity = parseFloat(v('f-qty')) || 1;
      price = parseFloat(v('f-price')) || 0;
    } else if (pricingType === 'linear') {
      length = parseFloat(v('f-length')) || 0;
      quantity = parseFloat(v('f-qty')) || 1;
      price = parseFloat(v('f-price')) || 0;
    } else if (pricingType === 'unit') {
      quantity = parseFloat(v('f-qty')) || 1;
      price = parseFloat(v('f-price')) || 0;
    } else {
      fixedAmount = parseFloat(v('f-fixed')) || 0;
    }

    const data = { name: name, pricingType: pricingType, width: width, height: height, quantity: quantity, unitPrice: price, length: length, fixedAmount: fixedAmount, note: note, extras: extras };
    if (modalCtx.cabinetId) {
      Object.assign(r.cabinets.find(x => x.id === modalCtx.cabinetId), data);
    } else {
      r.cabinets.push(Object.assign({ id: uid() }, data));
    }
  } else if (t === 'preset-add') {
    const name = v('f-name');
    if (!name) return toast('请输入名称');
    const list = modalCtx.kind === 'room' ? roomPresets() : cabinetPresets();
    list[modalCtx.gi].items.push(name);
    save();
    closeModal();
    renderCategory();
    return;
  }
  if (modalCtx.continueAfterSave) {
    const keepType = modalCtx.pricingType || 'area';
    const priceEl = document.getElementById('f-price');
    const keepPrice = priceEl ? (parseFloat(priceEl.value) || 0) : 0;
    save();
    openCabinetForm({ projectId: modalCtx.projectId, roomId: modalCtx.roomId, pricingType: keepType, unitPrice: keepPrice });
    return;
  }
  const after = modalCtx.afterSave;
  save();
  closeModal();
  render();
  if (after) after();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

/* ============ 渲染 ============ */
let currentProjectId = null;
let activeTab = 'detail';
let lastCreatedProjectId = null;
const expandedRooms = new Set();

function render() {
  renderHome();
  renderProject();
}

function renderHome() {
  const list = document.getElementById('home-list');
  const empty = document.getElementById('home-empty');
  if (!state.projects.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = state.projects.map(p => {
    const final = projectFinal(p);
    const out = projectOutstanding(p);
    const locDate = [p.location, p.date].filter(Boolean).join(' · ');
    const status = p.settled
      ? `<span class="badge-clear">已结清</span>`
      : `<span class="badge-out">未收 ¥${fmt(out)}</span>`;
    return `
    <div class="list-item" data-action="open-project" data-id="${p.id}">
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        ${locDate ? `<div class="sub">${esc(locDate)}</div>` : ''}
        <div class="sub">${p.rooms ? p.rooms.length : 0} 个房间 · ${fmt(projectArea(p))} m²</div>
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
    ${discount > 0 ? `<div class="bd-row"><span>优惠${p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''}</span><span class="bd-v">¥${fmt(discount)}</span></div>` : ''}
    <div class="bd-row"><span>已收</span><span class="bd-v">¥${fmt(paid)}</span></div>
    ${p.settled
      ? '<div class="bd-row"><span>状态</span><span class="bd-v">已结清</span></div>'
      : `<div class="bd-row bd-out"><span>未收</span><span class="bd-v">¥${fmt(out)}</span></div>`}`;
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
  infoEl.innerHTML = infos.length
    ? `<div class="card card-body" style="padding:12px 16px;margin-bottom:12px">
        <div class="info-title">基础信息</div>
        ${infos.map(([k, v]) => `<div class="info-row"><span class="info-k">${k}</span><span class="info-v">${esc(v)}</span></div>`).join('')}
      </div>`
    : '';
  document.getElementById('proj-meta').innerHTML =
    `<span>面积 ${fmt(projectArea(p))} m²</span><span>${p.rooms ? p.rooms.length : 0} 个房间</span><span>${projectCabCount(p)} 个柜子</span>`;
  renderSummary(p);
  document.getElementById('default-price').value = p.defaultPrice;
  document.getElementById('paid-amount').value = p.paidAmount || 0;
  document.getElementById('settled-check').checked = !!p.settled;

  // 折扣 UI
  const dt = p.discountType || 'none';
  document.querySelectorAll('#discount-type-chips .chip').forEach(ch => {
    ch.classList.toggle('chip-on', ch.getAttribute('data-value') === dt);
  });
  const dInput = document.getElementById('discount-input');
  if (dt === 'rate') {
    dInput.innerHTML = `<div class="field"><label>折扣率（0.95 = 95折）</label><input id="f-discount-rate" data-field="discount-rate" type="number" inputmode="decimal" step="any" min="0" max="1" value="${p.discountRate != null ? p.discountRate : 1}"></div>`;
  } else if (dt === 'amount') {
    dInput.innerHTML = `<div class="field unit"><label>优惠金额</label><input id="f-discount-amount" data-field="discount-amount" type="number" inputmode="decimal" step="any" min="0" value="${p.discountAmount || 0}"><span>元</span></div>`;
  } else {
    dInput.innerHTML = '';
  }

  const list = document.getElementById('room-list');
  if (!p.rooms || !p.rooms.length) {
    list.innerHTML = `<div class="empty" style="padding:32px 16px"><p>还没有房间，先添加「厨房」或「卧室」吧</p></div>`;
    return;
  }
  list.innerHTML = p.rooms.map(r => {
    const open = expandedRooms.has(r.id) ? 'open' : '';
    const cabs = (r.cabinets || []).map(c => {
      const d = getCabinetDisplayData(c);
      return `
      <div class="cab" data-cab-id="${c.id}">
        <button class="icon-btn drag-handle" data-action="drag-handle" data-type="cabinet" data-id="${c.id}" title="拖动排序">≡</button>
        <div class="info">
          <div class="cname">${esc(c.name)}</div>
          <div class="dims">${d.dimText}${c.note ? ' · ' + esc(c.note) : ''}${d.extras > 0 ? ' · 杂项 ¥' + fmt(d.extras) : ''}</div>
        </div>
        <div class="money">
          <div class="amt">¥${fmt(d.amount)}</div>
          <div class="area">${d.type === 'area' ? d.areaText + ' m²' : '—'}</div>
        </div>
        <button class="icon-btn" data-action="copy-cabinet" data-id="${c.id}" data-room="${r.id}" title="复制">⧉</button>
        <button class="icon-btn" data-action="edit-cabinet" data-id="${c.id}" data-room="${r.id}">✎</button>
        <button class="icon-btn danger" data-action="delete-cabinet" data-id="${c.id}" data-room="${r.id}">🗑</button>
      </div>`;
    }).join('');
    return `
      <div class="card room ${open}" data-room-id="${r.id}">
        <div class="room-head" data-action="toggle-room" data-id="${r.id}">
          <span class="chev">▶</span>
          <span class="name">${esc(r.name)}</span>
          <span class="subtotal">¥${fmt(roomSubtotal(r))}</span>
          <button class="icon-btn drag-handle" data-action="drag-handle" data-type="room" data-id="${r.id}" title="长按拖动排序">≡</button>
          <button class="icon-btn" data-action="edit-room" data-id="${r.id}">✎</button>
          <button class="icon-btn danger" data-action="delete-room" data-id="${r.id}">🗑</button>
        </div>
        <div class="room-body">
          <div class="cab-list" data-room="${r.id}">${cabs}</div>
          <div class="btn-row" style="margin-top:10px;gap:8px">
            <button class="btn secondary" data-action="copy-room" data-id="${r.id}" style="font-size:14px">⧉ 复制房间</button>
            <button class="btn secondary" data-action="add-cabinet" data-id="${r.id}" style="font-size:14px">＋ 添加柜子</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderCategory() {
  const roomsEl = document.getElementById('category-rooms');
  const cabsEl = document.getElementById('category-cabinets');
  if (!roomsEl || !cabsEl) return;
  roomsEl.innerHTML = roomPresets().map((g, gi) => `
    <div class="preset-group">
      <span class="preset-label">${esc(g.group)}</span>
      <div class="chips">
        ${g.items.map((it, ii) => `<span class="chip chip-edit">${esc(it)}<button type="button" class="chip-x" data-action="del-preset-item" data-kind="room" data-gi="${gi}" data-ii="${ii}">✕</button></span>`).join('')}
        <button type="button" class="chip chip-add" data-action="add-preset-item" data-kind="room" data-gi="${gi}">＋</button>
      </div>
    </div>`).join('');
  cabsEl.innerHTML = cabinetPresets().map((g, gi) => `
    <div class="preset-group">
      <span class="preset-label">${esc(g.group)}</span>
      <div class="chips">
        ${g.items.map((it, ii) => `<span class="chip chip-edit">${esc(it)}<button type="button" class="chip-x" data-action="del-preset-item" data-kind="cabinet" data-gi="${gi}" data-ii="${ii}">✕</button></span>`).join('')}
        <button type="button" class="chip chip-add" data-action="add-preset-item" data-kind="cabinet" data-gi="${gi}">＋</button>
      </div>
    </div>`).join('');
}

function renderMine() {
  const el = document.getElementById('mine-default-price');
  if (el) el.value = state.defaultPrice || 50;
  const tc = document.getElementById('theme-chips');
  if (tc) {
    tc.innerHTML = THEMES.map(t => `
      <button type="button" class="theme-swatch ${state.theme === t.id ? 'on' : ''}" data-action="set-theme" data-value="${t.id}" style="background:${t.primary}" title="${t.name}"></button>`).join('');
  }
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
    lines.push('▍' + r.name + '（小计 ¥' + fmt(roomSubtotal(r)) + '）');
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      let s = '  ' + c.name + '：' + d.dimText;
      if (d.type === 'area') s += ' = ' + d.areaText + 'm² ×¥' + d.priceText + ' = ¥' + fmt(d.base);
      else if (d.type === 'linear' || d.type === 'unit') s += ' ×¥' + d.priceText + ' = ¥' + fmt(d.base);
      else s += ' = ¥' + fmt(d.base);
      if (c.note) s += '（' + c.note + '）';
      lines.push(s);
      (c.extras || []).forEach(e => {
        lines.push('    · ' + e.name + ' ×' + fmt(e.qty) + ' ' + (e.unit || '个') + ' ×¥' + fmt(e.price) + ' = ¥' + fmt((parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0)));
      });
    });
  });
  lines.push('------------------------------');
  lines.push('总面积：' + fmt(projectArea(p)) + ' m²');
  lines.push('原始金额：¥' + fmt(projectTotal(p)));
  const dsc = projectDiscount(p);
  if (dsc > 0) lines.push('优惠：¥' + fmt(dsc) + (p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''));
  lines.push('应收金额：¥' + fmt(projectFinal(p)));
  lines.push('已收：¥' + fmt(projectPaid(p)));
  lines.push('未收：¥' + fmt(projectOutstanding(p)));
  return lines.join('\n');
}

function billDate() {
  const d = new Date();
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function buildPrintHTML(p) {
  let rows = '';
  let info = '';
  if (p.date) info += `<div>装修时间：${esc(p.date)}</div>`;
  if (p.location) info += `<div>装修地点：${esc(p.location)}</div>`;
  if (p.factory) info += `<div>厂房：${esc(p.factory)}</div>`;
  if (p.designer) info += `<div>设计师：${esc(p.designer)}</div>`;
  (p.rooms || []).forEach(r => {
    rows += `<tr class="room-row"><td colspan="6">${esc(r.name)}</td></tr>`;
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      rows += `<tr>
        <td>${esc(c.name)}${c.note ? '（' + esc(c.note) + '）' : ''}</td>
        <td>${d.specText}</td>
        <td>${d.type === 'fixed' ? '—' : fmt(d.qty)}</td>
        <td>${d.areaText}</td>
        <td>${d.priceText}</td>
        <td>${fmt(d.base)}</td>
      </tr>`;
      (c.extras || []).forEach(e => {
        rows += `<tr>
          <td style="padding-left:18px">${esc(e.name)}</td>
          <td></td>
          <td>${fmt(e.qty)} ${esc(e.unit || '个')}</td>
          <td></td>
          <td>${fmt(e.price)}</td>
          <td>${fmt((parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0))}</td>
        </tr>`;
      });
    });
  });

  const dsc = projectDiscount(p);
  return `
    <h1>橱柜对账单</h1>
    <div class="print-meta">工程：${esc(p.name)}　·　日期：${billDate()}</div>
    ${info ? '<div class="print-info">' + info + '</div>' : ''}
    <table>
      <thead>
        <tr><th>名称</th><th>规格</th><th>数量</th><th>面积(m²)</th><th>单价(元)</th><th>金额(元)</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td colspan="3">合计</td>
          <td>${fmt(projectArea(p))}</td>
          <td></td>
          <td>${fmt(projectTotal(p))}</td>
        </tr>
        ${dsc > 0 ? `<tr><td colspan="5">优惠${p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''}</td><td>${fmt(dsc)}</td></tr>` : ''}
        <tr><td colspan="5">应收金额</td><td>${fmt(projectFinal(p))}</td></tr>
        <tr><td colspan="5">已收</td><td>${fmt(projectPaid(p))}</td></tr>
        <tr><td colspan="5">未收</td><td>${fmt(projectOutstanding(p))}</td></tr>
      </tbody>
    </table>
    <div class="print-footer">应收金额：¥${fmt(projectFinal(p))}　·　未收：¥${fmt(projectOutstanding(p))}</div>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('加载失败'));
    document.head.appendChild(s);
  });
}

async function exportPdf(p) {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  } catch (e) {
    toast('PDF 组件加载失败，请检查网络后重试');
    return;
  }
  const jsPDF = window.jspdf && window.jspdf.jsPDF;
  const html2canvas = window.html2canvas;
  if (!jsPDF || !html2canvas) {
    toast('PDF 组件加载失败，请检查网络后重试');
    return;
  }
  toast('正在生成 PDF…');
  const src = document.getElementById('pdf-src');
  src.innerHTML = buildPrintHTML(p);
  const SCALE = 3;
  const canvas = await html2canvas(src, { scale: SCALE, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF('l', 'mm', 'a4');
  const margin = 10;
  const contentW = 297 - margin * 2;
  const contentH = 210 - margin * 2;
  const pxPerMm = canvas.width / contentW;
  const pagePx = contentH * pxPerMm; // 每页内容高度（canvas 像素）

  // 测量每个表格行上边界，作为允许断页的位置（按行断页，不截断行）
  const srcTop = src.getBoundingClientRect().top;
  const rowTops = Array.from(src.querySelectorAll('tr'))
    .map(tr => (tr.getBoundingClientRect().top - srcTop) * SCALE)
    .filter(y => y > 0)
    .sort((a, b) => a - b);
  const breaks = [0, ...rowTops, canvas.height];

  // 逐页：在不超过页高的前提下，把页底吸到最近的“行上边界”
  const slices = [];
  let start = 0;
  while (start < canvas.height) {
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
    if (i > 0) pdf.addPage();
    pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', margin, margin, contentW, sh / pxPerMm);
  });
  pdf.save('橱柜对账单-' + p.name + '.pdf');
  toast('PDF 已生成');
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
  aoa.push(['名称', '规格', '数量', '面积(m²)', '单价(元)', '金额(元)']);

  (p.rooms || []).forEach(r => {
    aoa.push([r.name]);
    mergeRow(aoa.length - 1);
    (r.cabinets || []).forEach(c => {
      const d = getCabinetDisplayData(c);
      aoa.push([
        c.name + (c.note ? '（' + c.note + '）' : ''),
        d.specText,
        d.type === 'fixed' ? '' : r2(d.qty),
        d.type === 'area' ? r2(d.area) : '',
        d.type === 'fixed' ? '' : r2(d.price),
        r2(d.base)
      ]);
      (c.extras || []).forEach(e => {
        aoa.push([
          '　' + e.name,
          '',
          String(r2(e.qty)) + ' ' + (e.unit || '个'),
          '',
          r2(e.price),
          r2((parseFloat(e.qty) || 0) * (parseFloat(e.price) || 0))
        ]);
      });
    });
  });

  aoa.push(['合计', '', '', r2(projectArea(p)), '', r2(projectTotal(p))]);
  let tr = aoa.length - 1;
  merges.push({ s: { r: tr, c: 0 }, e: { r: tr, c: 2 } });

  const dsc = projectDiscount(p);
  if (dsc > 0) { aoa.push(['优惠' + (p.discountType === 'rate' ? '（' + discountLabel(p.discountRate) + '）' : ''), '', '', '', '', r2(dsc)]); mergeLabel(aoa.length - 1); }
  aoa.push(['应收金额', '', '', '', '', r2(projectFinal(p))]); mergeLabel(aoa.length - 1);
  aoa.push(['已收', '', '', '', '', r2(projectPaid(p))]); mergeLabel(aoa.length - 1);
  aoa.push(['未收', '', '', '', '', r2(projectOutstanding(p))]); mergeLabel(aoa.length - 1);

  return { aoa: aoa, merges: merges };
}

async function exportExcel(p) {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  } catch (e) {
    toast('Excel 组件加载失败，请检查网络后重试');
    return;
  }
  const XLSX = window.XLSX;
  if (!XLSX) { toast('Excel 组件加载失败，请检查网络后重试'); return; }
  toast('正在生成 Excel…');
  const { aoa, merges } = buildExcelData(p);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '对账单');
  XLSX.writeFile(wb, '橱柜对账单-' + p.name + '.xlsx');
  toast('Excel 已生成');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      return true;
    } catch (e2) { return false; }
  }
}

/* ============ 交互 ============ */
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1600);
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
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
    showPage('page-stats');
  } else if (tab === 'mine') {
    renderMine();
    showPage('page-mine');
  }
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.getAttribute('data-action');
  const id = el.getAttribute('data-id');

  switch (action) {
    case 'new-project': openNewOrder(); break;
    case 'open-project': currentProjectId = id; expandedRooms.clear(); showPage('page-project'); renderProject(); break;
    case 'back-home': currentProjectId = null; renderHome(); showPage('page-home'); break;
    case 'edit-project': openModal('project', { projectId: currentProjectId }); break;
    case 'delete-project': {
      const p = getProject(currentProjectId);
      if (confirm('确定删除工程「' + p.name + '」？此操作不可恢复。')) {
        state.projects = state.projects.filter(x => x.id !== currentProjectId);
        save(); currentProjectId = null; showPage('page-home'); renderHome();
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
      const r = p.rooms.find(x => x.id === id);
      if (confirm('确定删除房间「' + r.name + '」及其所有柜子？')) {
        p.rooms = p.rooms.filter(x => x.id !== id);
        expandedRooms.delete(id); save(); renderProject();
      }
      break;
    }
    case 'toggle-room': {
      const room = el.closest('.room-head');
      const roomId = id;
      if (expandedRooms.has(roomId)) expandedRooms.delete(roomId); else expandedRooms.add(roomId);
      const card = el.closest('.room');
      card.classList.toggle('open', expandedRooms.has(roomId));
      break;
    }
    case 'add-cabinet': openModal('cabinet', { projectId: currentProjectId, roomId: id }); break;
    case 'edit-cabinet': openModal('cabinet', { projectId: currentProjectId, roomId: el.getAttribute('data-room'), cabinetId: id }); break;
    case 'delete-cabinet': {
      const p = getProject(currentProjectId);
      const r = p.rooms.find(x => x.id === el.getAttribute('data-room'));
      const c = r.cabinets.find(x => x.id === id);
      if (confirm('确定删除柜子「' + c.name + '」？')) {
        r.cabinets = r.cabinets.filter(x => x.id !== id);
        save(); renderProject();
      }
      break;
    }
    case 'copy-cabinet': {
      const p = getProject(currentProjectId);
      const r = p.rooms.find(x => x.id === el.getAttribute('data-room'));
      const c = r.cabinets.find(x => x.id === id);
      if (!c) break;
      const clone = JSON.parse(JSON.stringify(c));
      clone.id = uid();
      clone.name = c.name + '（副本）';
      r.cabinets.push(clone);
      save(); renderProject();
      break;
    }
    case 'copy-room': {
      const p = getProject(currentProjectId);
      const r = p.rooms.find(x => x.id === id);
      if (!r) break;
      const clone = JSON.parse(JSON.stringify(r));
      clone.id = uid();
      clone.name = r.name + '（副本）';
      (clone.cabinets || []).forEach(c => { c.id = uid(); });
      p.rooms.push(clone);
      save(); renderProject();
      break;
    }
    case 'copy-bill': {
      const p = getProject(currentProjectId);
      const ok = await copyText(buildBill(p));
      toast(ok ? '账单已复制，可粘贴发送' : '复制失败，请手动截图');
      break;
    }
    case 'export-pdf': {
      const p = getProject(currentProjectId);
      exportPdf(p);
      break;
    }
    case 'export-excel': {
      const p = getProject(currentProjectId);
      exportExcel(p);
      break;
    }
    case 'clear-data': {
      if (confirm('确定清空全部数据？所有工程和柜子都会被删除。')) {
        state = defaultState();
        initPresets();
        save();
        expandedRooms.clear();
        currentProjectId = null;
        render();
        renderMine();
      }
      break;
    }
    case 'modal-cancel': closeModal(); break;
    case 'modal-save': saveModal(); break;
    case 'preset-fill': {
      const input = document.getElementById(el.getAttribute('data-target'));
      if (input) { input.value = el.getAttribute('data-value'); input.focus(); }
      break;
    }
    case 'add-extra': {
      collectExtras();
      const nm = el.getAttribute('data-value');
      const unit = nm === '灯管' ? '个' : (nm === '指纹锁' ? '套' : '个');
      modalCtx.extras.push({ name: nm, qty: 1, unit: unit, price: nm === '灯管' ? 10 : 0 });
      renderExtrasList();
      break;
    }
    case 'add-extra-custom': {
      const inp = document.getElementById('extra-name-input');
      const nm = (inp && inp.value ? inp.value : '').trim();
      if (!nm) { toast('请输入杂项名称'); break; }
      collectExtras();
      modalCtx.extras.push({ name: nm, qty: 1, unit: '个', price: 0 });
      if (inp) inp.value = '';
      renderExtrasList();
      break;
    }
    case 'set-pricing': {
      modalCtx.pricingType = el.getAttribute('data-value');
      renderPricingSection();
      break;
    }
    case 'modal-save-continue': {
      modalCtx.continueAfterSave = true;
      saveModal();
      break;
    }
    case 'del-extra': {
      collectExtras();
      const idx = parseInt(el.getAttribute('data-index'), 10);
      if (!isNaN(idx)) modalCtx.extras.splice(idx, 1);
      renderExtrasList();
      break;
    }
    case 'switch-tab': {
      const tab = el.getAttribute('data-tab');
      if (tab === 'detail' && activeTab === 'detail' && currentProjectId) {
        currentProjectId = null;
      }
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
      break;
    }
    case 'del-preset-item': {
      const kind = el.getAttribute('data-kind');
      const gi = parseInt(el.getAttribute('data-gi'), 10);
      const ii = parseInt(el.getAttribute('data-ii'), 10);
      const list = kind === 'room' ? roomPresets() : cabinetPresets();
      list[gi].items.splice(ii, 1);
      save();
      renderCategory();
      break;
    }
    case 'export-data': {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '橱柜对账备份-' + billDate() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('备份文件已下载');
      break;
    }
    case 'import-data': document.getElementById('import-file').click(); break;
  }
});

/* 默认单价实时更新 */
document.getElementById('default-price').addEventListener('change', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  p.defaultPrice = parseFloat(e.target.value) || 0;
  save();
  toast('默认单价已更新为 ' + p.defaultPrice + ' 元/m²');
});

/* 已收金额（实时更新） */
document.getElementById('paid-amount').addEventListener('input', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  p.paidAmount = Math.max(0, parseFloat(e.target.value) || 0);
  save();
  renderSummary(p);
});

/* 已结清（手动勾选） */
document.getElementById('settled-check').addEventListener('change', e => {
  const p = getProject(currentProjectId);
  if (!p) return;
  p.settled = e.target.checked;
  save();
  renderSummary(p);
});

/* 折扣率/优惠金额（动态字段，实时更新） */
document.addEventListener('input', e => {
  const field = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
  if (!field) return;
  const p = getProject(currentProjectId);
  if (!p) return;
  if (field === 'discount-rate') {
    let r = parseFloat(e.target.value);
    if (isNaN(r)) r = 1;
    p.discountRate = Math.max(0, Math.min(1, r));
  } else if (field === 'discount-amount') {
    p.discountAmount = Math.max(0, parseFloat(e.target.value) || 0);
  }
  save();
  renderSummary(p);
});

/* 我的：全局默认单价 */
document.getElementById('mine-default-price').addEventListener('change', e => {
  state.defaultPrice = parseFloat(e.target.value) || 0;
  save();
  toast('全局默认单价已更新为 ' + state.defaultPrice + ' 元/m²');
});

/* 我的：导入备份 */
document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.projects)) throw new Error('格式错误');
      state = normalizeState(data);
      if (!state.presets) initPresets();
      save();
      expandedRooms.clear();
      currentProjectId = null;
      render();
      renderCategory();
      toast('数据已恢复');
    } catch (err) {
      toast('导入失败：文件格式不正确');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
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
  const ids = Array.from(container.children).map(el => el.getAttribute(type === 'room' ? 'data-room-id' : 'data-cab-id'));
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
    startX: e.clientX, startY: e.clientY, dragging: false, moved: false, pointerType: e.pointerType
  };
  if (e.pointerType === 'touch') {
    dragCtx.timer = setTimeout(activateDrag, 400);
  } else {
    activateDrag();
  }
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

/* 初始化 */
initPresets();
applyTheme(state.theme);
switchTab('detail');
render();

/* 注册 Service Worker（实现离线 + 可安装为 App） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
