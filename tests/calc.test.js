/* ============================================================
 * 计算核心单元测试
 *   运行： node tests/calc.test.js
 *   无任何依赖，只用 Node 内置的 assert。
 *
 * 这里盯的是"会算错钱"的地方：四种计价方式、杂项、折扣钳制、
 * 浮点误差、以及"账单上各行相加是否等于小计"。
 * ============================================================ */
'use strict';

const assert = require('assert');
const calc = require('../js/calc.js');

let passed = 0;
const failures = [];

function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failures.push({ name, message: err.message }); }
}
// 金额断言：先按 2 位小数收敛，避免测试自己写出浮点噪声
function eq(actual, expected, label) {
  assert.strictEqual(calc.r2(actual), calc.r2(expected),
    (label || '值') + ' 期望 ' + calc.r2(expected) + '，实际 ' + calc.r2(actual));
}

/* ---------- 测试夹具 ---------- */

const cab = o => Object.assign({
  id: 'c', name: '柜子', pricingType: 'area', width: 0, height: 0,
  length: 0, quantity: 1, unitPrice: 0, fixedAmount: 0
}, o);

// 杂项挂在房间上（extras），与柜子同级
const room = (name, ...cabinets) => ({ id: 'r-' + name, name, cabinets, extras: [] });
const proj = (...rooms) => ({ id: 'p', name: '工程', rooms, defaultPrice: 50 });

/* ---------- 1. 四种计价方式 ---------- */

t('面积计价：宽×高×数量×单价', () => {
  eq(calc.cabinetBaseAmount(cab({ width: 2, height: 0.6, quantity: 3, unitPrice: 200 })), 720);
});

t('面积计价：宽高为 0 时金额为 0', () => {
  eq(calc.cabinetBaseAmount(cab({ width: 0, height: 0, quantity: 3, unitPrice: 200 })), 0);
});

t('延米计价：长度×数量×单价', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'linear', length: 2.4, quantity: 2, unitPrice: 300 })), 1440);
});

t('延米计价：缺 length 字段的老数据回退用 width', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'linear', width: 2.5, length: undefined, quantity: 1, unitPrice: 100 })), 250);
});

t('延米计价：length 为空串时回退用 width', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'linear', width: 2.5, length: '', quantity: 1, unitPrice: 100 })), 250);
});

t('按件计价：数量×单价', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'unit', quantity: 5, unitPrice: 80 })), 400);
});

t('固定金额：与尺寸数量无关', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'fixed', fixedAmount: 1234.5, width: 9, height: 9, quantity: 9, unitPrice: 999 })), 1234.5);
});

t('未知 pricingType 回退为面积计价', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'wat', width: 2, height: 1, quantity: 1, unitPrice: 100 })), 200);
  assert.strictEqual(calc.cabinetPricingType({ pricingType: 'wat' }), 'area');
});

t('数量为 0 时金额为 0（不再被悄悄改成 1）', () => {
  eq(calc.cabinetBaseAmount(cab({ width: 2, height: 1, quantity: 0, unitPrice: 100 })), 0);
});

/* ---------- 2. 杂项（挂在房间上，与柜子同级） ---------- */

t('杂项合计 = Σ 数量×单价', () => {
  eq(calc.extrasTotal([
    { name: '灯管', qty: 3, price: 10 },
    { name: '指纹锁', qty: 1, price: 500 }
  ]), 530);
});

t('杂项传房间对象也能算（取 .extras）', () => {
  eq(calc.extrasTotal({ extras: [{ name: '灯管', qty: 3, price: 10 }] }), 30);
});

t('杂项缺失 / 非法值时按 0 处理', () => {
  eq(calc.extrasTotal(undefined), 0);
  eq(calc.extrasTotal({ extras: undefined }), 0);
  eq(calc.extrasTotal([{ name: 'x', qty: '', price: null }]), 0);
  eq(calc.extrasTotal('不是数组'), 0);
});

t('单条杂项金额 = 数量 × 单价，取整到分', () => {
  eq(calc.extraAmount({ qty: 3, price: 10.1 }), 30.3);
  assert.strictEqual(calc.extraAmount({ qty: 3, price: 0.1 }), 0.3);   // 0.30000000000000004 → 0.3
  assert.strictEqual(calc.extraAmount(null), 0);
});

t('柜子金额只算柜体本身，不再包含杂项', () => {
  const c = cab({ width: 2, height: 1, quantity: 1, unitPrice: 100 });
  eq(calc.cabinetAmount(c), 200);
  // 即使是老数据（杂项还挂在柜子上），柜子金额也不再把它算进去
  eq(calc.cabinetAmount(Object.assign({}, c, { extras: [{ name: '灯管', qty: 2, price: 10 }] })), 200);
});

t('房间小计 = 房里柜子 + 本房间杂项', () => {
  const r = room('厨房',
    cab({ width: 2, height: 1, quantity: 1, unitPrice: 100 }),
    cab({ pricingType: 'fixed', fixedAmount: 50 }));
  r.extras = [{ name: '灯管', qty: 3, price: 10 }, { name: '指纹锁', qty: 1, price: 500 }];
  eq(calc.roomSubtotal(r), 200 + 50 + 530);
});

t('杂项不计入面积（灯管再贵也不会让房子变大）', () => {
  const r = room('厨房', cab({ width: 2, height: 1, quantity: 1, unitPrice: 100 }));
  r.extras = [{ name: '灯管', qty: 10, price: 10 }];
  assert.strictEqual(calc.roomArea(r), 2);
  eq(calc.roomSubtotal(r), 200 + 100);
});

t('杂项条数只数有名字的，空行不算', () => {
  assert.strictEqual(calc.extraCount([{ name: '灯管' }, { name: '  ' }, { name: '' }, null]), 1);
  assert.strictEqual(calc.extraCount(undefined), 0);
});

/* ---------- 3. 面积口径 ---------- */

t('只有面积计价才计入工程面积', () => {
  assert.strictEqual(calc.cabinetAreaContribution(cab({ pricingType: 'area', width: 2, height: 0.6, quantity: 3 })), 3.6);
  assert.strictEqual(calc.cabinetAreaContribution(cab({ pricingType: 'linear', width: 2, height: 0.6, quantity: 3, length: 3 })), 0);
  assert.strictEqual(calc.cabinetAreaContribution(cab({ pricingType: 'unit', width: 2, height: 0.6, quantity: 3 })), 0);
  assert.strictEqual(calc.cabinetAreaContribution(cab({ pricingType: 'fixed', width: 2, height: 0.6, quantity: 3 })), 0);
});

t('工程面积 = 各房间面积之和', () => {
  const p = proj(
    room('厨房', cab({ width: 2, height: 0.7, quantity: 2 })),
    room('主卧', cab({ width: 3, height: 2.4, quantity: 1 }))
  );
  assert.strictEqual(calc.projectArea(p), 2 * 0.7 * 2 + 3 * 2.4);
});

/* ---------- 4. 汇总层级 ---------- */

t('房间小计 = 各柜子金额之和', () => {
  const r = room('厨房',
    cab({ width: 2, height: 0.7, quantity: 1, unitPrice: 200 }),
    cab({ pricingType: 'unit', quantity: 2, unitPrice: 150 }));
  eq(calc.roomSubtotal(r), 280 + 300);
});

t('工程原始金额 = 各房间小计之和', () => {
  const p = proj(
    room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 })),
    room('B', cab({ pricingType: 'fixed', fixedAmount: 250 })));
  eq(calc.projectTotal(p), 350);
});

t('空工程 / 缺字段工程不抛错且金额为 0', () => {
  eq(calc.projectTotal({}), 0);
  eq(calc.projectTotal({ rooms: [{ name: 'A' }] }), 0);
  eq(calc.projectArea({ rooms: null }), 0);
  assert.strictEqual(calc.projectCabCount({ rooms: [{ cabinets: [cab({}), cab({})] }] }), 2);
});

/* ---------- 5. 折扣 ---------- */

t('无折扣', () => {
  const p = proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 })));
  eq(calc.projectDiscount(p), 0);
  eq(calc.projectFinal(p), 100);
});

t('按折扣率：95 折', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { discountType: 'rate', discountRate: 0.95 });
  eq(calc.projectDiscount(p), 5);
  eq(calc.projectFinal(p), 95);
});

t('按折扣率：1 折', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { discountType: 'rate', discountRate: 0.1 });
  eq(calc.projectFinal(p), 10);
});

t('折扣率超出 0~1 会被钳制', () => {
  const base = proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 })));
  eq(calc.projectFinal(Object.assign({}, base, { discountType: 'rate', discountRate: 5 })), 100);
  eq(calc.projectFinal(Object.assign({}, base, { discountType: 'rate', discountRate: -3 })), 0);
  eq(calc.projectFinal(Object.assign({}, base, { discountType: 'rate', discountRate: 'abc' })), 100);
});

t('按优惠金额：正常扣减', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { discountType: 'amount', discountAmount: 30 });
  eq(calc.projectDiscount(p), 30);
  eq(calc.projectFinal(p), 70);
});

t('按优惠金额：超过原价时封顶，应收不为负', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { discountType: 'amount', discountAmount: 999 });
  eq(calc.projectDiscount(p), 100);
  eq(calc.projectFinal(p), 0);
});

t('按优惠金额：负数按 0 处理', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { discountType: 'amount', discountAmount: -50 });
  eq(calc.projectDiscount(p), 0);
});

/* ---------- 6. 收款 ---------- */

t('未收 = 应收 - 已收', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 1000 }))),
    { paidAmount: 400 });
  eq(calc.projectOutstanding(p), 600);
});

t('多收时未收为 0，不显示负数', () => {
  const p = Object.assign(proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }))),
    { paidAmount: 500 });
  eq(calc.projectOutstanding(p), 0);
});

t('已收为负 / 非法时按 0 处理', () => {
  const p = proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 })));
  eq(calc.projectPaid(Object.assign({}, p, { paidAmount: -20 })), 0);
  eq(calc.projectPaid(Object.assign({}, p, { paidAmount: 'x' })), 0);
});

t('收满即视为已结清', () => {
  const p = proj(room('A', cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 })));
  assert.strictEqual(calc.projectIsSettled(Object.assign({}, p, { paidAmount: 100 })), true);
  assert.strictEqual(calc.projectIsSettled(Object.assign({}, p, { paidAmount: 99 })), false);
});

t('结清状态完全由金额推导，过期的 settled 标记不能覆盖它', () => {
  // 标记结清后又加了柜子 → 已收 100 < 应收 800，必须重新显示为未收，
  // 否则列表说"已结清"、详情说"未收 ¥700"，用户无法判断该信哪个。
  const p = proj(room('A',
    cab({ width: 1, height: 1, quantity: 1, unitPrice: 100 }),
    cab({ pricingType: 'fixed', fixedAmount: 700 })));
  eq(calc.projectFinal(p), 800);
  assert.strictEqual(calc.projectIsSettled(Object.assign({}, p, { paidAmount: 100, settled: true })), false);
  assert.strictEqual(calc.projectIsSettled(Object.assign({}, p, { paidAmount: 800, settled: false })), true);
});

t('金额为 0 的工程不会被判为已结清', () => {
  assert.strictEqual(calc.projectIsSettled({ rooms: [], paidAmount: 0 }), false);
});

/* ---------- 7. 浮点误差（这是账单最容易被投诉的地方） ---------- */

t('95 折不会产生 89.99999999999999', () => {
  const p = Object.assign(proj(room('A', cab({ pricingType: 'fixed', fixedAmount: 100 }))),
    { discountType: 'rate', discountRate: 0.9 });
  assert.strictEqual(calc.projectFinal(p), 90);
  assert.strictEqual(calc.projectOutstanding(p), 90);
});

t('0.1 + 0.2 这类杂项不会污染账单', () => {
  const r = room('房间');
  r.extras = [{ name: 'a', qty: 1, price: 0.1 }, { name: 'b', qty: 1, price: 0.2 }];
  assert.strictEqual(calc.roomSubtotal(r), 0.3);
});

t('小数单价：0.35 × 3 收敛为 1.05', () => {
  eq(calc.cabinetBaseAmount(cab({ pricingType: 'unit', quantity: 3, unitPrice: 0.35 })), 1.05);
});

t('账单上各行相加 == 小计（分层取整的核心保证）', () => {
  const r = room('房间',
    cab({ width: 1.23, height: 0.77, quantity: 3, unitPrice: 199.9 }),
    cab({ pricingType: 'unit', quantity: 7, unitPrice: 33.33 }),
    cab({ pricingType: 'linear', length: 2.11, quantity: 2, unitPrice: 88.8 }));
  // 账单上柜子行 + 杂项行，加起来必须正好是房间小计
  r.extras = [{ name: 'x', qty: 3, price: 10.1 }, { name: 'y', qty: 2, price: 0.7 }];
  const lineSum = r.cabinets.reduce((s, c) => s + calc.cabinetAmount(c), 0)
    + r.extras.reduce((s, e) => s + calc.extraAmount(e), 0);
  assert.strictEqual(calc.roomSubtotal(r), calc.r2(lineSum), '各行金额之和必须等于房间小计');
});

t('工程总额 = 各房间（柜子 + 杂项）之和', () => {
  const a = room('厨房', cab({ pricingType: 'fixed', fixedAmount: 300 }));
  a.extras = [{ name: '灯管', qty: 3, price: 10 }];
  const b = room('主卧', cab({ pricingType: 'fixed', fixedAmount: 700 }));
  b.extras = [{ name: '指纹锁', qty: 1, price: 500 }];
  eq(calc.projectTotal(proj(a, b)), 300 + 30 + 700 + 500);
});

/* ---------- 8. 折扣文案与输入解析 ---------- */

t('折扣文案', () => {
  assert.strictEqual(calc.discountLabel(1), '原价');
  assert.strictEqual(calc.discountLabel(0.95), '9.5折');
  assert.strictEqual(calc.discountLabel(0.9), '9折');
  assert.strictEqual(calc.discountLabel(0.85), '8.5折');
  assert.strictEqual(calc.discountLabel(0.1), '1折');
  assert.strictEqual(calc.discountLabel(0), '原价');
});

t('折扣输入解析：9.5 / 95 / 9.5折 都等于 0.95', () => {
  assert.strictEqual(calc.parseDiscountInput('9.5'), 0.95);
  assert.strictEqual(calc.parseDiscountInput('95'), 0.95);
  assert.strictEqual(calc.parseDiscountInput('9.5折'), 0.95);
  assert.strictEqual(calc.parseDiscountInput(95), 0.95);
  assert.strictEqual(calc.parseDiscountInput('8'), 0.8);
  assert.strictEqual(calc.parseDiscountInput('10'), 1);
});

t('折扣输入解析：空 / 非法回落到原价，不会莫名其妙免费', () => {
  assert.strictEqual(calc.parseDiscountInput(''), 1);
  assert.strictEqual(calc.parseDiscountInput(null), 1);
  assert.strictEqual(calc.parseDiscountInput('abc'), 1);
  assert.strictEqual(calc.parseDiscountInput('9999'), 1);
});

t('折扣输入框显示值', () => {
  assert.strictEqual(calc.discountInputValue(0.95), '9.5');
  assert.strictEqual(calc.discountInputValue(1), '10');
  assert.strictEqual(calc.discountInputValue(0.08), '0.8');
});

/* ---------- 9. 展示模型 ---------- */

t('展示模型：面积计价', () => {
  const d = calc.getCabinetDisplayData(cab({ width: 2, height: 0.6, quantity: 3, unitPrice: 200 }));
  assert.strictEqual(d.type, 'area');
  assert.strictEqual(d.specText, '2×0.6');
  assert.strictEqual(d.areaText, '3.6');
  assert.strictEqual(d.priceText, '200');
  // dimText 是给「复制账单」那种没有表头的纯文本用的，单位得自己带上
  assert.strictEqual(d.dimText, '2×0.6m ×3');
  eq(d.amount, 720);
});

t('展示模型：延米/按件/固定', () => {
  const lin = calc.getCabinetDisplayData(cab({ pricingType: 'linear', length: 2.4, quantity: 2, unitPrice: 300 }));
  assert.strictEqual(lin.specText, '2.4m');
  assert.strictEqual(lin.areaText, '—');
  assert.strictEqual(lin.dimText, '2.4m ×2');

  const un = calc.getCabinetDisplayData(cab({ pricingType: 'unit', quantity: 5, unitPrice: 80 }));
  assert.strictEqual(un.specText, '—');
  assert.strictEqual(un.dimText, '×5件');

  const fx = calc.getCabinetDisplayData(cab({ pricingType: 'fixed', fixedAmount: 1234 }));
  assert.strictEqual(fx.dimText, '固定金额');
  assert.strictEqual(fx.priceText, '—');
  eq(fx.amount, 1234);
});

t('展示模型：单价带计价基准（元/m² 还是元/个）', () => {
  const area = calc.getCabinetDisplayData(cab({ width: 2, height: 0.6, quantity: 3, unitPrice: 200 }));
  assert.strictEqual(area.priceBasis, 'm²', '面积计价的单价是每平米');

  const lin = calc.getCabinetDisplayData(cab({ pricingType: 'linear', length: 2.4, quantity: 2, unitPrice: 300 }));
  assert.strictEqual(lin.priceBasis, 'm', '延米计价的单价是每米');

  const un = calc.getCabinetDisplayData(cab({ pricingType: 'unit', quantity: 5, unitPrice: 80 }));
  assert.strictEqual(un.priceBasis, '个', '按件计价的单价是每个');

  // 固定金额没有单价这一说，别硬凑一个单位出来
  const fx = calc.getCabinetDisplayData(cab({ pricingType: 'fixed', fixedAmount: 1234 }));
  assert.strictEqual(fx.priceBasis, '');
});

t('展示模型：报表里的格子不带单位（单位都在表头）', () => {
  const d = calc.getCabinetDisplayData(cab({ width: 2, height: 0.6, quantity: 3, unitPrice: 200 }));
  // 「规格(m×m)」「面积(m²)」表头已经把单位说了，格子里再跟一个 m 就是重复
  assert.strictEqual(d.specText, '2×0.6');
  assert.strictEqual(d.areaText, '3.6');
  assert.strictEqual(d.priceText, '200');
  // 单位没被丢掉，还在 priceBasis 里，表头是照着它拼的
  assert.strictEqual(d.priceBasis, 'm²');
});

t('展示模型：延米柜的规格是单个长度，得自带 m', () => {
  // 「规格(m×m)」是给面积柜的表头，延米柜只有一个长度，写「2.4」会被当成 m×m 的一半
  const lin = calc.getCabinetDisplayData(cab({ pricingType: 'linear', length: 2.4, quantity: 2, unitPrice: 300 }));
  assert.strictEqual(lin.specText, '2.4m');
});

t('展示模型：柜子 amount = base（杂项已经不在柜子上）', () => {
  const d = calc.getCabinetDisplayData(cab({ pricingType: 'fixed', fixedAmount: 100.5 }));
  assert.strictEqual(d.amount, 100.5);
  assert.strictEqual(d.amount, d.base);
  assert.strictEqual(calc.fmt(7.5), '7.5');
  assert.strictEqual(calc.fmt(7), '7');
  assert.strictEqual(calc.fmt(0), '0');
  assert.strictEqual(calc.fmt('abc'), '0');
});

t('展示模型：杂项行给出数量、单位和金额', () => {
  const d = calc.getExtraDisplayData({ name: '灯管', qty: 3, unit: '个', price: 10.1 });
  assert.strictEqual(d.name, '灯管');
  assert.strictEqual(d.unit, '个');
  assert.strictEqual(d.qty, 3);
  eq(d.amount, 30.3);
  // 单位没填时给个默认，别显示成空格
  assert.strictEqual(calc.getExtraDisplayData({ name: 'x', qty: 1, price: 1 }).unit, '个');
  assert.strictEqual(calc.getExtraDisplayData(null).amount, 0);
});

/* ---------- 汇总 ---------- */

console.log('');
if (failures.length) {
  console.log('✗ ' + failures.length + ' 个测试失败，' + passed + ' 个通过\n');
  failures.forEach(f => console.log('  ✗ ' + f.name + '\n      ' + f.message));
  console.log('');
  process.exit(1);
} else {
  console.log('✓ 全部 ' + passed + ' 个测试通过');
  console.log('');
}
