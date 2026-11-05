import { describe, expect, it } from 'vitest';
import { newState } from '../../src/state';
import { ScreenStore } from '../../src/tui/screen';
import { cleanPrompt, menuOptions, TuiIO } from '../../src/tui/tui-io';

function setup() {
  const store = new ScreenStore(() => 1000);
  let unmounts = 0;
  const io = new TuiIO({
    store,
    color: false,
    mount: () => ({ unmount: () => void (unmounts += 1) }),
    now: () => 1000,
  });
  return { store, io, unmounts: () => unmounts };
}
const lastLog = (store: ScreenStore) => store.getState().log.at(-1)?.text;

describe('cleanPrompt / menuOptions', () => {
  it('ตัด "> " ท้าย prompt ของ readline ออก', () => {
    expect(cleanPrompt('คุณอยากได้ระบบอะไร?\n> ')).toBe('คุณอยากได้ระบบอะไร?');
    expect(cleanPrompt('> ')).toBe('');
    expect(cleanPrompt('เลือกงาน')).toBe('เลือกงาน');
  });

  it('ใส่ป้ายภาษาไทยเมื่อมี', () => {
    expect(menuOptions(['confirm', 'x'])).toEqual([{ value: 'confirm', label: 'ยืนยัน' }, { value: 'x' }]);
  });
});

describe('TuiIO', () => {
  it('say -> log (color=false ได้ข้อความไม่มีสี)', () => {
    const { store, io } = setup();
    io.say('สวัสดี', 'system');
    expect(store.getState().log.map((l) => l.text)).toEqual(['สวัสดี']);
  });

  it('ask: แสดง prompt ที่ตัด "> " แล้ว resolve เมื่อตอบ พร้อมพิมพ์คำตอบลง log', async () => {
    const { store, io } = setup();
    const answer = io.ask('คุณอยากได้ระบบอะไร?\n> ');
    expect(store.getState().prompt).toMatchObject({ kind: 'text', prompt: 'คุณอยากได้ระบบอะไร?' });
    store.answer({ text: '  ทำหน้า login ' });
    await expect(answer).resolves.toBe('ทำหน้า login');
    expect(store.getState().prompt).toBeUndefined();
    expect(lastLog(store)).toBe('> ทำหน้า login');
  });

  it('chooseOrText: เมนูมีแถวพิมพ์และป้ายไทย ; คืนตัวเลือกหรือ { text }', async () => {
    const { store, io } = setup();
    const first = io.chooseOrText('ยืนยันไหม?', ['confirm', 'revise'] as const);
    expect(store.getState().prompt).toMatchObject({
      kind: 'menu',
      allowText: true,
      options: [
        { value: 'confirm', label: 'ยืนยัน' },
        { value: 'revise', label: 'ขอแก้' },
      ],
    });
    store.answer({ choice: 'revise' });
    await expect(first).resolves.toBe('revise');
    expect(lastLog(store)).toBe('เลือก: ขอแก้ (revise)');
    const second = io.chooseOrText('ยืนยันไหม?', ['confirm', 'revise'] as const);
    store.answer({ text: ' ทำไมต้องแบบนี้ ' });
    await expect(second).resolves.toEqual({ text: 'ทำไมต้องแบบนี้' });
    expect(lastLog(store)).toBe('> ทำไมต้องแบบนี้');
  });

  it('choose: เมนูไม่มีแถวพิมพ์ (คำถามโควตา)', async () => {
    const { store, io } = setup();
    const answer = io.choose('จะทำอย่างไรต่อ?\n> ', ['handoff', 'continue'] as const);
    expect(store.getState().prompt).toMatchObject({
      kind: 'menu',
      allowText: false,
      prompt: 'จะทำอย่างไรต่อ?',
      options: [
        { value: 'handoff', label: 'หยุดแล้วเขียนไฟล์ส่งต่องาน' },
        { value: 'continue', label: 'ทำต่อ' },
      ],
    });
    store.answer({ choice: 'continue' });
    await expect(answer).resolves.toBe('continue');
  });

  it('status: start/update/stop -> activity ของจอ', () => {
    const { store, io } = setup();
    io.status.update('ไม่มี agent ทำงาน: เมิน');
    expect(store.getState().activity).toBeUndefined();
    io.status.start('[QA] api');
    io.status.update('Read a.ts');
    expect(store.getState().activity).toEqual({ label: '[QA] api', detail: 'Read a.ts', startedAt: 1000 });
    io.status.stop();
    expect(store.getState().activity).toBeUndefined();
  });

  it('close: คำถามที่ค้าง reject ด้วย EOF, ปิดจอครั้งเดียว และถามต่อไม่ได้', async () => {
    const { store, io, unmounts } = setup();
    const pending = io.ask('> ');
    io.close();
    io.close();
    await expect(pending).rejects.toThrow('stdin ถูกปิด');
    await expect(io.ask('> ')).rejects.toThrow('stdin ถูกปิด');
    expect(unmounts()).toBe(1);
    expect(store.getState().closed).toBe(true);
  });
});

describe('ScreenStore', () => {
  it('ถามซ้อนไม่ได้ ; คำถามใหม่ล้าง notice ; subscribe ได้รับแจ้งทุกครั้งที่เปลี่ยน', async () => {
    const store = new ScreenStore();
    let calls = 0;
    const off = store.subscribe(() => void (calls += 1));
    store.setNotice('รอก่อน');
    const first = store.request({ kind: 'text', prompt: 'a' });
    expect(store.getState().notice).toBeUndefined();
    await expect(store.request({ kind: 'text', prompt: 'b' })).rejects.toThrow('มีคำถามค้างอยู่แล้ว');
    store.answer({ text: 'x' });
    await expect(first).resolves.toEqual({ text: 'x' });
    off();
    const before = calls;
    store.print('y');
    expect(calls).toBe(before);
    expect(before).toBeGreaterThanOrEqual(3);
  });
});

describe('TuiIO: แถบสถานะ', () => {
  it('showMode / showJob / showQuota เขียนลง bar ; startedAt มาจาก now', () => {
    const { store, io } = setup();
    expect(store.getState().startedAt).toBe(1000);
    io.showMode('ปรึกษา');
    expect(store.getState().bar).toEqual({ phase: 'ปรึกษา' });
    io.showJob({ ...newState(), title: 'งาน A' });
    io.showQuota({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.85 });
    expect(store.getState().bar).toEqual({ title: 'งาน A', phase: 'REQUIREMENTS', quota: { text: 'โควตา 5 ชม. 85%', tone: 'warn' } });
  });

  it('showJob ล้างจำนวนงานเก่าเมื่อออกจาก BUILD', () => {
    const { store, io } = setup();
    store.setBar({ tasks: { done: 1, total: 2 } });
    io.showJob(newState());
    expect(store.getState().bar.tasks).toBeUndefined();
  });
});
