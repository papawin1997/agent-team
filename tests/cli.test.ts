import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CliIO, parseChoice } from '../src/cli';

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
});

describe('CliIO', () => {
  let io: CliIO | undefined;

  function makeIO(): { io: CliIO; input: PassThrough } {
    const input = new PassThrough();
    const output = new PassThrough();
    io = new CliIO({ input, output });
    return { io, input };
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

  it('stdin ปิด (EOF) ระหว่างรอคำตอบ -> ask reject ด้วยข้อความ EOF', async () => {
    const { io, input } = makeIO();
    const answer = io.ask('q> ');
    input.end();
    await expect(answer).rejects.toThrow('EOF');
  });

  it('เรียก ask หลัง stdin ปิดแล้ว -> reject ด้วยข้อความ EOF', async () => {
    const { io, input } = makeIO();
    input.end();
    await new Promise((resolve) => setImmediate(resolve));
    await expect(io.ask('q> ')).rejects.toThrow('EOF');
  });

  it('choose ถามซ้ำเมื่อตอบไม่ถูก แล้วคืนตัวเลือกเมื่อได้ค่าที่ถูก', async () => {
    const say = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { io, input } = makeIO();
    const choice = io.choose('เลือก', options);
    input.write('maybe\n');
    await vi.waitFor(() => expect(say).toHaveBeenCalledWith('กรุณาพิมพ์หมายเลขหรือชื่อตัวเลือกให้ตรง'));
    input.write('2\n');
    expect(await choice).toBe('revise');
  });
});
