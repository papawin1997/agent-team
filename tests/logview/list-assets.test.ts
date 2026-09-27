import { describe, expect, it } from 'vitest';
import { LIST_JS } from '../../src/logview/list-assets';

interface Page<T> { items: T[]; page: number; pages: number; pageSize: number; total: number; from: number; to: number }
interface Call { id: number; role: string; status: string; durationMs?: number; costUsd?: number; turns?: number }
interface Ev { line: number; time: string; level: string; event: string; data: Record<string, unknown> }
interface CallOpts { roles: string[]; status: string; sort: string; page: number; pageSize: number }
interface EvOpts { type: string; query: string; sort: string; page: number; pageSize: number }
interface ListApi {
  PAGE_SIZES: number[];
  DEFAULT_PAGE_SIZE: number;
  roleStyle(role: string): { icon: string; cls: string };
  roleCounts(calls: Call[]): { role: string; count: number }[];
  paginate<T>(items: T[], page: number, pageSize: number): Page<T>;
  listCalls(calls: Call[], opts: CallOpts): Page<Call>;
  pageOfCall(calls: Call[], opts: CallOpts, id: number): number;
  summaryOf(ev: Ev): string;
  listEvents(events: Ev[], opts: EvOpts): Page<Ev>;
}

const L = new Function(`${LIST_JS}\nreturn AgentTeamList;`)() as ListApi;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const callOpts = (over: Partial<CallOpts> = {}): CallOpts => ({
  roles: [],
  status: 'all',
  sort: 'start-asc',
  page: 1,
  pageSize: 20,
  ...over,
});
const evOpts = (over: Partial<EvOpts> = {}): EvOpts => ({ type: 'all', query: '', sort: 'asc', page: 1, pageSize: 20, ...over });
const calls: Call[] = [
  { id: 0, role: 'pm', status: 'ok', durationMs: 5000, costUsd: 0.2, turns: 3 },
  { id: 1, role: 'qa', status: 'failed', durationMs: 90000, costUsd: 0.05, turns: 1 },
  { id: 2, role: 'backend', status: 'ok', durationMs: 60000, costUsd: 0.9, turns: 14 },
  { id: 3, role: 'qa', status: 'unfinished' },
  { id: 4, role: 'pm', status: 'ok', durationMs: 5000, costUsd: 0.1, turns: 2 },
];
const ev = (line: number, event: string, data: Record<string, unknown>, level = 'INFO'): Ev => ({
  line,
  time: `2026-01-10T09:00:${String(line).padStart(2, '0')}.000Z`,
  level,
  event,
  data,
});
const events: Ev[] = [
  ev(1, 'run.start', { pid: 1 }),
  ev(2, 'say', { text: 'สวัสดี Outlook' }),
  ev(3, 'user.input', { prompt: '> ', answer: 'ต่อเลย' }),
  ev(4, 'agent.start', { role: 'qa' }),
  ev(5, 'agent.result', { role: 'qa', subtype: 'success' }, 'WARN'),
  ev(6, 'run.error', { message: 'qa: BOOM' }, 'ERROR'),
];

describe('paginate', () => {
  it('ตัดหน้าและบอกช่วงที่แสดง', () => {
    expect(L.paginate(range(25), 3, 10)).toEqual({
      items: [20, 21, 22, 23, 24], page: 3, pages: 3, pageSize: 10, total: 25, from: 21, to: 25,
    });
  });

  it('หน้าเกิน/ต่ำกว่า/ไม่ใช่ตัวเลข -> บีบให้อยู่ในช่วง', () => {
    expect(L.paginate(range(25), 99, 10).page).toBe(3);
    expect(L.paginate(range(25), 0, 10).page).toBe(1);
    expect(L.paginate(range(25), Number.NaN, 10).page).toBe(1);
  });

  it('ขนาดหน้าที่ไม่ใช่ 10/20/50 -> ใช้ 20', () => {
    expect(L.PAGE_SIZES).toEqual([10, 20, 50]);
    expect(L.DEFAULT_PAGE_SIZE).toBe(20);
    expect(L.paginate(range(25), 1, 7)).toMatchObject({ pageSize: 20, pages: 2, from: 1, to: 20 });
    expect(L.paginate(range(120), 1, 50)).toMatchObject({ pageSize: 50, pages: 3, to: 50 });
  });

  it('รายการว่าง -> 1 หน้า แสดง 0–0', () => {
    expect(L.paginate([], 1, 20)).toEqual({ items: [], page: 1, pages: 1, pageSize: 20, total: 0, from: 0, to: 0 });
  });
});

describe('roleStyle / roleCounts', () => {
  it('role ที่รู้จักได้ไอคอนและ class ของตัวเอง ที่เหลือเป็น other', () => {
    expect(L.roleStyle('pm')).toEqual({ icon: '🧭', cls: 'role-pm' });
    expect(L.roleStyle('planning')).toEqual({ icon: '📐', cls: 'role-planning' });
    expect(L.roleStyle('frontend')).toEqual({ icon: '🎨', cls: 'role-frontend' });
    expect(L.roleStyle('backend')).toEqual({ icon: '⚙️', cls: 'role-backend' });
    expect(L.roleStyle('qa')).toEqual({ icon: '🔍', cls: 'role-qa' });
    expect(L.roleStyle('security')).toEqual({ icon: '🛡️', cls: 'role-security' });
    expect(L.roleStyle('weird')).toEqual({ icon: '🤖', cls: 'role-other' });
    expect(L.roleStyle('constructor')).toEqual({ icon: '🤖', cls: 'role-other' });
  });

  it('นับจำนวนต่อ role ตามลำดับที่เจอครั้งแรก', () => {
    expect(L.roleCounts(calls)).toEqual([
      { role: 'pm', count: 2 },
      { role: 'qa', count: 2 },
      { role: 'backend', count: 1 },
    ]);
  });
});

describe('listCalls', () => {
  const ids = (opts: Partial<CallOpts>) => L.listCalls(calls, callOpts(opts)).items.map((c) => c.id);

  it('ค่าเริ่มต้น: ทุก call เรียงตามเวลาเริ่ม เก่า→ใหม่', () => {
    expect(ids({})).toEqual([0, 1, 2, 3, 4]);
    expect(ids({ sort: 'start-desc' })).toEqual([4, 3, 2, 1, 0]);
  });

  it('กรองหลาย role และสถานะ', () => {
    expect(ids({ roles: ['qa', 'backend'] })).toEqual([1, 2, 3]);
    expect(ids({ status: 'failed' })).toEqual([1]);
    expect(ids({ status: 'unfinished' })).toEqual([3]);
    expect(ids({ roles: ['pm'], status: 'ok' })).toEqual([0, 4]);
  });

  it('เรียงตามระยะเวลา/cost/turns มากไปน้อย ค่าที่ไม่มีไว้ท้ายสุด เสมอกันเรียงตาม id', () => {
    expect(ids({ sort: 'duration-desc' })).toEqual([1, 2, 0, 4, 3]);
    expect(ids({ sort: 'cost-desc' })).toEqual([2, 0, 4, 1, 3]);
    expect(ids({ sort: 'turns-desc' })).toEqual([2, 0, 4, 1, 3]);
  });

  it('sort ที่ไม่รู้จัก -> start-asc', () => {
    expect(ids({ sort: 'nope' })).toEqual([0, 1, 2, 3, 4]);
  });

  it('pageOfCall: หน้าที่ call อยู่หลังกรอง/เรียง หรือ 0 ถ้าถูกซ่อน', () => {
    const many: Call[] = range(25).map((i) => ({ id: i, role: i % 2 ? 'backend' : 'qa', status: 'ok' }));
    expect(L.pageOfCall(many, callOpts({ pageSize: 10 }), 23)).toBe(3);
    expect(L.pageOfCall(many, callOpts({ pageSize: 10, sort: 'start-desc' }), 23)).toBe(1);
    expect(L.pageOfCall(many, callOpts({ roles: ['qa'] }), 23)).toBe(0);
  });
});

describe('listEvents', () => {
  const lines = (opts: Partial<EvOpts>) => L.listEvents(events, evOpts(opts)).items.map((e) => e.line);

  it('ประเภท: problem / agent / user / say', () => {
    expect(lines({ type: 'problem' })).toEqual([5, 6]);
    expect(lines({ type: 'agent' })).toEqual([4, 5]);
    expect(lines({ type: 'user' })).toEqual([3]);
    expect(lines({ type: 'say' })).toEqual([2]);
  });

  it('ค้นหาข้อความทั้งชื่อ event และ summary แบบไม่สนตัวพิมพ์', () => {
    expect(lines({ query: 'outlook' })).toEqual([2]);
    expect(lines({ query: 'boom' })).toEqual([6]);
    expect(lines({ query: 'AGENT.RESULT' })).toEqual([5]);
    expect(lines({ query: 'ต่อเลย' })).toEqual([3]);
    expect(lines({ query: '   ' })).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('เรียงใหม่→เก่า และแบ่งหน้า', () => {
    expect(lines({ sort: 'desc' })).toEqual([6, 5, 4, 3, 2, 1]);
    const many = range(45).map((i) => ev(i + 1, 'say', { text: `ข้อความ ${i + 1}` }));
    const res = L.listEvents(many, evOpts({ sort: 'desc', page: 3, pageSize: 20 }));
    expect(res.items.map((e) => e.line)).toEqual([5, 4, 3, 2, 1]);
    expect(res).toMatchObject({ page: 3, pages: 3, total: 45, from: 41, to: 45 });
  });

  it('summaryOf: say/raw ใช้ text, user.* ใช้คำตอบ/คำถาม, อื่น ๆ เป็น JSON', () => {
    expect(L.summaryOf(events[1]!)).toBe('สวัสดี Outlook');
    expect(L.summaryOf(events[2]!)).toBe('ต่อเลย');
    expect(L.summaryOf(ev(9, 'user.choice', { prompt: 'ยืนยัน?', choice: 'confirm' }))).toBe('ยืนยัน? → confirm');
    expect(L.summaryOf(events[0]!)).toBe('{"pid":1}');
  });
});

describe('LIST_JS', () => {
  it('ไม่มี </script และไม่มี syntax error', () => {
    expect(LIST_JS).not.toContain('</script');
    expect(() => new Function(LIST_JS)).not.toThrow();
  });
});
