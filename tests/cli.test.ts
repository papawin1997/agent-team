import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliIO, type CliIOOptions, parseChoice } from '../src/cli';

const options = ['confirm', 'revise'] as const;

describe('parseChoice', () => {
  it('เลือกด้วยหมายเลข (เริ่มที่ 1)', () => {
    expect(parseChoice('1', options)).toBe('confirm');
    expect(parseChoice('2', options)).toBe('revise');
  });

  it('เลือกด้วยชื่อตัวเลือก และตัดช่องว่าง', () => {
    expect(parseChoice('  revise ', options)).toBe('revise');
  });

  it('ค่าที่ไม่ถูกต้อง -> undefined', () => {
    expect(parseChoice('0', options)).toBeUndefined();
    expect(parseChoice('3', options)).toBeUndefined();
    expect(parseChoice('maybe', options)).toBeUndefined();
    expect(parseChoice('', options)).toBeUndefined();
  });

  it('เลือกด้วยชื่อ option แบบไม่สนตัวพิมพ์ใหญ่เล็ก', () => {
    expect(parseChoice('Confirm', options)).toBe('confirm');
    expect(parseChoice('REVISE', options)).toBe('revise');
  });

  it('เลือกด้วยป้ายภาษาไทยที่โชว์ในเมนู', () => {
    expect(parseChoice('ยืนยัน', options)).toBe('confirm');
    expect(parseChoice('ขอแก้', options)).toBe('revise');
  });

  it('ตัดจุด/วงเล็บท้ายก่อนเทียบ', () => {
    expect(parseChoice('1.', options)).toBe('confirm');
    expect(parseChoice('2)', options)).toBe('revise');
  });
});

describe('CliIO', () => {
  let io: CliIO | undefined;

  function makeIO(extra: Partial<CliIOOptions> = {}): {
    io: CliIO;
    input: PassThrough;
    written: () => string;
  } {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = '';
    output.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    io = new CliIO({ input, output, ...extra });
    return { io, input, written: () => text };
  }

  afterEach(() => {
    io?.close();
    io = undefined;
    vi.restoreAllMocks();
  });

  it('ask คืนบรรทัดที่พิมพ์เข้ามาโดยตัดช่องว่าง', async () => {
    const { io, input } = makeIO();
    const answer = io.ask('q> ');
    input.write('  hello  \n');
    expect(await answer).toBe('hello');
  });

  it('say เขียนลง output stream ที่ฉีดเข้ามา (ไม่ใช่ console.log)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { io, written } = makeIO();
    io.say('สวัสดี');
    await vi.waitFor(() => expect(written()).toContain('สวัสดี\n'));
    expect(log).not.toHaveBeenCalled();
  });

  it('stdin ปิด (EOF) ระหว่างรอคำตอบ -> ask reject ด้วยข้อความ EOF', async () => {
    const { io, input } = makeIO();
    const answer = io.ask('q> ');
    input.end();
    await expect(answer).rejects.toThrow('EOF');
  });

  it('เรียก ask หลัง stdin ปิดแล้ว -> reject ด้วยข้อความ EOF', async () => {
    const { io, input } = makeIO();
    const ended = once(input, 'end');
    input.end();
    // listener ของ readline ลงทะเบียนก่อน จึงทำงานก่อน (rl.close() แบบ synchronous) เมื่อ 'end' ยิง
    await ended;
    await expect(io.ask('q> ')).rejects.toThrow('EOF');
  });

  it('choose แสดงเมนูเลขพร้อมป้ายภาษาไทย ถามซ้ำเมื่อตอบไม่ถูก แล้วคืนตัวเลือกเมื่อได้ค่าที่ถูก', async () => {
    const { io, input, written } = makeIO();
    const choice = io.choose('เลือก', options);
    await vi.waitFor(() => {
      expect(written()).toContain('1) confirm (ยืนยัน)');
      expect(written()).toContain('2) revise (ขอแก้)');
    });
    input.write('maybe\n');
    await vi.waitFor(() => expect(written()).toContain('กรุณาพิมพ์หมายเลขหรือชื่อตัวเลือกให้ตรง\n'));
    input.write('2\n');
    expect(await choice).toBe('revise');
  });

  it('chooseOrText: คืนตัวเลือกเมื่อพิมพ์ตรงกับตัวเลือก', async () => {
    const { io, input } = makeIO();
    const result = io.chooseOrText('เลือก', options);
    input.write('confirm\n');
    expect(await result).toBe('confirm');
  });

  it('chooseOrText: คืน { text } เมื่อพิมพ์อย่างอื่น พร้อมโชว์คำใบ้ว่าถามได้', async () => {
    const { io, input, written } = makeIO();
    const result = io.chooseOrText('เลือก', options);
    await vi.waitFor(() => {
      expect(written()).toContain('หรือพิมพ์คำถาม/ความเห็นถึง PM ก่อนตัดสินใจก็ได้');
    });
    input.write('ทำไมต้องเลือกแบบนี้\n');
    expect(await result).toEqual({ text: 'ทำไมต้องเลือกแบบนี้' });
  });

  describe('Ctrl+C ใน terminal mode (raw mode ไม่ส่ง SIGINT ให้ process)', () => {
    it('เรียก onInterrupt หนึ่งครั้ง โดยที่ ask ที่รออยู่ไม่ถูก reject แล้วยังตอบต่อได้', async () => {
      const onInterrupt = vi.fn();
      const { io, input } = makeIO({ terminal: true, onInterrupt });
      const answer = io.ask('q> ');
      answer.catch(() => {}); // ถ้า regress ต้องล้มที่ assertion ด้านล่าง ไม่ใช่ unhandled rejection
      input.write('\u0003');
      await vi.waitFor(() => expect(onInterrupt).toHaveBeenCalledTimes(1));
      input.write('ok\n');
      expect(await answer).toBe('ok');
      expect(onInterrupt).toHaveBeenCalledTimes(1);
    });

    it('ค่าเริ่มต้นของ onInterrupt ยิง process SIGINT เพื่อให้ handler ใน index.ts ทำงาน', async () => {
      const original = process.listeners('SIGINT');
      process.removeAllListeners('SIGINT'); // กัน listener อื่นของ test runner ถูกเรียกไปด้วย
      const spy = vi.fn();
      process.on('SIGINT', spy);
      try {
        const { io, input } = makeIO({ terminal: true });
        const answer = io.ask('q> ');
        answer.catch(() => {});
        input.write('\u0003');
        await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
        input.write('ok\n');
        expect(await answer).toBe('ok');
      } finally {
        process.removeAllListeners('SIGINT');
        for (const l of original) process.on('SIGINT', l);
      }
    });
  });
});
