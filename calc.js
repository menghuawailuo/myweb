/* ============================================================
 * calc.js — 计算核心（纯函数：不碰 DOM、不碰 localStorage）
 *
 * 浏览器：在 app.js 之前引入，函数自动挂到全局
 *   <script src="js/calc.js"></script>
 * 单元测试：可直接被 Node require
 *   node tests/calc.test.js
 *
 * 设计约定：
 *   - 金额统一用 r2() 收敛到 2 位小数，避免 0.1+0.2 这类浮点误差
 *     顺着"柜子 → 房间 → 工程 → 折扣 → 未收"一路放大进账单。
 *   - 每一层都取整（而不是只在最外层取整），这样账单上各行的数字
 *     相加正好等于小计，用户对账时不会出现"差一分钱"。
 *   - 面积不做取整，只在展示时用 fmt() 收尾。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else for (var k in api) if (Object.prototype.hasOwnProperty.call(api, k)) root[k] = api[k];
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 数字工具 ---------- */

  // 任意输入 → 数字（NaN / 空 / null 全部落到 0）
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  // 金额收敛到 2 位小数
  function r2(n) { return Math.round(num(n) * 100) / 100; }

  // 面积收敛到 4 位小数（1 cm²），让"2×0.6×3"这种乘法不再吐出 3.5999999999999996
  function r4(n) { return Math.round(num(n) * 1e4) / 1e4; }

  // 容忍脏数据：不是数组就当作空数组
  function arr(v) { return Array.isArray(v) ? v : []; }

  // 展示用：去掉多余的 0 和小数点（7.50 → "7.5"，7.00 → "7"）
  function fmt(n) { return String(r2(n)); }

  // 去掉首尾空白；null / undefined / 非字符串一律当空串
  function trimStr(v) { return String(v == null ? '' : v).trim(); }

  function clamp01(v, dflt) {
    var n = parseFloat(v);
    if (isNaN(n)) return dflt == null ? 1 : dflt;
    return Math.max(0, Math.min(1, n));
  }

  /* ---------- 柜子 ---------- */

  var PRICING_TYPES = ['area', 'linear', 'unit', 'fixed'];

  function cabinetPricingType(c) {
    var t = c && c.pricingType;
    return PRICING_TYPES.indexOf(t) !== -1 ? t : 'area';
  }

  // 柜体正投影面积（宽 × 高），不含数量
  function cabinetArea(c) {
    return r4(num(c && c.width) * num(c && c.height));
  }

  /* ---------- 杂项 ---------- */
  // 杂项挂在【房间】上，和柜子同级 —— 灯管、指纹锁这类东西不归属于某个柜子，
  // 硬塞进柜子里会让"这个柜子多少钱"变得说不清。
  // 两种录入模式下它都装在那个房间的 extras 里（直列模式就是那个隐藏房间）。

  // 兼容三种传法：杂项数组、房间对象（取 .extras）、柜子对象（老数据遗留）
  function extrasList(v) {
    if (Array.isArray(v)) return v;
    return arr(v && v.extras);
  }

  // 单条杂项金额 = 数量 × 单价，取整到分
  function extraAmount(e) {
    return r2(num(e && e.qty) * num(e && e.price));
  }

  // 杂项合计：Σ 数量 × 单价
  function extrasTotal(v) {
    return r2(extrasList(v).reduce(function (s, e) { return s + extraAmount(e); }, 0));
  }

  // 杂项条数（只数有名字的，空白行不算）
  function extraCount(v) {
    return extrasList(v).filter(function (e) { return e && trimStr(e.name); }).length;
  }

  // 柜体基础金额 —— 全项目唯一计价入口
  function cabinetBaseAmount(c) {
    c = c || {};
    var q = num(c.quantity);
    var p = num(c.unitPrice);
    switch (cabinetPricingType(c)) {
      case 'linear': {
        // 延米：优先取 length；老数据没有 length 字段时回退到 width
        var len = (c.length != null && c.length !== '') ? num(c.length) : num(c.width);
        return len * q * p;
      }
      case 'unit':
        return q * p;
      case 'fixed':
        return num(c.fixedAmount);
      default: // area
        return cabinetArea(c) * q * p;
    }
  }

  // 单个柜子的金额 = 柜体本身（杂项已经独立到房间层级，不再算在柜子里）
  function cabinetAmount(c) {
    return r2(cabinetBaseAmount(c));
  }

  // 面积贡献：只有"面积计价"才计入工程总面积，其它计价方式贡献 0
  function cabinetAreaContribution(c) {
    if (cabinetPricingType(c) !== 'area') return 0;
    return r4(cabinetArea(c) * num(c && c.quantity));
  }

  /* ---------- 房间 / 工程 ---------- */

  // 房间小计 = 房里所有柜子 + 本房间的杂项（杂项与柜子同级，所以在这里相加）
  function roomSubtotal(r) {
    var s = arr(r && r.cabinets).reduce(function (t, c) { return t + cabinetAmount(c); }, 0);
    return r2(s + extrasTotal(r));
  }
  function roomArea(r) {
    return r4(arr(r && r.cabinets).reduce(function (s, c) { return s + cabinetAreaContribution(c); }, 0));
  }
  function roomCabCount(r) { return arr(r && r.cabinets).length; }

  // 工程原始金额（未打折、未收款）
  function projectTotal(p) {
    return r2(arr(p && p.rooms).reduce(function (s, r) { return s + roomSubtotal(r); }, 0));
  }
  function projectArea(p) {
    return r4(arr(p && p.rooms).reduce(function (s, r) { return s + roomArea(r); }, 0));
  }
  function projectCabCount(p) {
    return arr(p && p.rooms).reduce(function (s, r) { return s + roomCabCount(r); }, 0);
  }

  /* ---------- 折扣 / 收款 ---------- */

  // 折扣金额（永远 >= 0，且不超过原始金额）
  function projectDiscount(p) {
    p = p || {};
    var gross = projectTotal(p);
    var type = p.discountType || 'none';

    if (type === 'rate') {
      var rate = clamp01(p.discountRate, 1);   // 0.95 = 95 折
      return r2(gross * (1 - rate));
    }
    if (type === 'amount') {
      return r2(Math.min(Math.max(0, num(p.discountAmount)), gross));
    }
    return 0;
  }

  // 应收金额 = 原始金额 - 折扣（永不为负）
  function projectFinal(p) {
    return r2(Math.max(0, projectTotal(p) - projectDiscount(p)));
  }

  // 累计已收金额
  function projectPaid(p) {
    return r2(Math.max(0, num(p && p.paidAmount)));
  }

  // 未收金额（永不为负 —— 多收了不显示负数）
  function projectOutstanding(p) {
    return r2(Math.max(0, projectFinal(p) - projectPaid(p)));
  }

  // 是否已结清：只看钱有没有收齐，金额为 0 的工程不算结清。
  //
  // 这里刻意不存"结清标记"。存了标记就会出现自相矛盾的状态：
  // 用户标记结清 → 又加了一个柜子 → 列表按标记显示"已结清"，
  // 详情页却按金额显示"未收 ¥800"，两个页面对不上。
  // 让状态完全由金额推导，任一页面都只有一个口径。
  function projectIsSettled(p) {
    var due = projectFinal(p);
    return due > 0 && projectPaid(p) >= due;
  }

  // 0.95 → "9.5折"；0.9 → "9折"；>= 1 → "原价"
  // 注意：这里要除以 10 换成"折"的口语单位。原实现漏了这一步，
  // 0.95 会被显示成"95折"（中文里没有这种说法）。
  function discountLabel(rate) {
    var r = num(rate);
    if (!r || r >= 1) return '原价';
    var zhe = Math.round(r * 100) / 10;     // 0.95 → 9.5
    return (zhe % 1 === 0 ? zhe : zhe.toFixed(1)) + '折';
  }

  // 把用户输入的各种写法统一成折扣率 0~1
  //   "9.5" / "9.5折" → 0.95      "95" → 0.95      "8" → 0.8
  //   空 / 非法        → 1（原价，宁可不少收也不错收）
  //   "0"             → 0（免单，尊重用户明确输入）
  function parseDiscountInput(raw) {
    var s = String(raw == null ? '' : raw).replace(/[折\s]/g, '');
    if (s === '') return 1;
    var n = parseFloat(s);
    if (isNaN(n)) return 1;
    if (n <= 0) return 0;
    if (n <= 10) return n / 10;      // 9.5 折写法
    if (n <= 100) return n / 100;    // 95 折写法
    return 1;
  }

  // 折扣率 → 输入框显示值（0.95 → "9.5"）
  function discountInputValue(rate) {
    var r = clamp01(rate, 1);
    return String(Math.round(r * 1000) / 100);
  }

  /* ---------- 统一展示模型 ---------- */
  // 页面行 / 文本账单 / PDF / Excel 四处共用，保证口径完全一致
  function getCabinetDisplayData(c) {
    c = c || {};
    var type = cabinetPricingType(c);
    var q = num(c.quantity);
    var p = num(c.unitPrice);
    var w = num(c.width);
    var h = num(c.height);
    var len = (c.length != null && c.length !== '') ? num(c.length) : num(c.width);
    var area = cabinetAreaContribution(c);
    var base = r2(cabinetBaseAmount(c));

    // priceBasis：单价的计价基准（m² / m / 个）。同一个工程里可能混着好几种
    // 计价方式，表头一行写不下，所以挨着每一行的单价标出来。
    var specText, areaText, priceText, dimText, priceBasis;
    if (type === 'linear') {
      specText = fmt(len) + 'm';
      areaText = '—';
      priceText = fmt(p);
      priceBasis = 'm';
      dimText = fmt(len) + 'm ×' + fmt(q);
    } else if (type === 'unit') {
      specText = '—';
      areaText = '—';
      priceText = fmt(p);
      priceBasis = '个';
      dimText = '×' + fmt(q) + '件';
    } else if (type === 'fixed') {
      specText = '—';
      areaText = '—';
      priceText = '—';
      priceBasis = '';
      dimText = '固定金额';
    } else {
      // 规格只写数字：单位（m×m）交给报表的表头去说，格子里不用每行重复一遍
      specText = fmt(w) + '×' + fmt(h);
      areaText = fmt(area);
      priceText = fmt(p);
      priceBasis = 'm²';
      dimText = fmt(w) + '×' + fmt(h) + 'm ×' + fmt(q);
    }

    return {
      type: type, qty: q, price: p, width: w, height: h, length: len,
      base: base, amount: base, area: area,
      specText: specText, areaText: areaText, priceText: priceText,
      priceBasis: priceBasis,
      dimText: dimText
    };
  }

  // 一条杂项的展示模型 —— 页面行 / 文本账单 / PDF / Excel 四处共用
  // unit 只在这里给出，不带单位后缀：报表把单位收进表头（数量(个/套)），
  // 格子里只留数字；页面上则由「单位」输入框显示。
  function getExtraDisplayData(e) {
    e = e || {};
    var q = num(e.qty);
    var u = trimStr(e.unit) || '个';
    return {
      name: trimStr(e.name),
      qty: q,
      unit: u,
      price: num(e.price),
      amount: extraAmount(e)
    };
  }

  return {
    num: num, r2: r2, r4: r4, fmt: fmt, clamp01: clamp01, trimStr: trimStr,
    PRICING_TYPES: PRICING_TYPES,
    cabinetPricingType: cabinetPricingType,
    cabinetArea: cabinetArea,
    extrasList: extrasList,
    extraAmount: extraAmount,
    extrasTotal: extrasTotal,
    extraCount: extraCount,
    cabinetBaseAmount: cabinetBaseAmount,
    cabinetAmount: cabinetAmount,
    cabinetAreaContribution: cabinetAreaContribution,
    roomSubtotal: roomSubtotal,
    roomArea: roomArea,
    roomCabCount: roomCabCount,
    projectTotal: projectTotal,
    projectArea: projectArea,
    projectCabCount: projectCabCount,
    projectDiscount: projectDiscount,
    projectFinal: projectFinal,
    projectPaid: projectPaid,
    projectOutstanding: projectOutstanding,
    projectIsSettled: projectIsSettled,
    discountLabel: discountLabel,
    parseDiscountInput: parseDiscountInput,
    discountInputValue: discountInputValue,
    getCabinetDisplayData: getCabinetDisplayData,
    getExtraDisplayData: getExtraDisplayData
  };
});
