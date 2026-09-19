import { describe, expect, it } from 'vitest';
import { checkStream, type StreamMessage } from '../scripts/smoke-auth-lib';

async function* stream(...msgs: StreamMessage[]) {
  for (const m of msgs) yield m;
}

describe('checkStream', () => {
  it('result success -> ok พร้อมข้อความ AUTH OK', async () => {
    const out = await checkStream(stream({ type: 'system' }, { type: 'result', subtype: 'success', result: 'OK' }));
    expect(out.ok).toBe(true);
    expect(out.message).toContain('AUTH OK');
    expect(out.message).toContain('OK');
  });

  it('result error -> ไม่ ok และบอก subtype', async () => {
    const out = await checkStream(stream({ type: 'result', subtype: 'error_max_turns' }));
    expect(out.ok).toBe(false);
    expect(out.message).toContain('AUTH/RUN FAILED');
    expect(out.message).toContain('error_max_turns');
  });

  it('stream ว่าง -> ไม่ ok: no result message', async () => {
    const out = await checkStream(stream());
    expect(out).toEqual({ ok: false, message: 'AUTH/RUN FAILED: no result message' });
  });

  it('stream จบโดยไม่มี result (มีแต่ message อื่น) -> ไม่ ok', async () => {
    const out = await checkStream(stream({ type: 'system', subtype: 'init' }, { type: 'assistant' }));
    expect(out.ok).toBe(false);
    expect(out.message).toBe('AUTH/RUN FAILED: no result message');
  });
});
