// CSS + JS ของหน้า agent-team logs (ฝังลงใน HTML ไฟล์เดียว ไม่มีไฟล์ภายนอก)

export const PAGE_CSS = String.raw`
:root{--bg:#f6f7f9;--card:#fff;--fg:#1f2933;--muted:#616e7c;--border:#d9dee5;--err:#c62828;--err-bg:#fdecea;--warn:#a15c00;--warn-bg:#fff4e0;--ok:#1b7f3b;--info:#2457c5;--info-bg:#e8effc;--code:#eef1f5}
@media (prefers-color-scheme: dark){:root{--bg:#12161c;--card:#1b2129;--fg:#e4e8ee;--muted:#9aa5b1;--border:#2e3742;--err:#ff8a80;--err-bg:#3a1d1d;--warn:#ffcc80;--warn-bg:#3a2e1a;--ok:#81c995;--info:#8ab4f8;--info-bg:#1d2a40;--code:#232b35}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI","Noto Sans Thai",sans-serif}
#app{max-width:1100px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 8px}
section,.head{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:12px}
.muted{color:var(--muted)}
.small{font-size:12px}
select,button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 8px;max-width:100%}
button{cursor:pointer;margin:2px}
.finding{border-left:4px solid;border-radius:6px;padding:8px 12px;margin:8px 0}
.sev-error{border-color:var(--err);background:var(--err-bg)}
.sev-warn{border-color:var(--warn);background:var(--warn-bg)}
.sev-info{border-color:var(--info);background:var(--info-bg)}
.detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;background:var(--code);padding:6px 8px;border-radius:6px;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:320px;overflow:auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.stat{border:1px solid var(--border);border-radius:6px;padding:6px 10px;overflow-wrap:anywhere}
.stat b{display:block;font-size:12px;color:var(--muted);font-weight:normal}
.card{border:1px solid var(--border);border-radius:6px;margin:6px 0}
.card>button{width:100%;margin:0;text-align:left;border:0;border-radius:6px;display:flex;flex-wrap:wrap;gap:4px 12px;padding:8px 10px}
.card.failed>button{background:var(--err-bg)}
.card .body{padding:4px 10px 10px}
.step{border-top:1px dashed var(--border);padding:4px 0}
.t{color:var(--muted);font-size:12px;margin-right:6px}
.kind-api_error{color:var(--err)}
.filters{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.filters button.on{background:var(--info-bg);border-color:var(--info)}
details{border-top:1px solid var(--border);padding:3px 0}
summary{cursor:pointer;overflow-wrap:anywhere}
.lv{display:inline-block;min-width:48px;font-size:11px;font-weight:bold;margin-right:6px}
.lv-INFO{color:var(--muted)}
.lv-WARN{color:var(--warn)}
.lv-ERROR,.lv-RAW{color:var(--err)}
.ev{font-family:ui-monospace,Consolas,monospace;font-size:12px;margin-right:6px}
.ok{color:var(--ok)}
.bad{color:var(--err)}
`;

export const PAGE_JS = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  function computeDefaultRun(runs) {
    for (var i = runs.length - 1; i >= 0; i--) {
      if (runs[i].calls.length > 0 || runs[i].findings.length > 0) return i;
    }
    return runs.length - 1;
  }
  var currentDefault = typeof window.__DEFAULT_RUN__ === 'number' ? window.__DEFAULT_RUN__ : computeDefaultRun(data.runs);
  var state = { run: currentDefault, open: {}, filter: 'all' };
  var lastRuns = JSON.stringify(data.runs);
  var app = document.getElementById('app');

  var RUN_STATUS = {
    done: 'เสร็จสมบูรณ์',
    aborted: 'ยกเลิกงาน',
    error: 'หยุดเพราะ error',
    interrupted: 'ถูกหยุด (Ctrl+C)',
    unfinished: 'ยังไม่จบ / process หายไป'
  };
  var FILTERS = [['all', 'ทั้งหมด'], ['problem', 'WARN/ERROR'], ['agent', 'agent'], ['user', 'สิ่งที่คุณพิมพ์'], ['say', 'ข้อความในจอ']];

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

  function render() {
    var y = window.scrollY;
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
    window.scrollTo(0, y);
  }

  function renderHeader() {
    var head = el('div', 'head');
    head.appendChild(el('h1', null, 'agent-team logs'));
    head.appendChild(el('div', 'muted', data.projectDir));
    var sel = el('select');
    sel.setAttribute('aria-label', 'เลือกรอบรัน');
    data.runs.forEach(function (r, i) {
      var label = 'รอบที่ ' + (i + 1) + ' · ' + fmtTime(r.start) + ' · ' + (RUN_STATUS[r.status] || r.status) + (r.jobId ? ' · ' + r.jobId : '') + (r.calls.length === 0 ? ' (ไม่ได้เรียก agent)' : '');
      var o = el('option', null, label);
      o.value = String(i);
      if (i === state.run) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () { state.run = Number(sel.value); state.open = {}; render(); };
    if (data.runs.length) head.appendChild(sel);
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
          var b = el('button', null, '#' + (id + 1) + (c ? ' ' + c.role : ''));
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
    sec.appendChild(el('h2', null, 'การเรียก agent (' + run.calls.length + ')'));
    if (!run.calls.length) sec.appendChild(el('p', 'muted', 'รอบนี้ยังไม่ได้เรียก agent'));
    run.calls.forEach(function (c) {
      var card = el('div', 'card' + (c.status === 'ok' ? '' : ' failed'));
      card.id = 'call-' + c.id;
      var icon = c.status === 'ok' ? '✅' : c.status === 'failed' ? '❌' : '⏳';
      var head = el('button');
      head.setAttribute('aria-expanded', state.open[c.id] ? 'true' : 'false');
      [
        icon + ' #' + (c.id + 1) + ' ' + c.role,
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
      sec.appendChild(card);
    });
    return sec;
  }

  function renderTranscript(t, c) {
    var body = el('div', 'body');
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

  function matches(ev) {
    var f = state.filter;
    var e = ev.event;
    if (f === 'problem') return ev.level !== 'INFO';
    if (f === 'agent') return e.indexOf('agent.') === 0 || e.indexOf('qa.') === 0 || e.indexOf('security.') === 0 || e === 'guard.deny' || e === 'escalate.decision';
    if (f === 'user') return e.indexOf('user.') === 0;
    if (f === 'say') return e === 'say';
    return true;
  }

  function summaryOf(ev) {
    var d = ev.data || {};
    if (ev.event === 'say' || ev.event === 'raw') return d.text;
    if (ev.event === 'user.input') return d.answer;
    if (ev.event === 'user.question') return d.question;
    if (ev.event === 'user.choice') return d.prompt + ' → ' + d.choice;
    return JSON.stringify(d);
  }

  function renderTimeline(run) {
    var sec = el('section');
    sec.appendChild(el('h2', null, 'Timeline (' + run.events.length + ' event)'));
    var bar = el('div', 'filters');
    FILTERS.forEach(function (f) {
      var b = el('button', state.filter === f[0] ? 'on' : null, f[1]);
      b.onclick = function () { state.filter = f[0]; render(); };
      bar.appendChild(b);
    });
    sec.appendChild(bar);
    var shown = run.events.filter(matches);
    if (!shown.length) sec.appendChild(el('p', 'muted', 'ไม่มี event ที่ตรงกับตัวกรอง'));
    shown.forEach(function (ev) {
      var d = el('details');
      var s = el('summary');
      s.appendChild(el('span', 't', fmtClock(ev.time)));
      s.appendChild(el('span', 'lv lv-' + ev.level, ev.level));
      s.appendChild(el('span', 'ev', ev.event));
      s.appendChild(el('span', null, short(summaryOf(ev), 200)));
      d.appendChild(s);
      var built = false;
      d.addEventListener('toggle', function () {
        if (built || !d.open) return;
        built = true;
        d.appendChild(el('pre', null, 'บรรทัด ' + ev.line + '\n' + JSON.stringify(ev.data, null, 2)));
      });
      sec.appendChild(d);
    });
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
          var newDefault = computeDefaultRun(next.runs);
          data = next;
          lastRuns = runs;
          if (state.run >= data.runs.length) {
            state.run = newDefault;
          } else if (wasOnDefault && newDefault !== currentDefault) {
            state.run = newDefault;
          }
          currentDefault = newDefault;
          render();
        })
        .catch(function () { /* server หยุดแล้ว: คงหน้าเดิมไว้ */ });
    }, 3000);
  }

  render();
})();
`;
