import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentCall } from '../../src/logview/parse-log';
import {
  clip,
  createTranscriptCache,
  loadCallTranscript,
  MAX_STEP_CHARS,
  sliceTranscript,
  transcriptsDir,
} from '../../src/logview/transcripts';

const at = (ms: string) => `2026-01-10T09:${ms}.000Z`;
const jsonl = (...entries: unknown[]) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

// รูปแบบเลียนแบบ transcript จริงของ Claude Agent SDK
const userPrompt = (ms: string) => ({
  type: 'user',
  timestamp: at(ms),
  message: { role: 'user', content: [{ type: 'text', text: 'Task under review: ...' }] },
});
const toolUse = (ms: string) => ({
  type: 'assistant',
  timestamp: at(ms),
  message: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: 'จะรันเทสต์' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'python -m pytest' } },
    ],
  },
});
const toolResult = (ms: string, content: unknown) => ({
  type: 'user',
  timestamp: at(ms),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content }] },
});
const overloaded = (ms: string) => ({
  type: 'system',
  subtype: 'api_error',
  level: 'error',
  timestamp: at(ms),
  error: {
    message: '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    status: 529,
    formatted: '529 Overloaded',
    connection: null,
    isNetworkDown: false,
  },
});
const offline = (ms: string) => ({
  type: 'system',
  subtype: 'api_error',
  level: 'error',
  timestamp: at(ms),
  error: {
    message: 'Connection error.',
    formatted: "Can't reach the API server (ENOTFOUND)",
    connection: { code: 'ENOTFOUND' },
    isNetworkDown: true,
  },
});
const call = (over: Partial<AgentCall> = {}): AgentCall => ({
  id: 0,
  role: 'qa',
  resumed: false,
  start: at('01:00'),
  end: at('06:00'),
  status: 'failed',
  ...over,
});

describe('transcriptsDir', () => {
  it('แปลง projectDir เป็นชื่อโฟลเดอร์แบบ Claude Code', () => {
    expect(transcriptsDir('C:\\work\\my\\mail-sender', {}, '/home/u')).toBe(
      path.join('/home/u', '.claude', 'projects', 'C--work-my-mail-sender'),
    );
  });

  it('ใช้ CLAUDE_CONFIG_DIR ถ้าตั้งไว้', () => {
    expect(transcriptsDir('/work/app', { CLAUDE_CONFIG_DIR: '/cfg' }, '/home/u')).toBe(
      path.join('/cfg', 'projects', '-work-app'),
    );
  });
});

describe('clip', () => {
  it('ตัดข้อความที่ยาวเกินและบอกจำนวนที่ตัด', () => {
    expect(clip('x'.repeat(MAX_STEP_CHARS + 5))).toBe(`${'x'.repeat(MAX_STEP_CHARS)}…(ตัด 5 ตัวอักษร)`);
    expect(clip('สั้น')).toBe('สั้น');
  });
});

describe('sliceTranscript', () => {
  it('แปลง entry เป็น step และข้าม prompt ของ user, thinking และ entry นอกช่วงเวลา', () => {
    const text = jsonl(
      toolUse('00:30'),
      userPrompt('01:00'),
      toolUse('02:00'),
      toolResult('02:10', 'No module named pytest'),
      overloaded('03:00'),
      toolUse('09:00'),
    );
    expect(sliceTranscript(text, at('01:00'), at('06:00'))).toEqual([
      { kind: 'text', time: at('02:00'), text: 'จะรันเทสต์' },
      { kind: 'tool_use', time: at('02:00'), name: 'Bash', input: '{"command":"python -m pytest"}' },
      { kind: 'tool_result', time: at('02:10'), isError: true, text: 'No module named pytest' },
      { kind: 'api_error', time: at('03:00'), status: 529, message: '529 Overloaded', networkDown: false },
    ]);
  });

  it('api error แบบเน็ตหลุด -> networkDown และไม่มี status', () => {
    expect(sliceTranscript(jsonl(offline('02:00')), at('01:00'))).toEqual([
      {
        kind: 'api_error',
        time: at('02:00'),
        status: undefined,
        message: "Can't reach the API server (ENOTFOUND)",
        networkDown: true,
      },
    ]);
  });

  it('tool_result แบบ array ของ text และบรรทัดพังถูกข้าม', () => {
    const text = `{broken\n${jsonl(toolResult('02:00', [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]))}`;
    expect(sliceTranscript(text, at('01:00'))).toEqual([
      { kind: 'tool_result', time: at('02:00'), isError: true, text: 'a\nb' },
    ]);
  });

  it('ไม่มีเวลาจบ (call ค้าง) -> เอาทุกอย่างหลังเวลาเริ่ม', () => {
    expect(sliceTranscript(jsonl(overloaded('59:00')), at('01:00'))).toHaveLength(1);
  });
});

describe('loadCallTranscript', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-tx-'));
  });

  it('อ่านไฟล์ <sessionId>.jsonl แล้วตัดตามช่วงเวลา', async () => {
    await fs.writeFile(path.join(dir, 's-qa.jsonl'), jsonl(overloaded('03:00'), overloaded('09:00')));
    const t = loadCallTranscript(dir, call({ sessionId: 's-qa' }));
    expect(t.file).toBe(path.join(dir, 's-qa.jsonl'));
    expect(t.steps).toHaveLength(1);
    expect(t.note).toBeUndefined();
  });

  it('ไม่พบไฟล์ -> note บอกชื่อไฟล์', () => {
    const t = loadCallTranscript(dir, call({ sessionId: 'nope' }));
    expect(t.steps).toEqual([]);
    expect(t.note).toContain('nope.jsonl');
  });

  it('ไม่มี sessionId -> หาไฟล์ที่ entry แรกอยู่ในช่วงเวลาของ call', async () => {
    await fs.writeFile(path.join(dir, 'older.jsonl'), jsonl(userPrompt('00:10'), overloaded('03:00')));
    await fs.writeFile(path.join(dir, 'match.jsonl'), jsonl(userPrompt('01:00'), overloaded('03:00')));
    const t = loadCallTranscript(dir, call());
    expect(t.file).toBe(path.join(dir, 'match.jsonl'));
    expect(t.steps).toHaveLength(1);
  });

  it('ไม่มี sessionId และไม่มีโฟลเดอร์ -> note', () => {
    expect(loadCallTranscript(path.join(dir, 'missing'), call()).note).toContain('ไม่พบ transcript');
  });

  it('ไม่มี sessionId -> เลือกไฟล์ที่ entry แรกใกล้เวลาเริ่มของ call ที่สุด ไม่ใช่ไฟล์แรกใน readdir', async () => {
    // 'far' มาก่อน 'near' ตามลำดับตัวอักษร แต่ 'near' เวลาใกล้ call.start (01:00) กว่า
    await fs.writeFile(path.join(dir, 'far.jsonl'), jsonl(userPrompt('00:59'), overloaded('03:00')));
    await fs.writeFile(path.join(dir, 'near.jsonl'), jsonl(userPrompt('01:00'), overloaded('03:00')));
    const t = loadCallTranscript(dir, call());
    expect(t.file).toBe(path.join(dir, 'near.jsonl'));
  });

  it('exclude ไฟล์ที่ call อื่นในรอบเดียวกัน sessionId จับไปแล้ว ไม่ให้ orphan call แย่งไฟล์นั้น', async () => {
    await fs.writeFile(path.join(dir, 'claimed.jsonl'), jsonl(userPrompt('01:00'), overloaded('03:00')));
    await fs.writeFile(path.join(dir, 'other.jsonl'), jsonl(userPrompt('01:05'), overloaded('03:00')));
    const t = loadCallTranscript(dir, call(), { exclude: new Set(['claimed.jsonl']) });
    expect(t.file).toBe(path.join(dir, 'other.jsonl'));
  });
});

describe('TranscriptCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-tx-cache-'));
  });

  it('ไฟล์เดิมไม่เปลี่ยน -> ใช้ entries ที่พาร์สไว้ซ้ำ (ไม่พาร์สใหม่), ไฟล์เปลี่ยนแล้ว -> พาร์สใหม่', async () => {
    const file = path.join(dir, 's-qa.jsonl');
    await fs.writeFile(file, jsonl(overloaded('03:00')));
    const cache = createTranscriptCache();

    const t1 = loadCallTranscript(dir, call({ sessionId: 's-qa' }), { cache });
    const entries1 = cache.get(file)?.entries;
    expect(t1.steps).toHaveLength(1);
    expect(entries1).toBeDefined();

    const t2 = loadCallTranscript(dir, call({ sessionId: 's-qa' }), { cache });
    const entries2 = cache.get(file)?.entries;
    expect(t2.steps).toEqual(t1.steps);
    expect(entries2).toBe(entries1); // อ้างอิงเดียวกัน = ไม่ได้พาร์สไฟล์ใหม่

    await fs.writeFile(file, jsonl(overloaded('03:00'), overloaded('04:00')));
    const t3 = loadCallTranscript(dir, call({ sessionId: 's-qa' }), { cache });
    const entries3 = cache.get(file)?.entries;
    expect(t3.steps).toHaveLength(2);
    expect(entries3).not.toBe(entries1); // ไฟล์เปลี่ยน (size ต่าง) -> พาร์สใหม่
  });
});
