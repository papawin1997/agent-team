// CSS + JS ของหน้า agent-team logs (ฝังลงใน HTML ไฟล์เดียว; ฟอนต์ฝังโดย render.ts จาก assets/fonts)

export const PAGE_CSS = String.raw`
:root{
--bg:#f6f7f9;--card:#fff;--fg:#1f2933;--muted:#5b6876;--border:#d9dee5;--err:#c62828;--err-bg:#fdecea;--warn:#a15c00;--warn-bg:#fff4e0;--ok:#1b7f3b;--info:#2457c5;--info-bg:#e8effc;--code:#eef1f5;
--r-pm:#7c3aed;--r-planning:#1d4ed8;--r-frontend:#be185d;--r-backend:#0f766e;--r-qa:#c2410c;--r-security:#86198f;--r-other:#64748b;--role-fg:#fff;
--font-sans:"Inter","Noto Sans Thai","Leelawadee UI","Segoe UI",Tahoma,system-ui,sans-serif;
--font-mono:"JetBrains Mono","Noto Sans Thai",ui-monospace,"Cascadia Mono",Consolas,monospace;
--fs-h1:clamp(1.5rem,1.3rem + 1vw,2rem);
--fs-h2:clamp(1.2rem,1.1rem + .5vw,1.4rem);
--fs-h3:clamp(1.05rem,1rem + .25vw,1.15rem);
--fs-body:clamp(.9375rem,.9rem + .2vw,1rem);
--fs-small:.875rem;
--fs-caption:.8125rem;
--fs-mono:.8125rem;
--lh-heading:1.35;--lh-body:1.7;--lh-mono:1.5;
--ls-body:0;--ls-heading:0;--ls-caption:.01em
}
@media (prefers-color-scheme: dark){:root{
--bg:#12161c;--card:#1b2129;--fg:#e4e8ee;--muted:#a3adb8;--border:#2e3742;--err:#ff8a80;--err-bg:#3a1d1d;--warn:#ffcc80;--warn-bg:#3a2e1a;--ok:#81c995;--info:#8ab4f8;--info-bg:#1d2a40;--code:#232b35;
--r-pm:#c4b5fd;--r-planning:#93c5fd;--r-frontend:#f9a8d4;--r-backend:#5eead4;--r-qa:#fdba74;--r-security:#f0abfc;--r-other:#cbd5e1;--role-fg:#12161c
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-size:var(--fs-body);line-height:var(--lh-body);letter-spacing:var(--ls-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
#app{max-width:1100px;margin:0 auto;padding:16px}
h1,h2,h3{font-weight:600;line-height:var(--lh-heading);letter-spacing:var(--ls-heading)}
h1{font-size:var(--fs-h1);margin:0 0 4px}
h2{font-size:var(--fs-h2);margin:0 0 10px}
h3{font-size:var(--fs-h3);margin:6px 0}
section,.head{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:12px}
.muted{color:var(--muted)}
.small{font-size:var(--fs-caption);letter-spacing:var(--ls-caption)}
select,button,input{font:inherit;font-size:var(--fs-small);line-height:1.5;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 10px;max-width:100%}
button{cursor:pointer;margin:2px}
button:disabled{opacity:.45;cursor:default}
input[type=search]{flex:1 1 220px;min-width:0;font-size:max(16px,var(--fs-body))}
.finding{border-left:4px solid;border-radius:6px;padding:8px 12px;margin:8px 0}
.sev-error{border-color:var(--err);background:var(--err-bg)}
.sev-warn{border-color:var(--warn);background:var(--warn-bg)}
.sev-info{border-color:var(--info);background:var(--info-bg)}
.detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;background:var(--code);padding:8px 10px;border-radius:6px;font-family:var(--font-mono);font-size:var(--fs-mono);line-height:var(--lh-mono);max-height:320px;overflow:auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.stat{border:1px solid var(--border);border-radius:6px;padding:6px 10px;overflow-wrap:anywhere}
.stat b{display:block;font-size:var(--fs-caption);letter-spacing:var(--ls-caption);color:var(--muted);font-weight:normal}
.card{border:1px solid var(--border);border-left:4px solid var(--role,var(--border));border-radius:6px;margin:6px 0}
.card>button{width:100%;margin:0;text-align:left;border:0;border-radius:0 6px 6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 10px}
.card.failed>button{background:var(--err-bg)}
.card .body{padding:4px 10px 10px}
.step{border-top:1px dashed var(--border);padding:6px 0}
.t{color:var(--muted);font-size:var(--fs-caption);letter-spacing:var(--ls-caption);margin-right:6px}
.kind-api_error{color:var(--err)}
.filters,.controls,.pager{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px}
.pager{margin:10px 0 0}
.pager-info{color:var(--muted);font-size:var(--fs-small)}
.filters button.on{background:var(--info-bg);border-color:var(--info)}
.role-pm{--role:var(--r-pm)}
.role-planning{--role:var(--r-planning)}
.role-frontend{--role:var(--r-frontend)}
.role-backend{--role:var(--r-backend)}
.role-qa{--role:var(--r-qa)}
.role-security{--role:var(--r-security)}
.role-other{--role:var(--r-other)}
.role-badge{display:inline-block;border:1px solid var(--role);background:var(--role);color:var(--role-fg);border-radius:999px;padding:0 8px;margin:0 6px 0 0;font-size:var(--fs-caption);font-weight:600;line-height:1.7;white-space:nowrap}
button.role-badge{margin:2px}
.filters .chip{border-color:var(--role);color:var(--role);font-weight:600}
.filters .chip.on{background:var(--role);border-color:var(--role);color:var(--role-fg)}
details{border-top:1px solid var(--border);padding:4px 0}
summary{cursor:pointer;overflow-wrap:anywhere}
.lv{display:inline-block;min-width:52px;font-size:var(--fs-caption);font-weight:700;letter-spacing:var(--ls-caption);margin-right:6px}
.lv-INFO{color:var(--muted)}
.lv-WARN{color:var(--warn)}
.lv-ERROR,.lv-RAW{color:var(--err)}
.ev{font-family:var(--font-mono);font-size:var(--fs-mono);margin-right:6px}
.ok{color:var(--ok)}
.bad{color:var(--err)}
`;

export const PAGE_JS = String.raw`
(function () {
  'use strict';
  var L = window.AgentTeamList;
  var data = JSON.parse(document.getElementById('data').textContent);
  var currentDefault = data.defaultRun;
  var state = { run: currentDefault, open: {}, calls: freshCalls(), events: freshEvents() };
  var lastRuns = JSON.stringify(data.runs);
  var app = document.getElementById('app');

  var RUN_STATUS = {
    done: 'เสร็จสมบูรณ์',
    aborted: 'ยกเลิกงาน',
    error: 'หยุดเพราะ error',
    interrupted: 'ถูกหยุด (Ctrl+C)',
    unfinished: 'ยังไม่จบ / process หายไป'
  };
  var EVENT_TYPES = [['all', 'ทั้งหมด'], ['problem', 'WARN/ERROR'], ['agent', 'agent'], ['user', 'สิ่งที่คุณพิมพ์'], ['say', 'ข้อความในจอ']];
  var CALL_STATUSES = [['all', 'ทุกสถานะ'], ['ok', 'สำเร็จ'], ['failed', 'ไม่สำเร็จ'], ['unfinished', 'ยังไม่จบ']];
  var CALL_SORTS = [['start-asc', 'เวลาเริ่ม เก่า→ใหม่'], ['start-desc', 'เวลาเริ่ม ใหม่→เก่า'], ['duration-desc', 'ใช้เวลานานสุด'], ['cost-desc', 'cost สูงสุด'], ['turns-desc', 'turns มากสุด']];
  var EVENT_SORTS = [['asc', 'เก่า→ใหม่'], ['desc', 'ใหม่→เก่า']];

  function freshCalls() { return { roles: [], status: 'all', sort: 'start-asc', page: 1, pageSize: L.DEFAULT_PAGE_SIZE }; }
  function freshEvents() { return { type: 'all', query: '', sort: 'asc', page: 1, pageSize: L.DEFAULT_PAGE_SIZE }; }
  function resetForRun() {
    state.open = {};
    state.calls.roles = [];
    state.calls.page = 1;
    state.events.page = 1;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('th-TH', { hour12: false });
  }
  function fmtClock(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('th-TH', { hour12: false });
  }
  function fmtDur(ms) {
    if (typeof ms !== 'number' || isNaN(ms)) return '-';
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + (s % 60) + 's';
  }
  function fmtCost(v) { return typeof v === 'number' ? '$' + v.toFixed(4) : '-'; }
  function short(text, n) {
    text = String(text === undefined || text === null ? '' : text);
    return text.length > n ? text.slice(0, n) + '…' : text;
  }

  function selectBox(label, options, value, onChange) {
    var s = el('select');
    s.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = String(o[0]);
      if (String(o[0]) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.onchange = function () { onChange(s.value); };
    return s;
  }

  function roleBadge(role) {
    var st = L.roleStyle(role);
    return el('span', 'role-badge ' + st.cls, st.icon + ' ' + role);
  }

  function pager(res, st) {
    var bar = el('div', 'pager');
    var prev = el('button', null, '« ก่อนหน้า');
    prev.disabled = res.page <= 1;
    prev.onclick = function () { st.page = res.page - 1; render(); };
    var next = el('button', null, 'ถัดไป »');
    next.disabled = res.page >= res.pages;
    next.onclick = function () { st.page = res.page + 1; render(); };
    bar.appendChild(prev);
    bar.appendChild(el('span', 'pager-info', 'หน้า ' + res.page + '/' + res.pages + ' · แสดง ' + res.from + '–' + res.to + ' จาก ' + res.total));
    bar.appendChild(next);
    bar.appendChild(selectBox('จำนวนต่อหน้า', L.PAGE_SIZES.map(function (n) { return [n, n + ' ต่อหน้า']; }), res.pageSize, function (v) {
      st.pageSize = Number(v);
      st.page = 1;
      render();
    }));
    return bar;
  }

  function render() {
    var y = window.scrollY;
    var active = document.activeElement;
    var focusId = active && active.id ? active.id : null;
    var caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    var frag = document.createDocumentFragment();
    var run = data.runs[state.run];
    frag.appendChild(renderHeader());
    if (!run) {
      frag.appendChild(el('section', 'muted', 'ยังไม่มีรอบรันใน log'));
    } else {
      frag.appendChild(renderFindings(run));
      frag.appendChild(renderSummary(run));
      frag.appendChild(renderCalls(run));
      frag.appendChild(renderTimeline(run));
    }
    app.textContent = '';
    app.appendChild(frag);
    if (focusId) {
      var again = document.getElementById(focusId);
      if (again && again.focus) {
        again.focus();
        if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret);
      }
    }
    window.scrollTo(0, y);
  }

  function renderHeader() {
    var head = el('div', 'head');
    head.appendChild(el('h1', null, 'agent-team logs'));
    head.appendChild(el('div', 'muted', data.projectDir));
    if (data.runs.length) {
      head.appendChild(selectBox('เลือกรอบรัน', data.runs.map(function (r, i) {
        return [i, 'รอบที่ ' + (i + 1) + ' · ' + fmtTime(r.start) + ' · ' + (RUN_STATUS[r.status] || r.status) + (r.jobId ? ' · ' + r.jobId : '') + (r.calls.length === 0 ? ' (ไม่ได้เรียก agent)' : '')];
      }), state.run, function (v) {
        state.run = Number(v);
        resetForRun();
        render();
      }));
    }
    head.appendChild(el('div', 'muted small', 'สร้างเมื่อ ' + fmtTime(data.generatedAt) + (window.__LIVE__ ? ' · live: อัปเดตอัตโนมัติทุก 3 วินาที' : '')));
    return head;
  }

  function renderFindings(run) {
    var sec = el('section');
    sec.appendChild(el('h2', null, 'สาเหตุที่น่าจะเป็น'));
    if (!run.findings.length) {
      sec.appendChild(el('p', 'muted', run.status === 'unfinished' ? 'ยังไม่พบปัญหา (รอบนี้ยังไม่จบ)' : 'ไม่พบปัญหา'));
      return sec;
    }
    run.findings.forEach(function (f) {
      var box = el('div', 'finding sev-' + f.severity);
      box.appendChild(el('strong', null, f.title + (f.count > 1 ? ' ×' + f.count : '')));
      if (f.detail) box.appendChild(el('div', 'detail', f.detail));
      if (f.callIds.length) {
        var links = el('div', 'small');
        links.appendChild(el('span', 'muted', 'ดูครั้งที่เรียก agent: '));
        f.callIds.forEach(function (id) {
          var c = run.calls[id];
          var st = L.roleStyle(c ? c.role : '');
          var b = el('button', 'role-badge ' + st.cls, '#' + (id + 1) + (c ? ' ' + st.icon + ' ' + c.role : ''));
          b.onclick = function () { openCall(id); };
          links.appendChild(b);
        });
        box.appendChild(links);
      }
      sec.appendChild(box);
    });
    return sec;
  }

  function openCall(id) {
    var run = data.runs[state.run];
    if (!run) return;
    var st = state.calls;
    if (L.pageOfCall(run.calls, st, id) === 0) {
      st.roles = [];
      st.status = 'all';
    }
    st.page = L.pageOfCall(run.calls, st, id) || 1;
    state.open[id] = true;
    render();
    var target = document.getElementById('call-' + id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stat(label, value, cls) {
    var s = el('div', 'stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('b', null, label));
    s.appendChild(el('span', null, value));
    return s;
  }

  function renderSummary(run) {
    var sec = el('section');
    sec.appendChild(el('h2', null, 'สรุปรอบนี้'));
    var grid = el('div', 'stats');
    var failed = run.calls.filter(function (c) { return c.status !== 'ok'; }).length;
    var ms = run.end ? Date.parse(run.end) - Date.parse(run.start) : undefined;
    grid.appendChild(stat('สถานะ', RUN_STATUS[run.status] || run.status, run.status === 'error' ? 'bad' : run.status === 'done' ? 'ok' : ''));
    grid.appendChild(stat('เริ่ม', fmtTime(run.start)));
    grid.appendChild(stat('ใช้เวลา', fmtDur(ms)));
    grid.appendChild(stat('ค่าใช้จ่ายรวม (คิดตามราคา API)', fmtCost(run.totalCostUsd)));
    grid.appendChild(stat('เรียก agent', run.calls.length + ' ครั้ง' + (failed ? ' (ไม่สำเร็จ ' + failed + ')' : '')));
    grid.appendChild(stat('งาน (jobId)', run.jobId || '-'));
    sec.appendChild(grid);
    if (run.errorMessage) sec.appendChild(el('pre', 'bad', run.errorMessage));
    return sec;
  }

  function renderCalls(run) {
    var sec = el('section');
    var st = state.calls;
    sec.appendChild(el('h2', null, 'การเรียก agent (' + run.calls.length + ')'));
    if (!run.calls.length) {
      sec.appendChild(el('p', 'muted', 'รอบนี้ยังไม่ได้เรียก agent'));
      return sec;
    }
    var chips = el('div', 'filters');
    L.roleCounts(run.calls).forEach(function (rc) {
      var on = st.roles.indexOf(rc.role) >= 0;
      var rs = L.roleStyle(rc.role);
      var b = el('button', 'chip ' + rs.cls + (on ? ' on' : ''), rs.icon + ' ' + rc.role + ' (' + rc.count + ')');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.onclick = function () {
        st.roles = on ? st.roles.filter(function (r) { return r !== rc.role; }) : st.roles.concat([rc.role]);
        st.page = 1;
        render();
      };
      chips.appendChild(b);
    });
    sec.appendChild(chips);
    var controls = el('div', 'controls');
    controls.appendChild(selectBox('กรองสถานะ', CALL_STATUSES, st.status, function (v) { st.status = v; st.page = 1; render(); }));
    controls.appendChild(selectBox('เรียงการเรียก agent', CALL_SORTS, st.sort, function (v) { st.sort = v; st.page = 1; render(); }));
    sec.appendChild(controls);
    var res = L.listCalls(run.calls, st);
    st.page = res.page;
    if (!res.total) sec.appendChild(el('p', 'muted', 'ไม่มีการเรียก agent ที่ตรงกับตัวกรอง'));
    res.items.forEach(function (c) { sec.appendChild(renderCallCard(run, c)); });
    sec.appendChild(pager(res, st));
    return sec;
  }

  function renderCallCard(run, c) {
    var rs = L.roleStyle(c.role);
    var card = el('div', 'card ' + rs.cls + (c.status === 'ok' ? '' : ' failed'));
    card.id = 'call-' + c.id;
    var icon = c.status === 'ok' ? '✅' : c.status === 'failed' ? '❌' : '⏳';
    var head = el('button');
    head.setAttribute('aria-expanded', state.open[c.id] ? 'true' : 'false');
    head.appendChild(el('span', null, icon + ' #' + (c.id + 1)));
    head.appendChild(roleBadge(c.role));
    [
      c.model || '',
      fmtClock(c.start),
      fmtDur(c.durationMs),
      (c.turns === undefined ? '-' : c.turns) + ' turns',
      fmtCost(c.costUsd),
      c.status === 'ok' ? '' : (c.subtype || 'ยังไม่จบ')
    ].forEach(function (t) { if (t) head.appendChild(el('span', null, t)); });
    head.onclick = function () { state.open[c.id] = !state.open[c.id]; render(); };
    card.appendChild(head);
    if (state.open[c.id]) card.appendChild(renderTranscript(run.transcripts[String(c.id)], c));
    return card;
  }

  function renderTranscript(t, c) {
    var body = el('div', 'body');
    body.appendChild(el('h3', null, 'Transcript'));
    if (c.sessionId) body.appendChild(el('div', 'muted small', 'session: ' + c.sessionId));
    if (!t) {
      body.appendChild(el('p', 'muted', 'ไม่มีข้อมูล transcript'));
      return body;
    }
    if (t.file) body.appendChild(el('div', 'muted small', 'ไฟล์: ' + t.file));
    if (t.note) body.appendChild(el('p', 'muted', t.note));
    if (!t.steps.length && !t.note) body.appendChild(el('p', 'muted', 'ไม่มีข้อความหรือ tool ในช่วงเวลานี้'));
    t.steps.forEach(function (s) {
      var row = el('div', 'step kind-' + s.kind);
      row.appendChild(el('span', 't', fmtClock(s.time)));
      if (s.kind === 'text') {
        row.appendChild(el('span', null, '💬 ข้อความของ agent'));
        row.appendChild(el('pre', null, s.text));
      } else if (s.kind === 'tool_use') {
        row.appendChild(el('span', null, '🔧 ' + s.name));
        row.appendChild(el('pre', null, s.input));
      } else if (s.kind === 'tool_result') {
        row.appendChild(el('span', s.isError ? 'bad' : null, s.isError ? '⚠ ผลลัพธ์ (error)' : '↩ ผลลัพธ์'));
        row.appendChild(el('pre', null, s.text));
      } else if (s.kind === 'api_error') {
        row.appendChild(el('span', null, '⛔ API error' + (s.status ? ' ' + s.status : '') + (s.networkDown ? ' (เชื่อมต่อไม่ได้)' : '') + ': ' + s.message));
      }
      body.appendChild(row);
    });
    return body;
  }

  // ช่องค้นหา: รอ IME พิมพ์จบ (composition) และหน่วง 150ms ก่อน render ใหม่ทั้งหน้า
  var composing = false;
  var searchTimer = null;
  function scheduleSearch(input) {
    state.events.query = input.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      state.events.page = 1;
      render();
    }, 150);
  }

  function renderTimeline(run) {
    var sec = el('section');
    var st = state.events;
    sec.appendChild(el('h2', null, 'Timeline (' + run.events.length + ' event)'));
    var bar = el('div', 'filters');
    EVENT_TYPES.forEach(function (f) {
      var b = el('button', st.type === f[0] ? 'on' : null, f[1]);
      b.onclick = function () { st.type = f[0]; st.page = 1; render(); };
      bar.appendChild(b);
    });
    sec.appendChild(bar);
    var controls = el('div', 'controls');
    var search = el('input');
    search.id = 'ev-search';
    search.type = 'search';
    search.value = st.query;
    search.setAttribute('placeholder', 'ค้นหาใน event…');
    search.setAttribute('aria-label', 'ค้นหาใน timeline');
    search.addEventListener('compositionstart', function () { composing = true; });
    search.addEventListener('compositionend', function () { composing = false; scheduleSearch(search); });
    search.oninput = function () { if (!composing) scheduleSearch(search); };
    controls.appendChild(search);
    controls.appendChild(selectBox('เรียง timeline', EVENT_SORTS, st.sort, function (v) { st.sort = v; st.page = 1; render(); }));
    sec.appendChild(controls);
    var res = L.listEvents(run.events, st);
    st.page = res.page;
    if (!res.total) sec.appendChild(el('p', 'muted', 'ไม่มี event ที่ตรงกับตัวกรอง'));
    res.items.forEach(function (ev) {
      var d = el('details');
      var s = el('summary');
      s.appendChild(el('span', 't', fmtClock(ev.time)));
      if (ev.data && typeof ev.data.role === 'string') s.appendChild(roleBadge(ev.data.role));
      s.appendChild(el('span', 'lv lv-' + ev.level, ev.level));
      s.appendChild(el('span', 'ev', ev.event));
      s.appendChild(el('span', null, short(L.summaryOf(ev), 200)));
      d.appendChild(s);
      var built = false;
      d.addEventListener('toggle', function () {
        if (built || !d.open) return;
        built = true;
        d.appendChild(el('pre', null, 'บรรทัด ' + ev.line + '\n' + JSON.stringify(ev.data, null, 2)));
      });
      sec.appendChild(d);
    });
    sec.appendChild(pager(res, st));
    return sec;
  }

  if (window.__LIVE__) {
    setInterval(function () {
      if (document.hidden) return; // แท็บถูกซ่อนอยู่: ไม่ต้อง poll ให้เปลืองทั้งฝั่ง server และ browser
      fetch('/data', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (next) {
          var runs = JSON.stringify(next.runs);
          if (runs === lastRuns) return;
          var wasOnDefault = state.run === currentDefault;
          var newDefault = next.defaultRun;
          var before = state.run;
          data = next;
          lastRuns = runs;
          if (state.run >= data.runs.length) {
            state.run = newDefault;
          } else if (wasOnDefault && newDefault !== currentDefault) {
            state.run = newDefault;
          }
          if (state.run !== before) resetForRun();
          currentDefault = newDefault;
          render(); // ตัวกรอง/การเรียง/หน้าเดิมคงไว้ หน้าที่เกินจำนวนหน้าใหม่ถูกบีบใน paginate
        })
        .catch(function () { /* server หยุดแล้ว: คงหน้าเดิมไว้ */ });
    }, 3000);
  }

  render();
})();
`;
