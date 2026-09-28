import { describe, expect, it } from 'vitest';
import { LIST_JS } from '../../src/logview/list-assets';
import { PAGE_JS } from '../../src/logview/page-assets';
import { embedJson } from '../../src/logview/render';
import type { ViewData } from '../../src/logview/view-data';
import { createDom, fire, find, type FakeNode } from '../helpers/dom-shim';

const at = (i: number) => `2026-01-10T09:${String(i).padStart(2, '0')}:00.000Z`;
const calls = Array.from({ length: 25 }, (_, i) => ({
  id: i,
  role: i % 2 ? 'backend' : 'qa',
  resumed: false,
  start: at(i),
  end: at(i),
  status: i === 23 ? 'failed' : 'ok',
  subtype: 'success',
  durationMs: 1000 * (i + 1),
  turns: i % 5,
  costUsd: 0.01 * i,
}));
const events = Array.from({ length: 45 }, (_, i) => {
  if (i === 5) return { line: 6, time: at(5), level: 'INFO', event: 'agent.start', data: { role: 'qa', model: 'm' } };
  if (i === 40) return { line: 41, time: at(40), level: 'ERROR', event: 'run.error', data: { message: 'boom' } };
  return { line: i + 1, time: at(i), level: 'INFO', event: 'say', data: { text: `ข้อความที่ ${i + 1}` } };
});
const DATA = {
  projectDir: '/work/app',
  logFile: 'x',
  generatedAt: '2026-01-10T10:00:00.000Z',
  defaultRun: 0,
  runs: [
    {
      index: 0,
      start: at(0),
      end: at(44),
      status: 'error',
      errorMessage: 'boom',
      events,
      calls,
      totalCostUsd: 3,
      findings: [{ severity: 'error', title: 'agent backend พัง', detail: 'd', callIds: [23], count: 1 }],
      transcripts: {},
    },
    {
      // รอบที่ 2: ไม่มี call ที่ failed เลย -> ใช้ทดสอบตัวกรองค้างข้ามรอบรัน
      index: 1,
      start: '2026-01-10T11:00:00.000Z',
      end: '2026-01-10T11:01:00.000Z',
      status: 'done',
      events: [{ line: 1, time: '2026-01-10T11:00:00.000Z', level: 'INFO', event: 'say', data: { text: 'สวัสดี' } }],
      calls: [
        {
          id: 0,
          role: 'pm',
          resumed: false,
          start: '2026-01-10T11:00:00.000Z',
          end: '2026-01-10T11:00:30.000Z',
          status: 'ok',
          subtype: 'success',
          durationMs: 30000,
          turns: 2,
          costUsd: 0.02,
        },
      ],
      totalCostUsd: 0.02,
      findings: [],
      transcripts: {},
    },
  ],
} as unknown as ViewData;

function load(data: ViewData = DATA) {
  const dom = createDom(embedJson(data));
  dom.window.AgentTeamList = new Function(`${LIST_JS}\nreturn AgentTeamList;`)();
  // setTimeout ทำงานทันที (sync) เพื่อข้ามดีเลย์ 150ms ของช่องค้นหา
  new Function('window', 'document', 'fetch', 'setInterval', 'setTimeout', 'clearTimeout', PAGE_JS)(
    dom.window,
    dom.document,
    () => Promise.reject(new Error('offline')),
    () => 0,
    (fn: () => void) => {
      fn();
      return 0;
    },
    () => {},
  );
  return dom;
}
type Dom = ReturnType<typeof load>;

/** เหมือน load() แต่เป็นโหมด live: __LIVE__=true, setInterval ถูกดักไว้เรียกเองผ่าน tick(), fetch ฉีดเข้ามาได้ */
function loadLive(fetchImpl: () => Promise<{ json(): Promise<unknown> }>) {
  const dom = createDom(embedJson(DATA));
  dom.window.AgentTeamList = new Function(`${LIST_JS}\nreturn AgentTeamList;`)();
  dom.window.__LIVE__ = true;
  let pollFn: (() => void) | null = null;
  new Function('window', 'document', 'fetch', 'setInterval', 'setTimeout', 'clearTimeout', PAGE_JS)(
    dom.window,
    dom.document,
    fetchImpl,
    (fn: () => void) => {
      pollFn = fn;
      return 0;
    },
    (fn: () => void) => {
      fn();
      return 0;
    },
    () => {},
  );
  return { ...dom, tick: () => pollFn!() };
}

const cards = (d: Dom) => find(d.app, (n) => n.id.startsWith('call-') && !n.id.endsWith('-toggle'));
const infos = (d: Dom) => find(d.app, (n) => n.className === 'pager-info').map((n) => n.textContent);
const buttons = (d: Dom, text: string) => find(d.app, (n) => n.tagName === 'button' && n.textContent === text);
const selects = (d: Dom, label: string) => find(d.app, (n) => n.tagName === 'select' && n.attrs['aria-label'] === label);
const details = (d: Dom) => find(d.app, (n) => n.tagName === 'details');
const choose = (sel: FakeNode, value: string) => {
  sel.value = value;
  sel.onchange!();
};
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('หน้า logs (DOM จำลอง)', () => {
  it('แบ่งหน้า 20 ต่อหน้าเป็นค่าเริ่มต้น ทั้ง call และ timeline', () => {
    const d = load();
    expect(cards(d)).toHaveLength(20);
    expect(infos(d)).toEqual(['หน้า 1/2 · แสดง 1–20 จาก 25', 'หน้า 1/3 · แสดง 1–20 จาก 45']);
    expect(buttons(d, '« ก่อนหน้า')[0]!.disabled).toBe(true);
  });

  it('ถัดไป / เปลี่ยนเป็น 10 ต่อหน้า -> กลับหน้า 1', () => {
    const d = load();
    buttons(d, 'ถัดไป »')[0]!.onclick!();
    expect(cards(d)).toHaveLength(5);
    expect(infos(d)[0]).toBe('หน้า 2/2 · แสดง 21–25 จาก 25');
    expect(buttons(d, 'ถัดไป »')[0]!.disabled).toBe(true);
    choose(selects(d, 'จำนวนต่อหน้า')[0]!, '10');
    expect(cards(d)).toHaveLength(10);
    expect(infos(d)[0]).toBe('หน้า 1/3 · แสดง 1–10 จาก 25');
    choose(selects(d, 'จำนวนต่อหน้า')[1]!, '50');
    expect(details(d)).toHaveLength(45);
  });

  it('chip role กรองได้ และการ์ดมีสีของ role', () => {
    const d = load();
    const chip = buttons(d, '🔍 qa (13)')[0]!;
    expect(buttons(d, '⚙️ backend (12)')).toHaveLength(1);
    chip.onclick!();
    expect(cards(d)).toHaveLength(13);
    expect(cards(d).every((c) => c.className.includes('role-qa'))).toBe(true);
    expect(buttons(d, '🔍 qa (13)')[0]!.className).toContain('on');
    expect(chip.id).toBe('chip-qa');
  });

  it('ปุ่มในกล่องสาเหตุ: ล้างตัวกรองที่ซ่อน call, ไปหน้าที่มี call, เปิดการ์ด และเลื่อนไปหา', () => {
    const d = load();
    buttons(d, '🔍 qa (13)')[0]!.onclick!();
    buttons(d, '#24 ⚙️ backend')[0]!.onclick!();
    expect(infos(d)[0]).toBe('หน้า 2/2 · แสดง 21–25 จาก 25');
    const card = d.document.getElementById('call-23')!;
    expect(card.children.length).toBeGreaterThan(1);
    expect(card.scrolledIntoView).toBe(true);
  });

  it('กรองสถานะและเรียงตาม cost', () => {
    const d = load();
    choose(selects(d, 'กรองสถานะ')[0]!, 'failed');
    expect(cards(d).map((c) => c.id)).toEqual(['call-23']);
    choose(selects(d, 'กรองสถานะ')[0]!, 'all');
    choose(selects(d, 'เรียงการเรียก agent')[0]!, 'cost-desc');
    expect(cards(d)[0]!.id).toBe('call-24');
  });

  it('timeline: ค้นหาโดยไม่เสีย focus, เรียงใหม่→เก่า และมีป้าย role', () => {
    const d = load();
    const input = d.document.getElementById('ev-search')!;
    d.document.activeElement = input;
    input.value = 'BOOM';
    input.selectionStart = 4;
    input.oninput!();
    expect(details(d)).toHaveLength(1);
    const again = d.document.getElementById('ev-search')!;
    expect(again).not.toBe(input);
    expect(d.document.activeElement).toBe(again);
    expect(again.value).toBe('BOOM');

    // ระหว่าง IME composition ไม่ render จนกว่าจะพิมพ์จบ
    fire(again, 'compositionstart');
    again.value = 'ข้อความที่ 4';
    again.oninput!();
    expect(details(d)).toHaveLength(1);
    fire(again, 'compositionend');
    expect(details(d).length).toBeGreaterThan(1);

    const fresh = load();
    const badges = details(fresh).flatMap((dt) => find(dt, (n) => n.className === 'role-badge role-qa'));
    expect(badges.map((b) => b.textContent)).toEqual(['🔍 qa']);
    choose(selects(fresh, 'เรียง timeline')[0]!, 'desc');
    expect(details(fresh)[0]!.textContent).toContain('ข้อความที่ 45');
  });

  it('IME: ระหว่าง composing การพิมพ์ไม่ trigger render แม้แต่ debounce, compositionend ค่อย render ครั้งเดียว', () => {
    const d = load();
    const input = d.document.getElementById('ev-search')!;
    fire(input, 'compositionstart');
    input.value = 'boom';
    input.oninput!(); // composing อยู่ -> ไม่ควรมีอะไรเกิดขึ้น (ไม่ schedule แม้แต่ debounce)
    expect(details(d)).toHaveLength(45 > 20 ? 20 : 45); // ยังเป็นค่าเริ่มต้น (หน้า 1 ของ 45 event, page size 20)
    fire(input, 'compositionend');
    expect(details(d)).toHaveLength(1); // 'boom' match เฉพาะ run.error
  });

  describe('คงโฟกัสไว้หลัง re-render', () => {
    it('ปุ่มเปลี่ยนหน้า calls: สลับ prev/next โฟกัสถ้าปุ่มเดิมกลาย disabled', () => {
      const d = load();
      const next = d.document.getElementById('calls-next')!;
      d.document.activeElement = next;
      next.onclick!(); // ไปหน้า 2/2 -> next กลาย disabled
      expect(d.document.activeElement!.id).toBe('calls-prev');
      const prevNow = d.document.activeElement!;
      prevNow.onclick!(); // กลับหน้า 1/2 -> prev กลาย disabled
      expect(d.document.activeElement!.id).toBe('calls-next');
    });

    it('select (calls-sort) คงโฟกัสไว้หลัง re-render', () => {
      const d = load();
      const sortSel = selects(d, 'เรียงการเรียก agent')[0]!;
      d.document.activeElement = sortSel;
      choose(sortSel, 'cost-desc');
      expect(d.document.activeElement!.id).toBe('calls-sort');
    });

    it('ปุ่มเปลี่ยนหน้าทั้งคู่กลาย disabled พร้อมกัน (เหลือหน้าเดียว) -> โฟกัสไปที่ select จำนวนต่อหน้าของ section นั้นแทน', () => {
      const d = load();
      const evNext = d.document.getElementById('ev-next')!;
      d.document.activeElement = evNext;
      // เปลี่ยนจำนวนต่อหน้าเป็น 50 -> event ทั้ง 45 อยู่หน้าเดียว ปุ่ม prev/next กลาย disabled ทั้งคู่
      choose(d.document.getElementById('ev-size')!, '50');
      expect(d.document.getElementById('ev-next')!.disabled).toBe(true);
      expect(d.document.getElementById('ev-prev')!.disabled).toBe(true);
      expect(d.document.activeElement!.id).toBe('ev-size');
    });
  });

  describe('ตัวกรองค้าง -> ว่างเปล่ามีปุ่มล้างตัวกรอง', () => {
    it('สลับรอบรันขณะกรองสถานะ failed ค้างอยู่ (รอบใหม่ไม่มี failed เลย) -> ปุ่มล้างตัวกรองคืนค่าเดิม (คง pageSize)', () => {
      const d = load();
      choose(d.document.getElementById('calls-size')!, '10');
      choose(selects(d, 'กรองสถานะ')[0]!, 'failed');
      choose(d.document.getElementById('sel-run')!, '1');
      expect(cards(d)).toHaveLength(0);
      const clearBtn = d.document.getElementById('calls-clear')!;
      expect(clearBtn.textContent).toBe('ล้างตัวกรอง');
      clearBtn.onclick!();
      expect(cards(d)).toHaveLength(1);
      expect(d.document.getElementById('calls-size')!.value).toBe('10');
      // ปุ่มล้างตัวกรองหายไปหลัง render (ไม่มี call ว่างอีกแล้ว) -> focus ต้องไม่หลุดไปที่ body
      // แต่ไปที่ control แรกของ section นี้แทน (calls-status)
      expect(d.document.activeElement!.id).toBe('calls-status');
    });

    it('timeline: ค้นหาไม่เจอ event ใด -> ปุ่มล้างตัวกรองคืนสถานะเริ่มต้น', () => {
      const d = load();
      const input = d.document.getElementById('ev-search')!;
      input.value = 'ไม่มีทางเจอแน่นอน xyz';
      input.oninput!();
      expect(details(d)).toHaveLength(0);
      const clearBtn = d.document.getElementById('ev-clear')!;
      expect(clearBtn.textContent).toBe('ล้างตัวกรอง');
      clearBtn.onclick!();
      expect(details(d).length).toBeGreaterThan(0);
      expect(d.document.getElementById('ev-search')!.value).toBe('');
      // เช่นเดียวกัน: focus ต้องไปที่ ev-search ไม่ใช่หลุดไปที่ body
      expect(d.document.activeElement!.id).toBe('ev-search');
    });
  });

  it('timeline details ที่เปิดไว้ ไม่หายหลัง re-render จากปุ่มของ section อื่น', () => {
    const d = load();
    const target = details(d).find((dt) => dt.textContent.includes('agent.start'))!;
    target.open = true;
    fire(target, 'toggle');
    expect(target.children.some((c) => c.tagName === 'pre')).toBe(true);
    d.document.getElementById('calls-next')!.onclick!(); // ทำ re-render ทั้งหน้าแต่ไม่แตะ timeline
    const again = details(d).find((dt) => dt.textContent.includes('agent.start'))!;
    expect(again.open).toBe(true);
    expect(again.children.some((c) => c.tagName === 'pre')).toBe(true);
  });

  it('aria: ปุ่มประเภท timeline มี aria-pressed, pager-info ไม่มี aria-live (ย้ายไป live region ตัวเดียวนอก #app), เลื่อนไปหัวข้อ section เมื่อเปลี่ยนหน้าด้วย prev/next', () => {
    const d = load();
    const allBtn = d.document.getElementById('ev-type-all')!;
    expect(allBtn.attrs['aria-pressed']).toBe('true');
    const problemBtn = d.document.getElementById('ev-type-problem')!;
    expect(problemBtn.attrs['aria-pressed']).toBe('false');
    const pagerInfo = find(d.app, (n) => n.className === 'pager-info')[0]!;
    expect(pagerInfo.attrs['aria-live']).toBeUndefined();

    const evTitle = d.document.getElementById('ev-title')!;
    const callsTitle = d.document.getElementById('calls-title')!;
    expect(evTitle.scrolledIntoView).toBe(false);
    d.document.getElementById('ev-next')!.onclick!();
    expect(d.document.getElementById('ev-title')!.scrolledIntoView).toBe(true);
    expect(d.document.getElementById('calls-title')!.scrolledIntoView).toBe(false);
    void callsTitle;
  });

  it('aria-live region: สร้างครั้งเดียวนอก #app (ไม่ใช่สร้างใหม่ทุก render) แล้วอัปเดตข้อความเมื่อเปลี่ยนหน้า/จำนวนต่อหน้า', () => {
    const d = load();
    const regionsBeforeAny = find(d.body, (n) => n.attrs['aria-live'] === 'polite');
    expect(regionsBeforeAny).toHaveLength(1);
    const region = regionsBeforeAny[0]!;
    expect(region.className).toContain('sr-only');
    // ไม่ได้อยู่ใน #app
    expect(find(d.app, (n) => n === region)).toHaveLength(0);

    d.document.getElementById('calls-next')!.onclick!();
    expect(region.textContent).toBe('หน้า 2/2 · แสดง 21–25 จาก 25');

    // re-render จากปุ่มอื่น (toggle การ์ด) ไม่ควรสร้าง live region ตัวใหม่ซ้อนขึ้นมาอีก
    d.document.getElementById('call-24-toggle')!.onclick!();
    expect(find(d.body, (n) => n.attrs['aria-live'] === 'polite')).toHaveLength(1);
    expect(find(d.body, (n) => n.attrs['aria-live'] === 'polite')[0]).toBe(region);

    choose(d.document.getElementById('ev-size')!, '10');
    expect(region.textContent).toBe('หน้า 1/5 · แสดง 1–10 จาก 45');
  });

  it('run.level: แสดง "ระดับงาน" ใน summary พร้อมค่า "quick (แบบย่อ)" หรือ "full (แบบเต็ม)" หรือ "-"', () => {
    const withLevel = { ...DATA, runs: [{ ...DATA.runs[0]!, level: 'quick' }, ...DATA.runs.slice(1)] } as unknown as ViewData;
    const d = load(withLevel);
    const stats = find(d.app, (n) => n.className === 'stat');
    const levelStat = stats.find((s) => s.textContent?.includes('ระดับงาน'));
    expect(levelStat).toBeDefined();
    expect(levelStat!.textContent).toContain('quick (แบบย่อ)');

    // fixture เดิมที่ไม่มี level ต้องแสดง "-"
    const d2 = load();
    const stats2 = find(d2.app, (n) => n.className === 'stat');
    const levelStat2 = stats2.find((s) => s.textContent?.includes('ระดับงาน'));
    expect(levelStat2).toBeDefined();
    expect(levelStat2!.textContent).toContain('ระดับงาน');
    expect(levelStat2!.textContent).toContain('-');
  });

  describe('live poll', () => {
    it('เลื่อน poll ออกไปก่อนถ้ากำลังพิมพ์ IME ไม่งั้นอัปเดตข้อมูลโดยตัวกรอง/หน้าเดิมไม่หาย', async () => {
      const nextData = JSON.parse(JSON.stringify(DATA)) as ViewData;
      (nextData.runs as unknown[]).push({
        index: 2,
        start: '2026-01-10T12:00:00.000Z',
        end: '2026-01-10T12:00:01.000Z',
        status: 'done',
        events: [],
        calls: [],
        totalCostUsd: 0,
        findings: [],
        transcripts: {},
      });
      let fetchCalls = 0;
      const dom = loadLive(() => {
        fetchCalls++;
        return Promise.resolve({ json: () => Promise.resolve(nextData) });
      });
      choose(selects(dom, 'กรองสถานะ')[0]!, 'failed');
      expect(cards(dom).map((c) => c.id)).toEqual(['call-23']);

      // 1) กำลังพิมพ์ IME -> เลื่อน poll ออกไป ไม่ fetch เลย
      const search = dom.document.getElementById('ev-search')!;
      fire(search, 'compositionstart');
      dom.tick();
      await flush();
      expect(fetchCalls).toBe(0);
      fire(search, 'compositionend');

      // 2) แค่ activeElement เป็น select เฉย ๆ (ไม่ได้เพิ่งโต้ตอบด้วย mousedown/keydown) -> poll ต้องทำงานจริง
      //    ไม่ใช่ค้างตลอดไปแค่เพราะ render() คืน focus ให้ select ทุกครั้งหลัง onchange (นี่คือบั๊กที่แก้ในเทสต์ถัดไป)
      dom.document.activeElement = dom.document.getElementById('calls-sort')!;
      dom.tick();
      await flush();
      expect(fetchCalls).toBe(1);
      const runSelect = dom.document.getElementById('sel-run')!;
      expect(runSelect.children).toHaveLength(3);
      expect(cards(dom).map((c) => c.id)).toEqual(['call-23']);
    });

    it('เปลี่ยนค่า select (focus ถูกคืนให้ select ตัวเดิมหลัง render) -> live poll ยังอัปเดตข้อมูลใหม่ได้ภายในไม่เกิน 2 tick ไม่ค้างตลอดไป', async () => {
      const nextData = JSON.parse(JSON.stringify(DATA)) as ViewData;
      (nextData.runs as unknown[]).push({
        index: 2,
        start: '2026-01-10T12:00:00.000Z',
        end: '2026-01-10T12:00:01.000Z',
        status: 'done',
        events: [],
        calls: [],
        totalCostUsd: 0,
        findings: [],
        transcripts: {},
      });
      let fetchCalls = 0;
      const dom = loadLive(() => {
        fetchCalls++;
        return Promise.resolve({ json: () => Promise.resolve(nextData) });
      });
      dom.window.__NOW__ = 0;
      const sortSel = selects(dom, 'เรียงการเรียก agent')[0]!;
      dom.document.activeElement = sortSel;
      fire(sortSel, 'mousedown'); // ผู้ใช้เพิ่งเปิด/โต้ตอบกับ dropdown จริง ๆ ที่ now()=0
      choose(sortSel, 'cost-desc'); // onchange -> render() คืน focus ให้ select ตัวใหม่ (id เดิม 'calls-sort')
      expect(dom.document.activeElement!.id).toBe('calls-sort');

      // tick แรก (now=1000, ยังไม่ถึง 3 วิหลัง interaction) -> ข้าม poll กัน dropdown ที่กำลังเปิดอยู่หาย
      dom.window.__NOW__ = 1000;
      dom.tick();
      await flush();
      expect(fetchCalls).toBe(0);

      // tick ที่สอง (now=4000, ผ่านไปเกิน 3 วิแล้ว) -> ต้องอัปเดตจริง แม้ focus จะยังอยู่บน select ตัวเดิม
      dom.window.__NOW__ = 4000;
      dom.tick();
      await flush();
      expect(fetchCalls).toBe(1);
      const runSelect = dom.document.getElementById('sel-run')!;
      expect(runSelect.children).toHaveLength(3);
    });

    it('mousedown บน select -> tick ที่เกิดขึ้นทันที (ภายใน 3 วิ) ถูกข้าม', async () => {
      let fetchCalls = 0;
      const dom = loadLive(() => {
        fetchCalls++;
        return Promise.resolve({ json: () => Promise.resolve(DATA) });
      });
      dom.window.__NOW__ = 500;
      const sortSel = selects(dom, 'เรียงการเรียก agent')[0]!;
      dom.document.activeElement = sortSel;
      fire(sortSel, 'mousedown');
      dom.window.__NOW__ = 500 + 2999;
      dom.tick();
      await flush();
      expect(fetchCalls).toBe(0);
    });
  });
});
