import { describe, expect, it } from 'vitest';
import { LIST_JS } from '../../src/logview/list-assets';
import { PAGE_JS } from '../../src/logview/page-assets';
import { embedJson } from '../../src/logview/render';
import type { ViewData } from '../../src/logview/view-data';
import { createDom, find, type FakeNode } from '../helpers/dom-shim';

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
  ],
} as unknown as ViewData;

function load() {
  const dom = createDom(embedJson(DATA));
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
const cards = (d: Dom) => find(d.app, (n) => n.id.startsWith('call-'));
const infos = (d: Dom) => find(d.app, (n) => n.className === 'pager-info').map((n) => n.textContent);
const buttons = (d: Dom, text: string) => find(d.app, (n) => n.tagName === 'button' && n.textContent === text);
const selects = (d: Dom, label: string) => find(d.app, (n) => n.tagName === 'select' && n.attrs['aria-label'] === label);
const details = (d: Dom) => find(d.app, (n) => n.tagName === 'details');
const choose = (sel: FakeNode, value: string) => {
  sel.value = value;
  sel.onchange!();
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
    again.listeners['compositionstart']!();
    again.value = 'ข้อความที่ 4';
    again.oninput!();
    expect(details(d)).toHaveLength(1);
    again.listeners['compositionend']!();
    expect(details(d).length).toBeGreaterThan(1);

    const fresh = load();
    const badges = details(fresh).flatMap((dt) => find(dt, (n) => n.className === 'role-badge role-qa'));
    expect(badges.map((b) => b.textContent)).toEqual(['🔍 qa']);
    choose(selects(fresh, 'เรียง timeline')[0]!, 'desc');
    expect(details(fresh)[0]!.textContent).toContain('ข้อความที่ 45');
  });
});
