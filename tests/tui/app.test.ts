import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, BUSY_NOTICE, HINT, TEXT_ROW_PLACEHOLDER } from '../../src/tui/app';
import { ScreenStore } from '../../src/tui/screen';

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const ENTER = '\r';
const DOWN = '\u001B[B';
const CTRL_C = '\u0003';
const MENU = [
  { value: 'confirm', label: 'ยืนยัน' },
  { value: 'revise', label: 'ขอแก้' },
];

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** เปิดจอแล้วรอ 1 tick ให้ Ink ผูกตัวรับปุ่มก่อน (ปุ่มที่กดก่อนหน้านั้นหาย) */
async function mount() {
  const store = new ScreenStore(() => 0);
  const onInterrupt = vi.fn();
  const ui = render(React.createElement(App, { store, onInterrupt, now: () => 0 }));
  unmounts.push(ui.unmount);
  await tick();
  return { store, ui, onInterrupt };
}

describe('App', () => {
  it('log และคำถามแบบพิมพ์: พิมพ์ไทยแล้ว Enter ส่งคำตอบ', async () => {
    const { store, ui } = await mount();
    store.print('PM: สวัสดีครับ');
    const answer = store.request({ kind: 'text', prompt: 'คุณอยากได้ระบบอะไร?' });
    await tick();
    expect(ui.lastFrame()).toContain('สวัสดีครับ');
    expect(ui.lastFrame()).toContain('คุณอยากได้ระบบอะไร?');
    expect(ui.lastFrame()).toContain(HINT);
    ui.stdin.write('ทำหน้า login');
    await tick();
    // ข้อความต้องอยู่ต่อจาก "> " ในช่องพิมพ์ ไม่ใช่ไปโผล่บนเส้นขอบ (Ink วัดขนาดผิดเมื่อมีลูกเป็นข้อความว่าง)
    expect(ui.lastFrame()).toContain('> ทำหน้า login');
    ui.stdin.write(ENTER);
    await expect(answer).resolves.toEqual({ text: 'ทำหน้า login' });
  });

  it('เมนู: ↓ แล้ว Enter เลือกตัวที่สอง ; แถวพิมพ์แสดง placeholder', async () => {
    const { store, ui } = await mount();
    const answer = store.request({ kind: 'menu', prompt: 'ยืนยันไหม?', options: MENU, allowText: true });
    await tick();
    expect(ui.lastFrame()).toContain('❯ 1. confirm');
    expect(ui.lastFrame()).toContain('ยืนยัน');
    expect(ui.lastFrame()).toContain(TEXT_ROW_PLACEHOLDER);
    ui.stdin.write(DOWN);
    await tick();
    expect(ui.lastFrame()).toContain('❯ 2. revise');
    ui.stdin.write(ENTER);
    await expect(answer).resolves.toEqual({ choice: 'revise' });
  });

  it('เมนู: พิมพ์ข้อความแล้ว Enter ส่งเป็นข้อความถึง PM', async () => {
    const { store, ui } = await mount();
    const answer = store.request({ kind: 'menu', prompt: 'ยืนยันไหม?', options: MENU, allowText: true });
    await tick();
    ui.stdin.write('ทำไมต้องแบบนี้');
    await tick();
    expect(ui.lastFrame()).toContain('❯ 3. ทำไมต้องแบบนี้');
    ui.stdin.write(ENTER);
    await expect(answer).resolves.toEqual({ text: 'ทำไมต้องแบบนี้' });
  });

  it('ไม่มีคำถาม: พิมพ์ล่วงหน้าได้ Enter ขึ้นคำเตือน ข้อความยังอยู่ และส่งได้เมื่อมีคำถาม', async () => {
    const { store, ui } = await mount();
    ui.stdin.write('ข้อความล่วงหน้า');
    await tick();
    ui.stdin.write(ENTER);
    await tick();
    expect(ui.lastFrame()).toContain(BUSY_NOTICE);
    expect(ui.lastFrame()).toContain('ข้อความล่วงหน้า');
    const answer = store.request({ kind: 'text', prompt: '' });
    await tick();
    expect(ui.lastFrame()).not.toContain(BUSY_NOTICE);
    ui.stdin.write(ENTER);
    await expect(answer).resolves.toEqual({ text: 'ข้อความล่วงหน้า' });
  });

  it('agent ทำงาน: แสดง label, tool ล่าสุด และเวลา', async () => {
    const { store, ui } = await mount();
    store.setActivity({ label: '[QA] api', detail: 'Read a.ts', startedAt: 0 });
    await tick();
    expect(ui.lastFrame()).toContain('[QA] api · Read a.ts · 0m00s');
  });

  it('Ctrl+C เรียก onInterrupt ไม่ปิดจอเอง', async () => {
    const { ui, onInterrupt } = await mount();
    ui.stdin.write(CTRL_C);
    await tick();
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('ปิดแล้ว: เหลือแต่ log ไม่มีช่องพิมพ์', async () => {
    const { store, ui } = await mount();
    store.print('จบงาน');
    store.close(new Error('ปิด'));
    await tick();
    expect(ui.lastFrame()).toContain('จบงาน');
    expect(ui.lastFrame()).not.toContain(HINT);
  });
  it('แถบสถานะ: ชื่องาน เฟส งาน เวลา และโควตา', async () => {
    const store = new ScreenStore(() => 0);
    const ui = render(React.createElement(App, { store, onInterrupt: () => {}, now: () => 754_000 }));
    unmounts.push(ui.unmount);
    await tick();
    store.setBar({ title: 'ระบบ login', phase: 'BUILD', tasks: { done: 2, total: 5 }, quota: { text: 'โควตา 5 ชม. 85%', tone: 'warn' } });
    await tick();
    expect(ui.lastFrame()).toContain('ระบบ login · BUILD · งาน 2/5 · 12m34s');
    expect(ui.lastFrame()).toContain('โควตา 5 ชม. 85%');
  });

  it('คำแนะนำปุ่มอยู่ในช่องพิมพ์ตอนว่าง และหายเมื่อพิมพ์', async () => {
    const { ui } = await mount();
    expect(ui.lastFrame()).toContain(HINT);
    ui.stdin.write('ก');
    await tick();
    expect(ui.lastFrame()).not.toContain(HINT);
    expect(ui.lastFrame()).toContain('> ก');
  });
});
