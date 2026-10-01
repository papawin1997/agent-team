import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HandoffStore, handoffSlug } from '../../src/ask/handoff-store';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-ask-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const at = (min: number) => () => new Date(2026, 8, 30, 15, min, 0);

describe('handoffSlug', () => {
  it('แทนอักขระที่ใช้ในชื่อไฟล์ไม่ได้และช่องว่างด้วย - และตัด - หัวท้าย', () => {
    expect(handoffSlug('แก้ a/b: c?')).toBe('แก้-a-b-c');
    expect(handoffSlug('  ')).toBe('handoff');
    expect(Array.from(handoffSlug('ก'.repeat(80)))).toHaveLength(40);
  });
});

describe('HandoffStore', () => {
  it('save เขียน .agent-team/ask/<เวลา>-<slug>.md ด้วยหัวเรื่องและเนื้อหา', async () => {
    const project = tmp();
    const store = new HandoffStore(project, at(30));
    const file = await store.save({ title: 'เรื่อง export', markdown: '## เป้าหมาย\n- x\n' });
    expect(file).toBe(path.join(project, '.agent-team', 'ask', '20260930-153000-เรื่อง-export.md'));
    expect(fs.readFileSync(file, 'utf8')).toBe('# เรื่อง export\n\n## เป้าหมาย\n- x\n');
  });

  it('ชื่อชนกันในวินาทีเดียวกัน -> เติม -2', async () => {
    const store = new HandoffStore(tmp(), at(30));
    const a = await store.save({ title: 't', markdown: 'a' });
    const b = await store.save({ title: 't', markdown: 'b' });
    expect(path.basename(a)).toBe('20260930-153000-t.md');
    expect(path.basename(b)).toBe('20260930-153000-t-2.md');
  });

  it('list: ใหม่สุดก่อน อ่าน title จากบรรทัดแรก และเวลาจากชื่อไฟล์', async () => {
    const project = tmp();
    await new HandoffStore(project, at(10)).save({ title: 'เก่า', markdown: 'a' });
    await new HandoffStore(project, at(20)).save({ title: 'ใหม่', markdown: 'b' });
    fs.writeFileSync(path.join(project, '.agent-team', 'ask', 'note.txt'), 'x');
    const list = await new HandoffStore(project).list();
    expect(list.map((h) => [h.title, h.savedAt])).toEqual([
      ['ใหม่', '2026-09-30 15:20'],
      ['เก่า', '2026-09-30 15:10'],
    ]);
  });

  it('list: ยังไม่มีโฟลเดอร์ -> []', async () => {
    expect(await new HandoffStore(tmp()).list()).toEqual([]);
  });

  it('read คืนเนื้อหาไฟล์', async () => {
    const store = new HandoffStore(tmp(), at(30));
    const file = await store.save({ title: 't', markdown: 'เนื้อหา' });
    expect(await store.read(file)).toBe('# t\n\nเนื้อหา\n');
  });
});
