import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readEvents } from '../../src/headless/files';
import { HeadlessIO } from '../../src/headless/io';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('HeadlessIO.say kind', () => {
  it('เขียน event เป็น plainText (pm มี [PM] เหมือนเดิม ไม่มีสี)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-hio-'));
    dirs.push(dir);
    const io = new HeadlessIO({ dir, idleTimeoutMs: 1000 });
    io.say('สวัสดี', 'pm');
    io.say('ระวัง', 'warn');
    expect(readEvents(dir).map((e) => e.text)).toEqual(['\n[PM] สวัสดี\n', 'ระวัง']);
  });
});
