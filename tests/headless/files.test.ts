import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendEvent,
  headlessPath,
  lastEventSeq,
  readEvents,
  readJsonSafe,
  removeQuietly,
  writeExit,
  writeJsonAtomic,
  type ExitInfo,
} from '../../src/headless/files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-headless-files-'));
});

describe('writeJsonAtomic / readJsonSafe', () => {
  it('เขียนแล้วอ่านกลับได้ และไม่เหลือไฟล์ .tmp', () => {
    const file = headlessPath(dir, 'question');
    writeJsonAtomic(file, { id: 'q1', text: 'ไทย 🙂' });
    expect(readJsonSafe(file)).toEqual({ id: 'q1', text: 'ไทย 🙂' });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('เขียนทับไฟล์เดิมได้', () => {
    const file = headlessPath(dir, 'answer');
    writeJsonAtomic(file, { n: 1 });
    writeJsonAtomic(file, { n: 2 });
    expect(readJsonSafe(file)).toEqual({ n: 2 });
  });

  it('ไม่มีไฟล์ หรือ JSON พัง → undefined ไม่ throw', () => {
    expect(readJsonSafe(path.join(dir, 'none.json'))).toBeUndefined();
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{"id": "q', 'utf8');
    expect(readJsonSafe(broken)).toBeUndefined();
  });

  it('removeQuietly ไม่ throw แม้ไม่มีไฟล์', () => {
    expect(() => removeQuietly(path.join(dir, 'none.json'))).not.toThrow();
  });
});

describe('events', () => {
  it('append แล้วอ่านตาม since และข้ามบรรทัดที่เขียนไม่จบ', () => {
    appendEvent(dir, { seq: 1, at: 't1', text: 'a' });
    appendEvent(dir, { seq: 2, at: 't2', text: 'b' });
    fs.appendFileSync(headlessPath(dir, 'events'), '{"seq":3,"at":"t3","te', 'utf8');
    expect(readEvents(dir).map((e) => e.text)).toEqual(['a', 'b']);
    expect(readEvents(dir, 1).map((e) => e.text)).toEqual(['b']);
    expect(lastEventSeq(dir)).toBe(2);
  });

  it('ไม่มีไฟล์ events → [] และ lastEventSeq = 0', () => {
    expect(readEvents(dir)).toEqual([]);
    expect(lastEventSeq(dir)).toBe(0);
  });
});

describe('writeExit', () => {
  it('เขียน exit.json พร้อม message', () => {
    writeExit(dir, 'error', 'พัง', new Date('2026-09-28T00:00:00Z'));
    expect(readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'))).toEqual({
      status: 'error',
      message: 'พัง',
      at: '2026-09-28T00:00:00.000Z',
    });
  });

  it('ไม่มี message ก็ไม่มี key message', () => {
    writeExit(dir, 'done');
    expect(readJsonSafe<ExitInfo>(headlessPath(dir, 'exit'))).not.toHaveProperty('message');
  });
});
