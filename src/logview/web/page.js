// @ts-check
// UI ฝั่งเบราว์เซอร์ของหน้า agent-team logs อ่านข้อมูลจาก <script id="data"> ที่ render.ts ฝังไว้
// ต้องโหลดหลัง list.js เสมอ (ใช้ window.AgentTeamList) — ดู render.ts

/**
 * @typedef {Object} TranscriptStep
 * @property {'text'|'tool_use'|'tool_result'|'api_error'} kind
 * @property {string} time
 * @property {string} [text]
 * @property {string} [name]
 * @property {string} [input]
 * @property {boolean} [isError]
 * @property {number} [status]
 * @property {string} [message]
 * @property {boolean} [networkDown]
 */

/**
 * @typedef {Object} CallTranscript
 * @property {string} [file]
 * @property {TranscriptStep[]} steps
 * @property {string} [note]
 */

/**
 * @typedef {Object} AgentCall
 * @property {number} id
 * @property {string} role
 * @property {string} [model]
 * @property {boolean} resumed
 * @property {string} start
 * @property {string} [end]
 * @property {'ok'|'failed'|'unfinished'} status
 * @property {string} [subtype]
 * @property {number} [durationMs]
 * @property {number} [turns]
 * @property {number} [costUsd]
 * @property {string} [sessionId]
 */

/**
 * @typedef {Object} LogEvent
 * @property {number} line
 * @property {string} time
 * @property {'INFO'|'WARN'|'ERROR'|'RAW'} level
 * @property {string} event
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {Object} Finding
 * @property {'error'|'warn'|'info'} severity
 * @property {string} title
 * @property {string} detail
 * @property {number[]} callIds
 * @property {number} count
 */

/**
 * @typedef {Object} RunView
 * @property {number} index
 * @property {string} start
 * @property {string} [end]
 * @property {string} [jobId]
 * @property {'done'|'aborted'|'error'|'interrupted'|'unfinished'} status
 * @property {string} [errorMessage]
 * @property {LogEvent[]} events
 * @property {AgentCall[]} calls
 * @property {number} totalCostUsd
 * @property {Finding[]} findings
 * @property {Record<string, CallTranscript>} transcripts
 */

/**
 * @typedef {Object} ViewData
 * @property {string} projectDir
 * @property {string} logFile
 * @property {string} generatedAt
 * @property {number} defaultRun
 * @property {RunView[]} runs
 */

/**
 * @typedef {Object} CallsState
 * @property {string[]} roles
 * @property {string} status
 * @property {string} sort
 * @property {number} page
 * @property {number} pageSize
 */

/**
 * @typedef {Object} EventsState
 * @property {string} type
 * @property {string} query
 * @property {string} sort
 * @property {number} page
 * @property {number} pageSize
 */

/**
 * @typedef {Object} State
 * @property {number} run
 * @property {Record<number, boolean>} open
 * @property {Record<string, boolean>} openEvents
 * @property {CallsState} calls
 * @property {EventsState} events
 */

(function () {
  'use strict';
  var L = /** @type {AgentTeamListApi} */ (window.AgentTeamList);
  var dataEl = /** @type {HTMLElement} */ (document.getElementById('data'));
  /** @type {ViewData} */
  var data = JSON.parse(dataEl.textContent || 'null');
  var currentDefault = data.defaultRun;
  /** @type {State} */
  var state = { run: currentDefault, open: {}, openEvents: {}, calls: freshCalls(), events: freshEvents() };
  var lastRuns = JSON.stringify(data.runs);
  var app = /** @type {HTMLElement} */ (document.getElementById('app'));
  /** @type {string|null} */
  var pendingScrollId = null;

  /** เวลา (ms) นานสุดหลัง mousedown/keydown บน select ที่ยังถือว่า "น่าจะเปิด dropdown อยู่จริง" */
  var SELECT_GRACE_MS = 3000;
  /** เวลาล่าสุดที่ผู้ใช้เพิ่งโต้ตอบกับ select ตัวใดตัวหนึ่ง (mousedown/keydown) — ดูใน selectBox() */
  var lastSelectInteraction = -Infinity;
  /** @returns {number} Date.now() ปกติ เว้นแต่เทสต์ตั้ง window.__NOW__ ไว้ (ควบคุมเวลาแบบ deterministic ได้) */
  function now() { return typeof window.__NOW__ === 'number' ? window.__NOW__ : Date.now(); }

  /** @type {Record<string, string>} */
  var RUN_STATUS = {
    done: 'เสร็จสมบูรณ์',
    aborted: 'ยกเลิกงาน',
    error: 'หยุดเพราะ error',
    interrupted: 'ถูกหยุด (Ctrl+C)',
    unfinished: 'ยังไม่จบ / process หายไป'
  };
  /** @type {Array<[string, string]>} */
  var EVENT_TYPES = [['all', 'ทั้งหมด'], ['problem', 'WARN/ERROR'], ['agent', 'agent'], ['user', 'สิ่งที่คุณพิมพ์'], ['say', 'ข้อความในจอ']];
  /** @type {Array<[string, string]>} */
  var CALL_STATUSES = [['all', 'ทุกสถานะ'], ['ok', 'สำเร็จ'], ['failed', 'ไม่สำเร็จ'], ['unfinished', 'ยังไม่จบ']];
  /** @type {Array<[string, string]>} */
  var CALL_SORTS = [['start-asc', 'เวลาเริ่ม เก่า→ใหม่'], ['start-desc', 'เวลาเริ่ม ใหม่→เก่า'], ['duration-desc', 'ใช้เวลานานสุด'], ['cost-desc', 'cost สูงสุด'], ['turns-desc', 'turns มากสุด']];
  /** @type {Array<[string, string]>} */
  var EVENT_SORTS = [['asc', 'เก่า→ใหม่'], ['desc', 'ใหม่→เก่า']];

  /** @returns {CallsState} */
  function freshCalls() { return { roles: [], status: 'all', sort: 'start-asc', page: 1, pageSize: L.DEFAULT_PAGE_SIZE }; }
  /** @returns {EventsState} */
  function freshEvents() { return { type: 'all', query: '', sort: 'asc', page: 1, pageSize: L.DEFAULT_PAGE_SIZE }; }
  function resetForRun() {
    state.open = {};
    state.calls.roles = [];
    state.calls.page = 1;
    state.events.page = 1;
  }

  /**
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {string|null} [cls]
   * @param {string|number|null} [text]
   * @returns {HTMLElementTagNameMap[K]}
   */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  /**
   * @param {string|undefined} iso
   * @returns {string}
   */
  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('th-TH', { hour12: false });
  }
  /**
   * @param {string} iso
   * @returns {string}
   */
  function fmtClock(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('th-TH', { hour12: false });
  }
  /**
   * @param {number|undefined} ms
   * @returns {string}
   */
  function fmtDur(ms) {
    if (typeof ms !== 'number' || isNaN(ms)) return '-';
    var s = Math.round(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + (s % 60) + 's';
  }
  /**
   * @param {number|undefined} v
   * @returns {string}
   */
  function fmtCost(v) { return typeof v === 'number' ? '$' + v.toFixed(4) : '-'; }
  /**
   * @param {unknown} text
   * @param {number} n
   * @returns {string}
   */
  function short(text, n) {
    var s = String(text === undefined || text === null ? '' : text);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  // เอาไปทำ id: เหลือแต่ [a-z0-9-] ตัวอื่นแทนด้วย '-'
  /**
   * @param {string} s
   * @returns {string}
   */
  function sanitizeId(s) { return String(s).toLowerCase().replace(/[^a-z0-9-]/g, '-'); }

  /**
   * @param {string} label
   * @param {Array<[string|number, string]>} options
   * @param {string|number} value
   * @param {(value: string) => void} onChange
   * @param {string} [id]
   * @returns {HTMLSelectElement}
   */
  function selectBox(label, options, value, onChange, id) {
    var s = el('select');
    if (id) s.id = id;
    s.setAttribute('aria-label', label);
    options.forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = String(o[0]);
      if (String(o[0]) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.onchange = function () { onChange(s.value); };
    // เผื่อ dropdown ที่กำลังเปิดอยู่จริง (ดู now()/SELECT_GRACE_MS ตอน live poll ด้านล่าง)
    s.addEventListener('mousedown', function () { lastSelectInteraction = now(); });
    s.addEventListener('keydown', function () { lastSelectInteraction = now(); });
    return s;
  }

  /**
   * @param {string} role
   * @returns {HTMLElement}
   */
  function roleBadge(role) {
    var st = L.roleStyle(role);
    return el('span', 'role-badge ' + st.cls, st.icon + ' ' + role);
  }

  // idPrefix: 'calls' -> calls-prev/calls-next/calls-size, 'ev' -> ev-prev/ev-next/ev-size
  // titleId: id ของหัวข้อ section นี้ (เลื่อนเข้าจอเมื่อกด prev/next)
  /**
   * @param {PageResult<unknown>} res
   * @param {{page: number, pageSize: number}} st
   * @param {string} idPrefix
   * @param {string} titleId
   * @returns {HTMLDivElement}
   */
  function pager(res, st, idPrefix, titleId) {
    var bar = el('div', 'pager');
    var prev = el('button', null, '« ก่อนหน้า');
    prev.id = idPrefix + '-prev';
    prev.disabled = res.page <= 1;
    prev.onclick = function () { st.page = res.page - 1; pendingScrollId = titleId; render(); };
    var next = el('button', null, 'ถัดไป »');
    next.id = idPrefix + '-next';
    next.disabled = res.page >= res.pages;
    next.onclick = function () { st.page = res.page + 1; pendingScrollId = titleId; render(); };
    bar.appendChild(prev);
    var info = el('span', 'pager-info', 'หน้า ' + res.page + '/' + res.pages + ' · แสดง ' + res.from + '–' + res.to + ' จาก ' + res.total);
    info.setAttribute('aria-live', 'polite');
    bar.appendChild(info);
    bar.appendChild(next);
    bar.appendChild(selectBox('จำนวนต่อหน้า', L.PAGE_SIZES.map(function (n) { return /** @type {[number, string]} */ ([n, n + ' ต่อหน้า']); }), res.pageSize, function (v) {
      st.pageSize = Number(v);
      st.page = 1;
      render();
    }, idPrefix + '-size'));
    return bar;
  }

  // สลับ id ปุ่มเปลี่ยนหน้า prev<->next (ใช้ตอนปุ่มเดิมหายไปเพราะกลาย disabled)
  /**
   * @param {string} id
   * @returns {string|null}
   */
  function siblingPagerId(id) {
    if (/-prev$/.test(id)) return id.replace(/-prev$/, '-next');
    if (/-next$/.test(id)) return id.replace(/-next$/, '-prev');
    return null;
  }

  function render() {
    var y = window.scrollY;
    var active = /** @type {HTMLInputElement|HTMLSelectElement|HTMLButtonElement|null} */ (document.activeElement);
    var focusId = active && active.id ? active.id : null;
    var isSearch = focusId === 'ev-search';
    var caretStart = isSearch && active && typeof (/** @type {HTMLInputElement} */(active)).selectionStart === 'number' ? /** @type {HTMLInputElement} */(active).selectionStart : null;
    var caretEnd = isSearch && caretStart !== null && typeof (/** @type {HTMLInputElement} */(active)).selectionEnd === 'number' ? /** @type {HTMLInputElement} */(active).selectionEnd : caretStart;
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
      var again = /** @type {HTMLInputElement|HTMLSelectElement|HTMLButtonElement|null} */ (document.getElementById(focusId));
      if (again && again.disabled) {
        var altId = siblingPagerId(focusId);
        var alt = altId && /** @type {HTMLInputElement|HTMLSelectElement|HTMLButtonElement|null} */ (document.getElementById(altId));
        if (alt && !alt.disabled) again = alt;
      }
      if (again && again.focus) {
        again.focus();
        if (isSearch && caretStart !== null && /** @type {HTMLInputElement} */ (again).setSelectionRange) {
          /** @type {HTMLInputElement} */ (again).setSelectionRange(caretStart, caretEnd);
        }
      }
    }
    window.scrollTo(0, y);
    if (pendingScrollId) {
      var titleEl = document.getElementById(pendingScrollId);
      pendingScrollId = null;
      if (titleEl && titleEl.scrollIntoView) titleEl.scrollIntoView({ block: 'start' });
    }
  }

  /** @returns {HTMLDivElement} */
  function renderHeader() {
    var head = el('div', 'head');
    head.appendChild(el('h1', null, 'agent-team logs'));
    head.appendChild(el('div', 'muted', data.projectDir));
    if (data.runs.length) {
      head.appendChild(selectBox('เลือกรอบรัน', data.runs.map(function (r, i) {
        return /** @type {[number, string]} */ ([i, 'รอบที่ ' + (i + 1) + ' · ' + fmtTime(r.start) + ' · ' + (RUN_STATUS[r.status] || r.status) + (r.jobId ? ' · ' + r.jobId : '') + (r.calls.length === 0 ? ' (ไม่ได้เรียก agent)' : '')]);
      }), state.run, function (v) {
        state.run = Number(v);
        resetForRun();
        render();
      }, 'sel-run'));
    }
    head.appendChild(el('div', 'muted small', 'สร้างเมื่อ ' + fmtTime(data.generatedAt) + (window.__LIVE__ ? ' · live: อัปเดตอัตโนมัติทุก 3 วินาที' : '')));
    return head;
  }

  /**
   * @param {RunView} run
   * @returns {HTMLElement}
   */
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

  /** @param {number} id */
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

  /**
   * @param {string} label
   * @param {string|number} value
   * @param {string} [cls]
   * @returns {HTMLDivElement}
   */
  function stat(label, value, cls) {
    var s = el('div', 'stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('b', null, label));
    s.appendChild(el('span', null, value));
    return s;
  }

  /**
   * @param {RunView} run
   * @returns {HTMLElement}
   */
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

  /**
   * @param {RunView} run
   * @returns {HTMLElement}
   */
  function renderCalls(run) {
    var sec = el('section');
    var st = state.calls;
    var title = el('h2', null, 'การเรียก agent (' + run.calls.length + ')');
    title.id = 'calls-title';
    sec.appendChild(title);
    if (!run.calls.length) {
      sec.appendChild(el('p', 'muted', 'รอบนี้ยังไม่ได้เรียก agent'));
      return sec;
    }
    var chips = el('div', 'filters');
    L.roleCounts(run.calls).forEach(function (rc) {
      var on = st.roles.indexOf(rc.role) >= 0;
      var rs = L.roleStyle(rc.role);
      var b = el('button', 'chip ' + rs.cls + (on ? ' on' : ''), rs.icon + ' ' + rc.role + ' (' + rc.count + ')');
      b.id = 'chip-' + sanitizeId(rc.role);
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
    controls.appendChild(selectBox('กรองสถานะ', CALL_STATUSES, st.status, function (v) { st.status = v; st.page = 1; render(); }, 'calls-status'));
    controls.appendChild(selectBox('เรียงการเรียก agent', CALL_SORTS, st.sort, function (v) { st.sort = v; st.page = 1; render(); }, 'calls-sort'));
    sec.appendChild(controls);
    var res = L.listCalls(run.calls, st);
    st.page = res.page;
    if (!res.total) {
      var keepSize = st.pageSize;
      sec.appendChild(el('p', 'muted', 'ไม่มีการเรียก agent ที่ตรงกับตัวกรอง'));
      var clearBtn = el('button', null, 'ล้างตัวกรอง');
      clearBtn.id = 'calls-clear';
      clearBtn.onclick = function () {
        state.calls = freshCalls();
        state.calls.pageSize = keepSize;
        render();
      };
      sec.appendChild(clearBtn);
    }
    res.items.forEach(function (c) { sec.appendChild(renderCallCard(run, c)); });
    sec.appendChild(pager(res, st, 'calls', 'calls-title'));
    return sec;
  }

  /**
   * @param {RunView} run
   * @param {AgentCall} c
   * @returns {HTMLDivElement}
   */
  function renderCallCard(run, c) {
    var rs = L.roleStyle(c.role);
    var card = el('div', 'card ' + rs.cls + (c.status === 'ok' ? '' : ' failed'));
    card.id = 'call-' + c.id;
    var icon = c.status === 'ok' ? '✅' : c.status === 'failed' ? '❌' : '⏳';
    var head = el('button');
    head.id = 'call-' + c.id + '-toggle';
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

  /**
   * @param {CallTranscript|undefined} t
   * @param {AgentCall} c
   * @returns {HTMLDivElement}
   */
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
  /** @type {ReturnType<typeof setTimeout>|null} */
  var searchTimer = null;
  /** @param {HTMLInputElement} input */
  function scheduleSearch(input) {
    state.events.query = input.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      if (composing) return; // ยังพิมพ์ไม่จบ (IME) - compositionend จะ render ให้เอง
      state.events.page = 1;
      render();
    }, 150);
  }

  /**
   * @param {RunView} run
   * @returns {HTMLElement}
   */
  function renderTimeline(run) {
    var sec = el('section');
    var st = state.events;
    var title = el('h2', null, 'Timeline (' + run.events.length + ' event)');
    title.id = 'ev-title';
    sec.appendChild(title);
    var bar = el('div', 'filters');
    EVENT_TYPES.forEach(function (f) {
      var b = el('button', st.type === f[0] ? 'on' : null, f[1]);
      b.id = 'ev-type-' + f[0];
      b.setAttribute('aria-pressed', st.type === f[0] ? 'true' : 'false');
      b.onclick = function () { st.type = f[0]; st.page = 1; render(); };
      bar.appendChild(b);
    });
    sec.appendChild(bar);
    var controls = el('div', 'controls');
    var search = el('input');
    composing = false; // สร้างช่องค้นหาใหม่ทุกครั้งที่ re-render: ล้าง flag ค้างไว้กันเจอ IME ค้าง
    search.id = 'ev-search';
    search.type = 'search';
    search.value = st.query;
    search.setAttribute('placeholder', 'ค้นหาใน event…');
    search.setAttribute('aria-label', 'ค้นหาใน timeline');
    search.addEventListener('compositionstart', function () { composing = true; });
    search.addEventListener('compositionend', function () { composing = false; scheduleSearch(search); });
    search.oninput = function () { if (!composing) scheduleSearch(search); };
    controls.appendChild(search);
    controls.appendChild(selectBox('เรียง timeline', EVENT_SORTS, st.sort, function (v) { st.sort = v; st.page = 1; render(); }, 'ev-sort'));
    sec.appendChild(controls);
    var res = L.listEvents(run.events, st);
    st.page = res.page;
    if (!res.total) {
      var keepSize = st.pageSize;
      sec.appendChild(el('p', 'muted', 'ไม่มี event ที่ตรงกับตัวกรอง'));
      var clearBtn = el('button', null, 'ล้างตัวกรอง');
      clearBtn.id = 'ev-clear';
      clearBtn.onclick = function () {
        state.events = freshEvents();
        state.events.pageSize = keepSize;
        render();
      };
      sec.appendChild(clearBtn);
    }
    res.items.forEach(function (ev) {
      var d = el('details');
      var key = state.run + ':' + ev.line;
      var s = el('summary');
      s.appendChild(el('span', 't', fmtClock(ev.time)));
      if (ev.data && typeof ev.data.role === 'string') s.appendChild(roleBadge(ev.data.role));
      s.appendChild(el('span', 'lv lv-' + ev.level, ev.level));
      s.appendChild(el('span', 'ev', ev.event));
      s.appendChild(el('span', null, short(L.summaryOf(ev), 200)));
      d.appendChild(s);
      var built = false;
      function buildPre() {
        if (built) return;
        built = true;
        d.appendChild(el('pre', null, 'บรรทัด ' + ev.line + '\n' + JSON.stringify(ev.data, null, 2)));
      }
      d.addEventListener('toggle', function () {
        if (d.open) {
          state.openEvents[key] = true;
          buildPre();
        } else {
          delete state.openEvents[key];
        }
      });
      if (state.openEvents[key]) {
        d.open = true;
        buildPre();
      }
      sec.appendChild(d);
    });
    sec.appendChild(pager(res, st, 'ev', 'ev-title'));
    return sec;
  }

  if (window.__LIVE__) {
    setInterval(function () {
      if (document.hidden) return; // แท็บถูกซ่อนอยู่: ไม่ต้อง poll ให้เปลืองทั้งฝั่ง server และ browser
      if (composing) return; // กำลังพิมพ์ด้วย IME อยู่: เลื่อน poll ออกไปก่อน อย่าตัดคำที่พิมพ์ค้าง
      var activeTag = document.activeElement && document.activeElement.tagName ? String(document.activeElement.tagName).toLowerCase() : '';
      // เลื่อน poll ออกไปเฉพาะตอนน่าจะเปิด dropdown อยู่จริง (เพิ่งกด mousedown/keydown บน select ภายใน
      // SELECT_GRACE_MS) ไม่ใช่ทุกครั้งที่ focus อยู่บน select เฉย ๆ — render() คืน focus ให้ select
      // หลัง onchange เสมอ ถ้าเช็คแค่ activeTag === 'select' จะกลายเป็นหยุดอัปเดต live ถาวรทันทีที่ผู้ใช้
      // เปลี่ยน dropdown สักครั้งแล้วไม่ย้าย focus ไปไหนอีกเลย
      if (activeTag === 'select' && now() - lastSelectInteraction < SELECT_GRACE_MS) return;
      fetch('/data', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(/** @param {ViewData} next */ function (next) {
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
