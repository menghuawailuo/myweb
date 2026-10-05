/* ============================================================
 * 界面层冒烟测试
 *   运行： node tests/app.smoke.js
 *
 * 计算对不对由 calc.test.js 负责；这里盯的是另一类问题：
 *   - 初始化顺序错误 / 全局变量在声明前被使用（TDZ）
 *   - 事件处理里点一下就崩
 *   - 存进去再读出来数据变了样
 *   - 脏数据、损坏数据会不会把账本搞丢
 *
 * 做法：造一个最小 DOM 桩，把 calc.js + app.js 当浏览器脚本执行，
 * 再模拟点击/输入去驱动真实的业务分支。
 * ============================================================ */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..') + path.sep;

/* ---------------- 桩 DOM ---------------- */

const byId = new Map();

function makeEl(id) {
  const backing = {
    id: id || '', value: '', textContent: '', innerHTML: '', checked: false, hidden: false,
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    files: [], children: [], dataset: {}, _attrs: {}, _listeners: [],
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(t, fn) { this._listeners.push({ t, fn }); },
    removeEventListener() {}, focus() {}, click() {}, appendChild() {}, removeChild() {},
    remove() {}, insertBefore() {}, closest() { return null; },
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    get scrollWidth() { return 1000; },
    get scrollHeight() { return 1000; }
  };
  const p = new Proxy(backing, {
    get(t, k) { return k in t ? t[k] : undefined; },
    set(t, k, v) { t[k] = v; return true; }
  });
  return p;
}
function el(id) { if (!byId.has(id)) byId.set(id, makeEl(id)); return byId.get(id); }

const docHandlers = [];
global.document = {
  documentElement: { style: { setProperty() {} } },
  body: makeEl('body'), head: makeEl('head'),
  activeElement: makeEl('__active__'), hidden: false,
  getElementById: el, querySelector: () => makeEl('q'), querySelectorAll: () => [],
  createElement: t => makeEl(t),
  addEventListener(t, fn) { docHandlers.push({ t, fn }); }
};
global.window = { addEventListener() {}, removeEventListener() {}, print() {} };
global.location = { reload() {} };
global.confirm = () => true;
global.Blob = function () {};
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.FileReader = function () {};

const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); },
  clear: () => store.clear()
};

/* ---------------- 加载真实代码 ---------------- */

// 和浏览器一致：calc.js 先执行并把函数挂到全局，app.js 再执行
const code = fs.readFileSync(root + 'js/calc.js', 'utf8') + '\n' +
  fs.readFileSync(root + 'js/app.js', 'utf8') + '\n' +
  'globalThis.__t = {' +
  ' get state(){return state;}, set state(v){state=v;},' +
  ' get loaded(){return loaded;}, get modalCtx(){return modalCtx;},' +
  ' get currentProjectId(){return currentProjectId;},' +
  ' getProject, normalizeState, defaultState, initPresets, render, renderHome, renderProject,' +
  ' renderStats, renderMine, renderCategory, refreshNotices, computeStats, openNewOrder, openModal,' +
  ' saveModal, closeModal, switchTab, resetView, snapshotCurrent, readSnapshot, shouldRemindBackup,' +
  ' buildBill, buildPrintHTML, buildExcelData, flushSave };';
vm.runInThisContext(code, { filename: 'bundle.js' });
const T = globalThis.__t;

/* ---------------- 测试小工具 ---------------- */

let pass = 0;
const fails = [];
function ok(name, fn) {
  try { fn(); pass++; } catch (e) { fails.push(name + ' → ' + e.message); }
}
function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error((label || '值') + ' 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
}
// 模拟点击带 data-action 的元素
function click(action, extra) {
  const attrs = Object.assign({ 'data-action': action }, extra || {});
  docHandlers.filter(h => h.t === 'click').forEach(h => h.fn({
    target: { closest: () => ({ getAttribute: k => (attrs[k] === undefined ? null : attrs[k]) }) }
  }));
}
// 模拟文档级 input/change（折扣字段走这条路）
function fire(type, field, value) {
  docHandlers.filter(h => h.t === type).forEach(h => h.fn({
    target: {
      value: value, classList: { toggle() {}, add() {}, remove() {} },
      getAttribute: k => (k === 'data-field' ? field : null)
    }
  }));
}
// 模拟杂项输入框失焦（data-extra-field 走这条路，和折扣的 data-field 是两条分支）
function fireExtra(field, roomId, index, value) {
  docHandlers.filter(h => h.t === 'change').forEach(h => h.fn({
    target: {
      value: value,
      getAttribute: k => k === 'data-extra-field' ? field
        : (k === 'data-room' ? roomId
          : (k === 'data-index' ? String(index) : null))
    }
  }));
}
// 模拟绑在具体元素上的监听器
function fireEl(id, type) {
  el(id)._listeners.filter(h => h.t === type).forEach(h => h.fn({ target: el(id), preventDefault() {} }));
}
// 模拟重新渲染后的输入框（桩 DOM 不会真的重绘，要手动清空才算还原现场）
function clearInputs(...ids) { ids.forEach(i => { el(i).value = ''; }); }
// 桩 DOM 不会根据记录预填表单，这里把工程表单整体填成指定内容，
// 免得上一个用例留在桩里的值串到这一个用例
function fillProject(name, price, opts) {
  const o = opts || {};
  el('f-name').value = name;
  el('f-price').value = String(price);
  el('f-date').value = o.date || '';
  el('f-location').value = o.location || '';
  el('f-factory').value = o.factory || '';
  el('f-designer').value = o.designer || '';
}

/* ---------------- 1. 冷启动 ---------------- */

ok('全新启动不报错，账本为空，预选词有默认值', () => {
  eq(T.state.projects.length, 0);
  eq(T.loaded.status, 'new');
  eq(T.state.defaultMode, 'flat', '全新安装默认「直接列柜子」');
  if (!T.state.presets.rooms.length) throw new Error('房间预选词应有默认值');
  if (!T.state.presets.cabinets.length) throw new Error('柜子预选词应有默认值');
});

ok('新建工程的录入方式可以当场选，默认直列', () => {
  T.openNewOrder();
  eq(T.modalCtx.mode, 'flat', '默认应是直列模式');
  click('set-mode', { 'data-value': 'room' });
  eq(T.modalCtx.mode, 'room', '点了「按房间分类」应切换过去');
  click('set-mode', { 'data-value': 'flat' });
  eq(T.modalCtx.mode, 'flat', '还能切回来');
  click('modal-cancel');
});

/* ---------------- 2. 工程 / 房间 / 柜子 ---------------- */

// 场景：一个「按房间分类」的工程，覆盖房间手风琴那一整套交互
ok('新建工程并保存（按房间分类）', () => {
  T.openNewOrder();
  click('set-mode', { 'data-value': 'room' });
  fillProject('卫辉-博士园', 200, { location: '21栋1单元1102', factory: 'XX厂房', designer: '张三' });
  click('modal-save');
  eq(T.state.projects.length, 1, '工程数');
  eq(T.state.projects[0].name, '卫辉-博士园');
  eq(T.state.projects[0].defaultPrice, 200);
  eq(T.state.projects[0].mode, 'room', '录入方式应存下来');
  eq(T.state.defaultMode, 'room', '应记住这次的选择');
  eq(store.has('cabinetAppData_v1'), true, '应已落盘');
});

ok('添加房间', () => {
  const p = T.state.projects[0];
  T.openModal('room', { projectId: p.id });
  el('f-name').value = '厨房';
  click('modal-save');
  eq(p.rooms.length, 1);
  eq(p.rooms[0].name, '厨房');
});

ok('面积计价：2×0.6 ×3 ×200 = 720', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  T.openModal('cabinet', { projectId: p.id, roomId: r.id });
  el('f-name').value = '地柜';
  el('f-width').value = '2';
  el('f-height').value = '0.6';
  el('f-qty').value = '3';
  el('f-price').value = '200';
  click('modal-save');
  eq(r.cabinets.length, 1);
  eq(globalThis.projectFinal(p), 720, '应收');
  eq(globalThis.projectArea(p), 3.6, '面积');
});

ok('切到延米计价保存后，原先填的宽高仍留在记录里', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  T.openModal('cabinet', { projectId: p.id, roomId: r.id });
  el('f-name').value = '高柜';
  el('f-width').value = '1.2';
  el('f-height').value = '2.4';
  click('set-pricing', { 'data-value': 'linear' });   // 中途改成延米计价
  el('f-length').value = '3';
  el('f-qty').value = '1';
  el('f-price').value = '300';
  click('modal-save');

  eq(r.cabinets.length, 2);
  const c = r.cabinets[1];
  eq(c.pricingType, 'linear', '计价方式');
  eq(c.width, 1.2, '切到延米后，原先填的宽不该被抹掉');
  eq(c.height, 2.4, '切到延米后，原先填的高不该被抹掉');
  eq(globalThis.cabinetBaseAmount(c), 900, '延米金额 3m ×1 ×300');
  eq(globalThis.projectFinal(p), 1620, '工程应收 = 两柜之和');
});

ok('「保存并继续」会带上上一笔的数量和单价', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  T.openModal('cabinet', { projectId: p.id, roomId: r.id });
  el('f-name').value = '抽屉柜';
  el('f-width').value = '1';
  el('f-height').value = '1';
  el('f-qty').value = '2';
  el('f-price').value = '100';
  click('modal-save-continue');
  eq(r.cabinets.length, 3, '应已存下这一笔');
  eq(T.modalCtx.pricingType, 'area', '表单应继续用同一种计价方式');
  // 新表单的数量单价应已预填成上一笔的值
  eq(T.modalCtx.draft.area.quantity, '2', '数量应带过来');
  eq(T.modalCtx.draft.area.unitPrice, '100', '单价应带过来');

  // 桩 DOM 不会真的重绘，手动还原成新表单被填写后的样子：
  // 尺寸是空的（不会带过来，避免漏改），数量单价已预填
  clearInputs('f-width', 'f-height');
  el('f-width').value = '1';
  el('f-height').value = '1';
  el('f-qty').value = '2';
  el('f-price').value = '100';
  el('f-name').value = '抽屉柜2';
  click('modal-save');
  const c = r.cabinets[r.cabinets.length - 1];
  eq(c.quantity, 2, '数量应沿用上一笔');
  eq(c.unitPrice, 100, '单价应沿用上一笔');
  eq(globalThis.cabinetBaseAmount(c), 200, '1×1×2×100');
});

ok('杂项与柜子同级：挂到房间上，不再塞进柜子', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  const cabsBefore = r.cabinets.length;

  // 先照旧加一个柜子，拿到"只有柜子"时的小计
  T.openModal('cabinet', { projectId: p.id, roomId: r.id });
  el('f-name').value = '地柜2';
  el('f-width').value = '1';
  el('f-height').value = '1';
  el('f-qty').value = '1';
  el('f-price').value = '100';
  click('modal-save');
  eq(r.cabinets.length, cabsBefore + 1, '柜子数 +1');
  const cabOnly = globalThis.roomSubtotal(r);

  // 柜子表单里已经没有杂项区了 —— 杂项改成直接加到房间
  eq(r.extras.length, 0, '一开始房间里没有杂项');
  click('add-extra', { 'data-room': r.id });
  eq(r.extras.length, 1, '「＋ 杂项」直接加到房间');
  eq(r.extras[0].name, '', '刚点出来的是空行，等用户填');
  eq(r.cabinets.length, cabsBefore + 1, '加杂项不会顺手加柜子');
  const c = r.cabinets[r.cabinets.length - 1];
  eq(globalThis.extrasTotal(c), 0, '柜子身上已经没有杂项这一层');

  // 就地填，失焦即存
  fireExtra('name', r.id, 0, '灯管');
  fireExtra('qty', r.id, 0, '3');
  fireExtra('price', r.id, 0, '10');
  eq(r.extras[0].name, '灯管');
  eq(r.extras[0].qty, 3);
  eq(r.extras[0].price, 10);
  eq(globalThis.extrasTotal(r), 30, '杂项合计 = 3 × 10');
  eq(globalThis.roomSubtotal(r), cabOnly + 30, '房间小计 = 柜子 + 杂项');
  eq(globalThis.cabinetAmount(c), 100, '柜子金额只有柜体，不含杂项');
});

ok('快捷标签：灯管带出 ¥10/个，指纹锁是「套」', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  const n = r.extras.length;

  click('add-extra', { 'data-room': r.id, 'data-value': '灯管' });
  eq(r.extras.length, n + 1);
  eq(r.extras[n].name, '灯管');
  eq(r.extras[n].price, 10, '灯管默认 10 元');
  eq(r.extras[n].unit, '个');

  click('add-extra', { 'data-room': r.id, 'data-value': '指纹锁' });
  eq(r.extras[n + 1].unit, '套', '指纹锁按套算');
  eq(r.extras[n + 1].price, 0, '单价先记 0，界面上显示成空框等用户填');

  // 两条灯管各 3 个 ¥10 = 60，指纹锁还没填单价所以是 0
  fireExtra('qty', r.id, n, '3');
  eq(globalThis.extrasTotal(r), 60);
});

ok('没填内容的空行失焦后被收掉，不留垃圾行', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  const n = r.extras.length;
  click('add-extra', { 'data-room': r.id });
  eq(r.extras.length, n + 1, '空行先加上');
  // 什么都没填就点走（名称、数量、单价都空）
  fireExtra('name', r.id, n, '');
  eq(r.extras.length, n, '空行应被收掉');
});

ok('删除杂项不影响柜子', () => {
  const p = T.state.projects[0], r = p.rooms[0];
  const cabs = r.cabinets.length, n = r.extras.length;
  const sub = globalThis.roomSubtotal(r);
  const gone = globalThis.extraAmount(r.extras[0]);

  click('delete-extra', { 'data-room': r.id, 'data-index': '0' });
  eq(r.extras.length, n - 1, '杂项少一条');
  eq(r.cabinets.length, cabs, '柜子一个不少');
  eq(globalThis.roomSubtotal(r), sub - gone, '小计只少了这一条杂项');
});

/* ---------------- 3. 收款 / 结清 ---------------- */

ok('打开「已结清」把已收回填为应收', () => {
  const p = T.state.projects[0];
  const due = globalThis.projectFinal(p);
  el('settled-check').checked = true;
  fireEl('settled-check', 'change');
  eq(p.paidAmount, due, '已收应等于应收');
  eq(globalThis.projectIsSettled(p), true, '收齐后判定为已结清');
  eq(p.settled, undefined, '不应再持久化 settled 标记');
  eq(globalThis.projectOutstanding(p), 0);
});

ok('关掉「已结清」会把已收清零', () => {
  const p = T.state.projects[0];
  el('settled-check').checked = false;
  fireEl('settled-check', 'change');
  eq(p.paidAmount, 0);
  eq(globalThis.projectIsSettled(p), false);
  el('settled-check').checked = true;
  fireEl('settled-check', 'change');   // 恢复结清，后续用例依赖
  eq(p.paidAmount, globalThis.projectFinal(p));
});

/* ---------------- 4. 折扣 ---------------- */

ok('折扣率输入 9.5 与 95 都表示 95 折', () => {
  const p = T.state.projects[0];
  p.discountType = 'rate';
  fire('input', 'discount-rate', '9.5');
  eq(p.discountRate, 0.95);
  eq(globalThis.discountLabel(p.discountRate), '9.5折');
  fire('input', 'discount-rate', '95');
  eq(p.discountRate, 0.95);
});

ok('打折不会偷偷改动已经收到的钱', () => {
  const p = T.state.projects[0];
  eq(globalThis.projectTotal(p), 2150, '五个柜子 720+900+200+200+130');
  eq(p.paidAmount, 2150, '结清时已收被填成了当时的应收');
  eq(globalThis.projectDiscount(p), 107.5, '2150 的 5%');
  eq(globalThis.projectFinal(p), 2042.5);
  eq(p.paidAmount, 2150, '折扣只影响应收，不该反过来改已收');
  eq(globalThis.projectOutstanding(p), 0, '已收超过应收，未收仍为 0');
  eq(globalThis.projectIsSettled(p), true, '仍然算结清');
});

ok('按优惠金额的折扣分支', () => {
  const p = T.state.projects[0];
  p.discountType = 'amount';
  fire('input', 'discount-amount', '600');
  eq(p.discountAmount, 600);
  eq(globalThis.projectFinal(p), 1550, '2150 - 600');
});

/* ---------------- 5. 导出内容 ---------------- */

ok('账单文本 / PDF HTML / Excel 数据都能构造', () => {
  const p = T.state.projects[0];
  const bill = T.buildBill(p);
  if (bill.indexOf('厨房') === -1) throw new Error('账单里没有房间名');
  if (bill.indexOf('地柜') === -1) throw new Error('账单里没有柜子名');
  if (bill.indexOf('灯管') === -1) throw new Error('账单里没有杂项');

  // 杂项与柜子同级：账单里自己和柜子一行，不是缩进在柜子底下的子行
  const lines = bill.split('\n');
  const exLine = lines.find(l => l.trim().indexOf('灯管') === 0);
  if (!exLine) throw new Error('杂项应自成一行');
  if (/^\s{4}/.test(exLine)) throw new Error('杂项不该缩进成柜子的子行');
  if (exLine.indexOf('¥30') === -1) throw new Error('杂项行没带上金额：' + exLine);

  const pdf = T.buildPrintHTML(p);
  if (pdf.indexOf('<table>') === -1) throw new Error('PDF HTML 缺表格');
  if (pdf.indexOf('extra-tr') === -1) throw new Error('PDF 里杂项行应有自己的样式');

  const x = T.buildExcelData(p);
  if (!x.aoa.length || !x.merges.length) throw new Error('Excel 数据为空');
  if (!x.aoa.some(row => row[0] === '灯管')) throw new Error('Excel 里杂项应自成一行');
});

// 造一个只有柜子/杂项、没有其它信息的最小工程，专供导出格式的断言
function exportFixture(cabinets, extras) {
  return {
    id: 'fx', name: '格式检查', mode: 'flat', defaultPrice: 100,
    discountType: 'none', discountRate: 1, discountAmount: 0, paidAmount: 0, createdAt: Date.now(),
    rooms: [{ id: 'fx-r', name: '', cabinets: cabinets, extras: extras || [] }]
  };
}
const areaCab = { id: 'a1', name: '地柜', pricingType: 'area', width: 2, height: 0.6, quantity: 3, unitPrice: 200 };
const linCab = { id: 'a2', name: '台面', pricingType: 'linear', length: 3, quantity: 1, unitPrice: 300 };

ok('PDF 表格：单位一律写进表头，格子里只留数字', () => {
  const html = T.buildPrintHTML(exportFixture([areaCab], [{ name: '灯管', qty: 6, price: 10, unit: '个' }]));
  // 表头把单位说清楚
  if (html.indexOf('<th>规格(m×m)</th>') === -1) throw new Error('规格表头应带单位');
  if (html.indexOf('<th>数量(个)</th>') === -1) throw new Error('数量表头应带单位');
  // 格子里就别再重复一遍了
  if (html.indexOf('2×0.6m') !== -1) throw new Error('规格格子不该再跟一个 m');
  if (html.indexOf('>2×0.6</td>') === -1) throw new Error('规格应是干净的 2×0.6');
  if (html.indexOf('>3 个</td>') !== -1) throw new Error('柜子数量格子不该再跟一个「个」');
  if (html.indexOf('>3</td>') === -1) throw new Error('柜子数量应只写数字');
  if (html.indexOf('>6</td>') === -1) throw new Error('杂项数量也只写数字');
});

ok('PDF 表格：数量表头按实际用到的单位汇总（个/套）', () => {
  const lock = { name: '指纹锁', qty: 1, price: 480, unit: '套' };
  const html = T.buildPrintHTML(exportFixture([areaCab], [{ name: '灯管', qty: 6, price: 10, unit: '个' }, lock]));
  // 柜子按个、指纹锁按套 —— 表头得把两种都列上，否则那个「1」没人知道是什么
  if (html.indexOf('<th>数量(个/套)</th>') === -1) {
    throw new Error('表头应汇总出个/套，实际：' + html.slice(0, 400));
  }
  // 杂项行自己那格仍然是纯数字，单位交给表头
  if (html.indexOf('>1 套</td>') !== -1) throw new Error('杂项格子不该再跟一个「套」');

  // 杂项换了别的单位，表头跟着走，不会出现没说法的数字
  const meter = T.buildPrintHTML(exportFixture([areaCab], [{ name: '封边', qty: 2, price: 5, unit: '米' }]));
  if (meter.indexOf('<th>数量(个/米)</th>') === -1) throw new Error('表头应跟着杂项单位走');
});

ok('PDF 表格：全表一种计价方式时，基准写进表头', () => {
  // 用户最常遇到的情况：一个工程全是面积计价
  const html = T.buildPrintHTML(exportFixture([areaCab]));
  if (html.indexOf('<th>单价(元/m²)</th>') === -1) throw new Error('表头应带上计价基准');
  // 表头已经说清楚了，格子里就别再重复一遍
  if (html.indexOf('元/m²</span>') !== -1) throw new Error('表头写了基准，行里不该再重复');
});

ok('PDF 表格：混用几种计价方式时，基准退回每一行', () => {
  const html = T.buildPrintHTML(exportFixture([areaCab, linCab]));
  if (html.indexOf('<th>单价(元)</th>') === -1) throw new Error('混用时表头只写「元」');
  if (html.indexOf('元/m²</span>') === -1) throw new Error('面积计价的行应标出 元/m²');
  if (html.indexOf('元/m</span>') === -1) throw new Error('延米计价的行应标出 元/m');
});

ok('PDF 表格：杂项自带单位，不受柜子计价方式影响', () => {
  // 表头按柜子写「元/m²」，可灯管是按个卖的 —— 那一行必须自己说清楚
  const html = T.buildPrintHTML(exportFixture([areaCab], [{ name: '灯管', qty: 3, price: 10, unit: '个' }]));
  if (html.indexOf('<th>单价(元/m²)</th>') === -1) throw new Error('表头应跟着柜子的计价方式走');
  if (html.indexOf('元/个</span>') === -1) throw new Error('杂项该按自己的单位标价');
});

ok('PDF 尾部只落一个「应收金额」：不出现已收 / 未收', () => {
  const p = exportFixture([areaCab]);
  p.paidAmount = 500;                     // 客户已经付了一部分
  const html = T.buildPrintHTML(p);

  if (html.indexOf('应收金额') === -1) throw new Error('末尾要有应收金额');
  if (html.indexOf('已收') !== -1) throw new Error('给客户的单子上不该出现「已收」');
  if (html.indexOf('未收') !== -1) throw new Error('给客户的单子上不该出现「未收」');
  // 应收金额只出现一次，别在表格行和页脚里各写一遍
  eq(html.split('应收金额').length - 1, 1, '应收金额应只出现一次');
});

ok('Excel 表头：只用一种计价方式时把基准写进表头，混用则退回「元」', () => {
  const headerOf = p => {
    const row = T.buildExcelData(p).aoa.find(r => r[0] === '名称');
    if (!row) throw new Error('没找到表头行');
    return row;
  };

  const one = headerOf(exportFixture([areaCab]));
  eq(one[1], '规格(m×m)', '规格表头应带单位');
  eq(one[2], '数量(个)', '数量表头应带单位');
  eq(one[4], '单价(元/m²)', '只有面积计价，基准可以写进表头');
  // 柜子的规格格子是纯数字，Excel 里也别混进一个字符串 'm'
  eq(T.buildExcelData(exportFixture([areaCab])).aoa.find(r => r[0] === '地柜')[1], '2×0.6', '规格格子不带 m');

  eq(headerOf(exportFixture([linCab]))[4], '单价(元/m)', '只有延米计价');

  const mixed = headerOf(exportFixture([areaCab, linCab]));
  eq(mixed[4], '单价(元)', '混着好几种计价方式时表头只写「元」');

  // 固定金额没有单价，不该因此把表头写成「单价(元/)」
  eq(headerOf(exportFixture([{ id: 'f', name: '一口价', pricingType: 'fixed', fixedAmount: 999 }]))[4],
    '单价(元)', '固定金额的基准是空，不能拼出个空括号');
});

ok('PDF 和 Excel 的单价表头口径一致', () => {
  // 两个出口共用 priceColumn，不该出现一个写「元/m²」另一个写「元」的情况
  [[areaCab], [linCab], [areaCab, linCab], [{ id: 'f', name: '一口价', pricingType: 'fixed', fixedAmount: 1 }]]
    .forEach(cabs => {
      const p = exportFixture(cabs);
      const xlsHeader = T.buildExcelData(p).aoa.find(r => r[0] === '名称')[4];
      if (T.buildPrintHTML(p).indexOf('<th>' + xlsHeader + '</th>') === -1) {
        throw new Error('两边表头对不上：Excel 是「' + xlsHeader + '」，PDF 里找不到');
      }
    });
});

ok('柜子名以 = + - @ 开头时会被加撇号（挡掉 Excel 公式注入）', () => {
  const evil = JSON.parse(JSON.stringify(T.state.projects[0]));
  evil.rooms[0].cabinets[0].name = '=1+1';
  evil.rooms[0].cabinets[1].name = '@SUM(A1)';
  evil.rooms[0].cabinets[2].name = '-2+3';
  const flat = JSON.stringify(T.buildExcelData(evil).aoa);
  if (flat.indexOf("\"'=1+1") === -1) throw new Error('= 开头未加撇号');
  if (flat.indexOf("'@SUM(A1)") === -1) throw new Error('@ 开头未加撇号');
  if (flat.indexOf("'-2+3") === -1) throw new Error('- 开头未加撇号');

  // 正常名字不该被改动
  const good = JSON.parse(JSON.stringify(T.state.projects[0]));
  if (JSON.stringify(T.buildExcelData(good).aoa).indexOf('"地柜"') === -1) {
    throw new Error('正常名字被误加了撇号');
  }
});

/* ---------------- 6. 存储往返 ---------------- */

ok('打字期间的改动会在 flushSave 时落盘（防抖不能吞数据）', () => {
  T.flushSave();
  const stored = JSON.parse(store.get('cabinetAppData_v1'));
  eq(stored.projects[0].discountType, 'amount', '折扣类型应已落盘');
  eq(stored.projects[0].discountAmount, 600, '优惠金额应已落盘');
  eq(stored.projects[0].paidAmount, 2150, '已收应已落盘');
});

// 递归按键名排序后序列化，只比较内容，不受字段顺序影响
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(k => { out[k] = canon(v[k]); });
    return out;
  }
  return v;
}
const json = v => JSON.stringify(canon(v));

ok('写盘后重新解析，数据完全一致', () => {
  T.flushSave();
  const before = json(T.state.projects);
  const reparsed = T.normalizeState(JSON.parse(store.get('cabinetAppData_v1')));
  eq(json(reparsed.projects), before, '往返后应一致');
});

ok('normalizeState 是幂等的', () => {
  const once = T.normalizeState(JSON.parse(store.get('cabinetAppData_v1')));
  const twice = T.normalizeState(JSON.parse(JSON.stringify(once)));
  eq(json(twice), json(once));
});

/* ---------------- 7. 脏数据 ---------------- */

ok('normalizeState 能扛住各种垃圾输入', () => {
  const dirty = {
    projects: [null, 'abc', 42,
      { name: 123, rooms: 'not-an-array', discountRate: 'x', paidAmount: -5, discountType: '??' },
      { rooms: [null, { cabinets: null }, { cabinets: [{ pricingType: 'wat', extras: 'nope', width: '2', height: '1' }] }] }]
  };
  const s = T.normalizeState(dirty);
  eq(s.projects.length, 2, '应过滤掉非对象');
  eq(s.projects[0].name, '123');
  eq(s.projects[0].rooms.length, 0, 'rooms 非数组应补成空数组');
  eq(s.projects[0].paidAmount, 0, '负数已收归零');
  eq(s.projects[0].discountRate, 1, '非法折扣率回落原价');
  eq(s.projects[1].rooms.length, 2);
  eq(s.projects[1].rooms[1].cabinets.length, 1);
  eq(s.projects[1].rooms[1].cabinets[0].pricingType, 'area', '未知计价方式回落面积');
  // 杂项已经不在柜子层级了：脏数据里的 c.extras 直接丢掉，房间里补成空数组
  eq(s.projects[1].rooms[1].cabinets[0].extras, undefined, '柜子上的 extras 应被清掉');
  eq(s.projects[1].rooms[0].extras.length, 0, '房间的 extras 缺失时应补成空数组');
});

ok('老数据：挂在柜子上的杂项会被搬到房间里，钱一分不少', () => {
  const s = T.normalizeState({
    projects: [{
      name: '老工程', mode: 'room', defaultPrice: 50,
      rooms: [{
        name: '厨房',
        cabinets: [
          { name: '地柜', pricingType: 'fixed', fixedAmount: 1000, extras: [{ name: '灯管', qty: 3, price: 10 }] },
          { name: '吊柜', pricingType: 'fixed', fixedAmount: 500, extras: [{ name: '指纹锁', qty: 1, price: 500 }] }
        ]
      }]
    }]
  });
  const r = s.projects[0].rooms[0];
  eq(r.extras.length, 2, '两条杂项都搬到了房间上');
  eq(r.extras[0].name, '灯管');
  eq(r.extras[1].name, '指纹锁');
  eq(r.cabinets[0].extras, undefined, '柜子上不再留 extras');
  eq(globalThis.projectTotal(s.projects[0]), 1000 + 30 + 500 + 500, '总额不变');
});

ok('损坏的 JSON 不会被静默丢弃（进抢救流程）', () => {
  store.set('cabinetAppData_v1', '{不是合法json');
  const res = vm.runInThisContext(
    '(function(){ var r = load(); return { status: r.status,' +
    ' rescue: localStorage.getItem("cabinetAppData_v1_rescue") }; })()');
  eq(res.status, 'corrupt');
  eq(res.rescue, '{不是合法json', '原始数据必须另存一份');
  store.set('cabinetAppData_v1', JSON.stringify(T.state));   // 复原
});

/* ---------------- 8. 复制 ---------------- */

ok('复制柜子 / 复制房间会生成新 id', () => {
  const p = T.state.projects[0];
  click('open-project', { 'data-id': p.id });
  const r = p.rooms[0];
  const nCab = r.cabinets.length, nRoom = p.rooms.length;

  click('copy-cabinet', { 'data-id': r.cabinets[0].id, 'data-room': r.id });
  eq(r.cabinets.length, nCab + 1, '柜子数 +1');
  if (r.cabinets[nCab].id === r.cabinets[0].id) throw new Error('副本的 id 必须不同');
  eq(r.cabinets[nCab].name, r.cabinets[0].name + '（副本）');

  click('copy-room', { 'data-id': r.id });
  eq(p.rooms.length, nRoom + 1, '房间数 +1');
  const clone = p.rooms[nRoom];
  if (clone.id === r.id) throw new Error('房间副本的 id 必须不同');
  if (clone.cabinets[0].id === r.cabinets[0].id) throw new Error('房间副本里的柜子 id 也必须重排');
});

/* ---------------- 9. 删除 ---------------- */

ok('删除柜子 / 房间', () => {
  const p = T.state.projects[0];
  const r = p.rooms[0];
  const n = r.cabinets.length;
  click('delete-cabinet', { 'data-id': r.cabinets[0].id, 'data-room': r.id });
  eq(r.cabinets.length, n - 1);
  const nRoom = p.rooms.length;
  click('delete-room', { 'data-id': p.rooms[p.rooms.length - 1].id });
  eq(p.rooms.length, nRoom - 1);
});

/* ---------------- 10. 主题 / 分类 ---------------- */

ok('切换主题色', () => {
  click('set-theme', { 'data-value': 'violet' });
  eq(T.state.theme, 'violet');
  click('set-theme', { 'data-value': 'teal' });
  eq(T.state.theme, 'teal');
});

ok('分类词可以增删', () => {
  T.renderCategory();
  click('add-preset-item', { 'data-kind': 'room', 'data-gi': '0' });
  el('f-name').value = '保姆房';
  click('modal-save');
  const g = T.state.presets.rooms[0];
  if (g.items.indexOf('保姆房') === -1) throw new Error('新分类词没加上');

  const idx = g.items.indexOf('保姆房');
  click('del-preset-item', { 'data-kind': 'room', 'data-gi': '0', 'data-ii': String(idx) });
  if (T.state.presets.rooms[0].items.indexOf('保姆房') !== -1) throw new Error('分类词没删掉');
});

ok('「房间分类」卡片只在有按房间录入的工程时才显示', () => {
  const keep = T.state.projects;
  try {
    T.state.projects = [];
    T.renderCategory();
    eq(el('category-rooms-card').hidden, false, '一个工程都没有时应保留');

    T.state.projects = [{ id: 'x', name: 'A', mode: 'flat', rooms: [] }];
    T.renderCategory();
    eq(el('category-rooms-card').hidden, true, '全是直列工程应收起');

    T.state.projects = [
      { id: 'x', name: 'A', mode: 'flat', rooms: [] },
      { id: 'y', name: 'B', mode: 'room', rooms: [] }
    ];
    T.renderCategory();
    eq(el('category-rooms-card').hidden, false, '有一个房间模式的工程就该显示');
  } finally {
    T.state.projects = keep;
    T.renderCategory();
  }
});

/* ---------------- 11. 统计 ---------------- */

ok('统计页数据可算出且渲染不报错', () => {
  const s = T.computeStats();
  eq(s.count, 1);
  if (!(s.totalFinal > 0)) throw new Error('应收合计应大于 0');
  if (!s.byProject.length || !s.byRoom.length) throw new Error('排行数据为空');
  T.renderStats();
});

ok('年报数据：同名柜子/杂项合并计数，金额相加', () => {
  const keep = T.state.projects;
  try {
    // 用一份干净的数据来验归并逻辑：攒下来的那堆 fixture 名字被增删改得七零八落，
    // 拿它当断言依据只会越写越脆
    T.state.projects = [{
      id: 'stat-a', name: '统计样例', mode: 'flat', defaultPrice: 100,
      discountType: 'none', discountRate: 1, discountAmount: 0, paidAmount: 0, createdAt: Date.now(),
      rooms: [{
        id: 'stat-r', name: '',
        cabinets: [
          { id: 'c1', name: '地柜', pricingType: 'fixed', fixedAmount: 720, quantity: 1 },
          { id: 'c2', name: '地柜', pricingType: 'fixed', fixedAmount: 100, quantity: 1 },
          { id: 'c3', name: '吊柜', pricingType: 'fixed', fixedAmount: 500, quantity: 1 }
        ],
        extras: [
          { name: '灯管', qty: 3, price: 10, unit: '个' },
          { name: '灯管', qty: 1, price: 10, unit: '个' }
        ]
      }]
    }];
    const s = T.computeStats();
    eq(s.totalCabs, 3, '柜子总数');
    eq(s.byCabinet.length, 2, '两个柜子名 → 两项');
    eq(s.byCabinet[0].label, '地柜', '按金额降序，地柜在前');
    eq(s.byCabinet[0].count, 2, '同名柜子合并计数');
    eq(s.byCabinet[0].value, 820, '720 + 100');
    eq(s.byCabinet[1].label, '吊柜');
    eq(s.byCabinet[1].count, 1);
    eq(s.favorite.label, '地柜', '出现次数最多的当王牌柜子');

    eq(s.totalExtras, 2, '杂项总数');
    eq(s.byExtra[0].label, '灯管');
    eq(s.byExtra[0].count, 2, '同名杂项也合并计数');
    eq(s.byExtra[0].value, 40, '3×10 + 1×10');

    eq(s.biggest.label, '统计样例', '只有一单时它就是最大的一单');
    eq(s.settledCount, 0, '一分钱没收到，不算结清');
    eq(s.peak, null, '没填装修日期就没有"最忙的月份"');
  } finally {
    T.state.projects = keep;
    T.renderStats();
  }
});

ok('年报数据：高光时刻的取值都落在合理范围内', () => {
  const s = T.computeStats();
  if (!(s.totalCabs > 0)) throw new Error('应统计到柜子数');
  if (!s.byCabinet.length) throw new Error('柜子排行不该为空');
  if (!(s.totalExtras > 0)) throw new Error('杂项总数应大于 0');

  s.byCabinet.concat(s.byExtra).forEach(x => {
    if (!(x.count > 0) || !(x.value > 0)) throw new Error('排行项缺 count/value：' + JSON.stringify(x));
  });

  eq(s.settledCount, 1, '前面的用例把唯一一个工程结清了');
  eq(s.biggest.label, s.byProject[0].label, 'biggest 应是金额最大的那一单');
  eq(s.favorite.count, Math.max(...s.byCabinet.map(x => x.count)), 'favorite 应是出现次数最多的柜子');
  if (typeof s.earliestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.earliestDate)) {
    throw new Error('earliestDate 应格式化成 YYYY-MM-DD，实际：' + s.earliestDate);
  }
});

ok('年报 UI：高光时刻 / 柜子排行 / 成就牌都渲染出来了', () => {
  T.renderStats();
  const html = el('stats-body').innerHTML;
  ['你和柜子的故事', '高光时刻', '当家花旦', 'achieve-tile', 'annual-foot']
    .forEach(k => {
      if (html.indexOf(k) === -1) throw new Error('统计页里少了「' + k + '」');
    });
});

/* ---------------- 12. 快照 / 恢复 ---------------- */

ok('删除工程前留快照，可原样恢复', () => {
  const p = T.state.projects[0];
  click('open-project', { 'data-id': p.id });
  T.snapshotCurrent('before-delete');
  T.state.projects = T.state.projects.filter(x => x.id !== p.id);
  eq(T.state.projects.length, 0);

  const snap = T.readSnapshot();
  if (!snap) throw new Error('没有读到快照');
  eq(snap.data.projects.length, 1, '快照里应保留删除前的工程');
  T.state = T.normalizeState(snap.data);
  eq(T.state.projects.length, 1, '恢复成功');
  eq(globalThis.projectFinal(T.state.projects[0]), 1550, '恢复后金额一致');
});

/* ---------------- 13. 直列模式（不建房间，直接录柜子） ---------------- */

function flatProject() { return T.state.projects.find(x => x.name === '郑州-碧桂园'); }

ok('新建工程会记住上次选的录入方式，这次手选直列', () => {
  T.openNewOrder();
  eq(T.modalCtx.mode, 'room', '上一个工程选了按房间分类，这次应默认它');
  click('set-mode', { 'data-value': 'flat' });
  fillProject('郑州-碧桂园', 150);
  click('modal-save');
  const p = flatProject();
  if (!p) throw new Error('工程没建出来');
  eq(p.mode, 'flat');
  eq(p.rooms.length, 0, '直列工程不需要预先建房间');
  eq(T.state.defaultMode, 'flat', '下次新建应默认直列');
});

ok('直列模式：不用选房间，直接加柜子', () => {
  const p = flatProject();
  click('open-project', { 'data-id': p.id });
  click('add-cabinet');           // 没有房间可传
  eq(T.modalCtx.roomId !== null && T.modalCtx.roomId !== undefined, true, '应自动派一个容器房间');
  el('f-name').value = '地柜';
  el('f-width').value = '3';
  el('f-height').value = '0.8';
  el('f-qty').value = '1';
  el('f-price').value = '150';
  click('modal-save');

  eq(projectCabCount(p), 1, '柜子应存进去');
  eq(globalThis.projectFinal(p), 360, '3×0.8×1×150');
  eq(p.rooms.length, 1, '应自动建了一个容器房间');
  eq(p.rooms[0].name, '', '容器房间不该有名字（否则会露出房间层级）');
});

ok('直列模式：账单和 Excel 里不出现房间分组', () => {
  const p = flatProject();
  const bill = T.buildBill(p);
  if (bill.indexOf('▍') !== -1) throw new Error('账单里不该有房间分组标题');
  if (bill.indexOf('地柜') === -1) throw new Error('账单里应有柜子');
  if (T.buildPrintHTML(p).indexOf('room-row') !== -1) throw new Error('PDF 里不该有房间行');
  // Excel 里那几行单格的分组标题是合并单元格，直列模式下合并数应该更少
  const x = T.buildExcelData(p);
  if (!x.aoa.length) throw new Error('Excel 数据为空');

  // 对照：按房间分类的工程必须有分组标题
  const roomed = T.state.projects.find(x => x.name === '卫辉-博士园');
  if (T.buildBill(roomed).indexOf('▍厨房') === -1) throw new Error('房间模式的账单里应有房间分组');
});

ok('直列 ↔ 房间模式来回切换，柜子和金额都不变', () => {
  const p = flatProject();
  const before = globalThis.projectFinal(p);
  const beforeBill = T.buildBill(p);

  const open = mode => {
    T.openModal('project', { projectId: p.id });
    click('set-mode', { 'data-value': mode });
    fillProject(p.name, p.defaultPrice);
    click('modal-save');
  };

  open('room');
  eq(p.mode, 'room');
  eq(projectCabCount(p), 1, '切模式不该丢柜子');
  eq(globalThis.projectFinal(p), before, '金额不该变');

  open('flat');
  eq(p.mode, 'flat');
  eq(T.buildBill(p), beforeBill, '账单内容应完全一致');
});

ok('渲染：只有房间模式才输出房间层级，按钮也跟着换', () => {
  const flatP = flatProject();
  click('open-project', { 'data-id': flatP.id });
  const flatHTML = el('room-list').innerHTML;
  if (flatHTML.indexOf('class="card room') !== -1) throw new Error('直列模式不该渲染房间卡片');
  if (flatHTML.indexOf('room-head') !== -1) throw new Error('直列模式不该有房间标题');
  if (flatHTML.indexOf('class="cab"') === -1) throw new Error('直列模式应把柜子直接列出来');
  eq(el('add-room-btn').hidden, true, '直列模式应隐藏「添加房间」');
  eq(el('add-cabinet-btn').hidden, false, '直列模式应显示「添加柜子」');

  const roomP = T.state.projects.find(x => x.name === '卫辉-博士园');
  click('open-project', { 'data-id': roomP.id });
  const roomHTML = el('room-list').innerHTML;
  if (roomHTML.indexOf('room-head') === -1) throw new Error('房间模式应渲染房间标题');
  if (roomHTML.indexOf('cab-list') === -1) throw new Error('房间模式应渲染柜子列表');
  eq(el('add-room-btn').hidden, false, '房间模式应显示「添加房间」');
  eq(el('add-cabinet-btn').hidden, true, '房间模式由每个房间自带添加按钮');
});

ok('直列模式：统计不显示只有「未分类」一行的房间分布', () => {
  const s = T.computeStats();
  eq(s.hasFlat, true);
  // 「厨房」来自按房间分类的那个工程；直列工程的柜子不该混进房间维度
  const names = s.byRoom.map(x => x.label);
  if (names.indexOf('') !== -1) throw new Error('无名容器房间不该出现在房间分布里');
  if (names.indexOf('厨房') === -1) throw new Error('有名字的房间应该保留');
  T.renderStats();
});

/* ---------------- 14. 清空 / 备份提醒 ---------------- */

ok('清空数据后视图回到首页，快照仍保留', () => {
  T.snapshotCurrent('before-clear');
  T.state = T.defaultState();
  T.initPresets();
  T.resetView();
  eq(T.state.projects.length, 0);
  eq(T.currentProjectId, null, '不应残留工程 id');
  T.renderHome();
  if (!T.readSnapshot()) throw new Error('清空前应留快照');
});

ok('备份提醒：没备份过提醒、点过「稍后」不提醒、没工程不提醒', () => {
  T.state.projects = [];
  eq(T.shouldRemindBackup(), false, '没有工程不该提醒');
  T.state.projects = [{ id: 'x', name: 'A', createdAt: Date.now(), rooms: [] }];
  eq(T.shouldRemindBackup(), true, '没备份过应提醒');
  T.state.lastBackupAt = Date.now();
  eq(T.shouldRemindBackup(), false, '刚备份过不该提醒');
  T.state.lastBackupAt = Date.now() - 8 * 86400000;
  eq(T.shouldRemindBackup(), true, '超过 7 天应提醒');
  T.state.backupSnoozeUntil = Date.now() + 86400000;
  eq(T.shouldRemindBackup(), false, '点过「稍后」当天不再提醒');
});

/* ---------------- 15. 「⋯」更多菜单 / 折叠的工程信息卡 ---------------- */

// 造一个干净的工程并进入详情页，供下面几个用例共用
function freshProject(name, opts) {
  T.state = T.defaultState();
  T.initPresets();
  T.openNewOrder();
  fillProject(name, 100, opts || {});
  click('modal-save');
  const p = T.state.projects[0];
  click('open-project', { 'data-id': p.id });
  return p;
}

ok('导出按钮已从正文挪进「⋯」菜单，页面上不再留按钮', () => {
  const html = fs.readFileSync(root + 'index.html', 'utf8');
  ['copy-bill', 'print-bill', 'export-pdf', 'export-excel'].forEach(a => {
    if (html.indexOf('data-action="' + a + '"') !== -1) {
      throw new Error('导出按钮不该还留在 index.html 的正文里：' + a);
    }
  });
  // 底部那个显眼的删除按钮也收进菜单了
  if (html.indexOf('data-action="delete-project"') !== -1) {
    throw new Error('删除工程不该还是页面上一个大按钮');
  }
  // 折叠卡里的输入框 id 必须保留 —— 实时监听器绑在它们身上，换成不渲染就会绑空
  ['default-price', 'paid-amount', 'settled-check', 'proj-settings-body']
    .forEach(id => {
      if (html.indexOf('id="' + id + '"') === -1) throw new Error('折叠卡里少了 id=' + id);
    });
});

ok('「⋯」菜单：四个导出项都在，删除工程也在，且都带上了收菜单的标记', () => {
  freshProject('菜单测试', { designer: '李四' });
  click('more-menu');
  const menu = el('sheet').innerHTML;
  ['copy-bill', 'print-bill', 'export-pdf', 'export-excel', 'delete-project'].forEach(a => {
    if (menu.indexOf('data-action="' + a + '"') === -1) throw new Error('菜单里缺 ' + a);
    // 每一项都必须能自己把菜单收掉，否则点完菜单还挂在那儿遮着页面
    const at = menu.indexOf('data-action="' + a + '"');
    if (menu.slice(at, at + 120).indexOf('data-close-modal') === -1) {
      throw new Error(a + ' 忘了带 data-close-modal');
    }
  });
  // 菜单标题应带上工程名，免得点错了工程自己还不知道
  if (menu.indexOf('菜单测试') === -1) throw new Error('菜单标题应显示工程名');
});

ok('从菜单删除工程：先收菜单，再走确认流程', () => {
  const p = freshProject('待删除');
  T.snapshotCurrent('before-delete');
  click('delete-project', { 'data-close-modal': '1', 'data-id': p.id });
  eq(T.state.projects.length, 0, '工程应已删除');
  eq(T.currentProjectId, null, '删完应退回首页状态');
  eq(T.modalCtx, null, '菜单应已收掉');
  if (!T.readSnapshot()) throw new Error('删除前应留一份快照');
});

ok('「工程信息与收款」默认收起，点一下展开，再点收起', () => {
  freshProject('折叠卡测试', { designer: '王五' });
  eq(el('proj-settings-body').hidden, true, '进工程时应是收起的');
  // 收起不等于什么都不说：卡头右边要带一句摘要
  const sub = el('proj-settings-sub').textContent;
  if (sub.indexOf('王五') === -1) throw new Error('摘要里应带出设计师，实际：' + sub);

  click('toggle-project-settings');
  eq(el('proj-settings-body').hidden, false, '点一下应展开');

  click('toggle-project-settings');
  eq(el('proj-settings-body').hidden, true, '再点应收起');
});

ok('收起状态下卡片里的输入照样写得进模型', () => {
  const p = freshProject('收起可输入');
  eq(el('proj-settings-body').hidden, true, '前提：卡片是收起的');

  el('default-price').value = '180';
  fireEl('default-price', 'change');
  eq(p.defaultPrice, 180, '收起时改默认单价仍应生效');

  el('paid-amount').value = '300';
  fireEl('paid-amount', 'input');
  eq(p.paidAmount, 300, '收起时填已收仍应生效');
});

ok('重新进入工程时折叠卡回到收起状态', () => {
  const p = freshProject('状态复位');
  click('toggle-project-settings');
  eq(el('proj-settings-body').hidden, false, '先展开');

  click('back-home');
  click('open-project', { 'data-id': p.id });
  eq(el('proj-settings-body').hidden, true, '重新进来应是收起的');
});

/* ---------------- 汇总 ---------------- */

console.log('');
if (fails.length) {
  console.log('✗ ' + fails.length + ' 个用例失败，' + pass + ' 个通过\n');
  fails.forEach(f => console.log('  ✗ ' + f + '\n'));
  process.exit(1);
} else {
  console.log('✓ 冒烟测试全部 ' + pass + ' 个用例通过');
  console.log('');
  process.exit(0);
}
