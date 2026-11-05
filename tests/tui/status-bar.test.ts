import { describe, expect, it } from 'vitest';
import { newState } from '../../src/state';
import { type BarInfo, jobBar, layoutBar, watchStore } from '../../src/tui/status-bar';
import { buildState, makeDesign, makeTask } from '../helpers/builders';
import { MemoryStore } from '../helpers/fakes';

describe('jobBar', () => {
  it('REQUIREMENTS: ชื่องานและเฟส ไม่มีจำนวนงาน', () => {
    expect(jobBar({ ...newState(), title: 'ระบบ login' })).toEqual({ title: 'ระบบ login', phase: 'REQUIREMENTS' });
  });

  it('BUILD: นับงานที่เสร็จจาก progress', () => {
    const state = buildState(makeDesign([makeTask('api'), makeTask('ui', 'frontend', ['api'])]));
    state.progress.api!.done = true;
    expect(jobBar(state)).toEqual({ phase: 'BUILD', tasks: { done: 1, total: 2 } });
  });
});

describe('layoutBar', () => {
  const full: BarInfo = {
    title: 'ระบบ login',
    phase: 'BUILD',
    tasks: { done: 2, total: 5 },
    quota: { text: 'โควตา 5 ชม. 85%', tone: 'warn' },
  };

  it('กว้างพอ: แสดงครบ', () => {
    expect(layoutBar(full, '12m34s', 100)).toEqual({ left: 'ระบบ login · BUILD · งาน 2/5 · 12m34s', right: 'โควตา 5 ชม. 85%' });
  });

  it('จอแคบ: ตัดชื่องาน แล้วเวลา แล้วจำนวนงาน แต่เฟสและโควตาอยู่เสมอ', () => {
    expect(layoutBar(full, '12m34s', 45).left).toBe('BUILD · งาน 2/5 · 12m34s');
    expect(layoutBar(full, '12m34s', 35).left).toBe('BUILD · งาน 2/5');
    expect(layoutBar(full, '12m34s', 10)).toEqual({ left: 'BUILD', right: 'โควตา 5 ชม. 85%' });
  });

  it('ชื่องานยาวเกิน 30 ตัวอักษรถูกตัดเป็น … ; ยังไม่มีข้อมูล = เหลือแต่เวลา', () => {
    expect(layoutBar({ title: 'ก'.repeat(40), phase: 'DESIGN' }, '0m05s', 200).left).toBe(`${'ก'.repeat(29)}… · DESIGN · 0m05s`);
    expect(layoutBar({}, '0m05s', 80)).toEqual({ left: '0m05s', right: '' });
  });
});

describe('watchStore', () => {
  it('save แล้วแจ้ง ; load/saveArtifact ส่งต่อ ; ตัวแจ้งพังไม่ทำให้ save ล้ม', async () => {
    const inner = new MemoryStore();
    const seen: string[] = [];
    const store = watchStore(inner, (s) => seen.push(s.phase));
    await store.save(newState());
    await store.saveArtifact('design.json', { x: 1 });
    expect(seen).toEqual(['REQUIREMENTS']);
    expect(await store.load()).toMatchObject({ phase: 'REQUIREMENTS' });
    expect(inner.artifacts.get('design.json')).toEqual({ x: 1 });
    const broken = watchStore(inner, () => {
      throw new Error('boom');
    });
    await expect(broken.save(newState())).resolves.toBeUndefined();
  });
});
