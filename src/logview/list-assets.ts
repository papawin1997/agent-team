// logic กรอง/เรียง/แบ่งหน้าของหน้า agent-team logs (ฟังก์ชันล้วน ไม่แตะ DOM)
// ฝังเป็น <script> แยกก่อน PAGE_JS แล้วใช้ผ่าน global AgentTeamList — เทสต์ได้ด้วย new Function(LIST_JS + 'return AgentTeamList')

export const LIST_JS = String.raw`
var AgentTeamList = (function () {
  'use strict';
  var PAGE_SIZES = [10, 20, 50];
  var DEFAULT_PAGE_SIZE = 20;
  var ROLE_ICONS = { pm: '🧭', planning: '📐', frontend: '🎨', backend: '⚙️', qa: '🔍', security: '🛡️' };
  var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };

  function roleStyle(role) {
    var known = has(ROLE_ICONS, role);
    return { icon: known ? ROLE_ICONS[role] : '🤖', cls: 'role-' + (known ? role : 'other') };
  }

  function roleCounts(calls) {
    var order = [];
    var counts = {};
    calls.forEach(function (c) {
      if (!has(counts, c.role)) {
        counts[c.role] = 0;
        order.push(c.role);
      }
      counts[c.role]++;
    });
    return order.map(function (r) { return { role: r, count: counts[r] }; });
  }

  function sizeOf(pageSize) {
    var n = Number(pageSize);
    return PAGE_SIZES.indexOf(n) >= 0 ? n : DEFAULT_PAGE_SIZE;
  }

  function paginate(items, page, pageSize) {
    var size = sizeOf(pageSize);
    var total = items.length;
    var pages = Math.max(1, Math.ceil(total / size));
    var p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
    var start = (p - 1) * size;
    var slice = items.slice(start, start + size);
    return { items: slice, page: p, pages: pages, pageSize: size, total: total, from: total ? start + 1 : 0, to: start + slice.length };
  }

  function callMatches(c, opts) {
    if (opts.roles && opts.roles.length && opts.roles.indexOf(c.role) < 0) return false;
    if (opts.status && opts.status !== 'all' && c.status !== opts.status) return false;
    return true;
  }
  function num(v) { return typeof v === 'number' && !isNaN(v) ? v : null; }
  function byDesc(key) {
    return function (a, b) {
      var x = num(a[key]);
      var y = num(b[key]);
      if (x === null && y === null) return a.id - b.id;
      if (x === null) return 1;
      if (y === null) return -1;
      return (y - x) || (a.id - b.id);
    };
  }
  var CALL_SORTS = {
    'start-asc': function (a, b) { return a.id - b.id; },
    'start-desc': function (a, b) { return b.id - a.id; },
    'duration-desc': byDesc('durationMs'),
    'cost-desc': byDesc('costUsd'),
    'turns-desc': byDesc('turns')
  };
  function sortedCalls(calls, opts) {
    var cmp = has(CALL_SORTS, opts.sort) ? CALL_SORTS[opts.sort] : CALL_SORTS['start-asc'];
    return calls.filter(function (c) { return callMatches(c, opts); }).sort(cmp);
  }
  function listCalls(calls, opts) { return paginate(sortedCalls(calls, opts), opts.page, opts.pageSize); }
  function pageOfCall(calls, opts, id) {
    var list = sortedCalls(calls, opts);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return Math.floor(i / sizeOf(opts.pageSize)) + 1;
    }
    return 0;
  }

  function summaryOf(ev) {
    var d = ev.data || {};
    var out;
    if (ev.event === 'say' || ev.event === 'raw') out = d.text;
    else if (ev.event === 'user.input') out = d.answer;
    else if (ev.event === 'user.question') out = d.question;
    else if (ev.event === 'user.choice') out = d.prompt + ' → ' + d.choice;
    else out = JSON.stringify(d);
    return out === undefined || out === null ? '' : String(out);
  }
  function typeMatches(ev, type) {
    var e = ev.event;
    if (type === 'problem') return ev.level !== 'INFO';
    if (type === 'agent') return e.indexOf('agent.') === 0 || e.indexOf('qa.') === 0 || e.indexOf('security.') === 0 || e === 'guard.deny' || e === 'escalate.decision';
    if (type === 'user') return e.indexOf('user.') === 0;
    if (type === 'say') return e === 'say';
    return true;
  }
  function listEvents(events, opts) {
    var q = String(opts.query || '').trim().toLowerCase();
    var list = events.filter(function (ev) {
      if (!typeMatches(ev, opts.type || 'all')) return false;
      return !q || (ev.event + ' ' + summaryOf(ev)).toLowerCase().indexOf(q) >= 0;
    });
    if (opts.sort === 'desc') list = list.slice().reverse();
    return paginate(list, opts.page, opts.pageSize);
  }

  return {
    PAGE_SIZES: PAGE_SIZES,
    DEFAULT_PAGE_SIZE: DEFAULT_PAGE_SIZE,
    roleStyle: roleStyle,
    roleCounts: roleCounts,
    paginate: paginate,
    listCalls: listCalls,
    pageOfCall: pageOfCall,
    summaryOf: summaryOf,
    listEvents: listEvents
  };
})();
`;
