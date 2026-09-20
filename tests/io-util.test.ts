import { describe, expect, it } from 'vitest';
import { askNonEmpty } from '../src/io-util';
import { ScriptedIO } from './helpers/fakes';

describe('askNonEmpty', () => {
  it('returns trimmed non-empty answer', async () => {
    const io = new ScriptedIO(['answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
  });

  it('trims whitespace', async () => {
    const io = new ScriptedIO(['  answer  ']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
  });

  it('re-asks on empty string', async () => {
    const io = new ScriptedIO(['', 'answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
    expect(io.asked).toHaveLength(2);
    expect(io.said).toContain('กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)');
  });

  it('re-asks on whitespace-only answer', async () => {
    const io = new ScriptedIO(['  ', '\t\n', 'answer']);
    const result = await askNonEmpty(io, 'prompt?');
    expect(result).toBe('answer');
    expect(io.asked).toHaveLength(3);
    expect(io.said.filter((s) => s === 'กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)')).toHaveLength(2);
  });

  it('propagates ScriptedIO exhaustion as error', async () => {
    const io = new ScriptedIO(['', '']);
    await expect(askNonEmpty(io, 'prompt?')).rejects.toThrow('ScriptedIO: ไม่มีคำตอบเหลือ');
  });
});
