import { describe, expect, it } from 'vitest';
import { deleteBackward, displayWidth, graphemes, nextBoundary, offsetAtWidth, prevBoundary } from '../../src/tui/text';

describe('graphemes', () => {
  it('สระบนล่างและวรรณยุกต์อยู่กลุ่มเดียวกับพยัญชนะ', () => {
    expect(graphemes('ที่นี่')).toEqual(['ที่', 'นี่']);
    expect(graphemes('น้ำ')).toEqual(['น้ำ']);
    expect(graphemes('')).toEqual([]);
  });
});

describe('displayWidth (วิธี A ที่ผ่านไม้บรรทัด)', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['ทำหน้า login', 11],
    ['น้ำ', 2],
    ['กำลังทำงาน', 9],
    ['ที่นี่มีน้ำไหม', 8],
    ['ผู้ใช้', 3],
    ['日本', 4],
    ['👍', 2],
  ])('%s -> %i', (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });
});

describe('prevBoundary / nextBoundary', () => {
  it('เลื่อนทีละ grapheme ไม่หยุดกลางสระหรือวรรณยุกต์', () => {
    expect(prevBoundary('ที่นี่', 6)).toBe(3);
    expect(prevBoundary('ที่นี่', 3)).toBe(0);
    expect(prevBoundary('ที่นี่', 0)).toBe(0);
    expect(nextBoundary('ที่นี่', 0)).toBe(3);
    expect(nextBoundary('ที่นี่', 6)).toBe(6);
  });
});

describe('deleteBackward', () => {
  it('ลบทีละ code point แบบคีย์บอร์ดไทย (วรรณยุกต์ก่อน แล้วสระ แล้วพยัญชนะ)', () => {
    expect(deleteBackward('ที่', 3)).toEqual({ text: 'ที', cursor: 2 });
    expect(deleteBackward('ที', 2)).toEqual({ text: 'ท', cursor: 1 });
    expect(deleteBackward('กขค', 2)).toEqual({ text: 'กค', cursor: 1 });
    expect(deleteBackward('ก', 0)).toEqual({ text: 'ก', cursor: 0 });
  });

  it('emoji (surrogate pair) ลบทั้งตัว', () => {
    expect(deleteBackward('a👍', 3)).toEqual({ text: 'a', cursor: 1 });
  });
});

describe('offsetAtWidth', () => {
  it('หา offset ที่ขอบ grapheme ตามความกว้างที่ต้องการ', () => {
    expect(offsetAtWidth('ทำหน้า', 2)).toBe(2);
    expect(offsetAtWidth('ทำหน้า', 1)).toBe(0);
    expect(offsetAtWidth('ab', 5)).toBe(2);
    expect(offsetAtWidth('', 3)).toBe(0);
  });
});
