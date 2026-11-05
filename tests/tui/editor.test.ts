import { describe, expect, it } from 'vitest';
import { editorKey, type EditorState, emptyEditor, type KeyInput } from '../../src/tui/editor';

const LEFT = { leftArrow: true };
const RIGHT = { rightArrow: true };
const UP = { upArrow: true };
const DOWN = { downArrow: true };
const RETURN = { input: '\r', return: true };
const BACKSPACE = { backspace: true };

/** ป้อนทีละปุ่ม: string = พิมพ์/paste ข้อความนั้น, object = ปุ่มพิเศษ */
function type(state: EditorState, ...keys: Array<string | Partial<KeyInput>>): EditorState {
  return keys.reduce<EditorState>(
    (acc, k) => editorKey(acc, typeof k === 'string' ? { input: k } : { input: '', ...k }).state,
    state,
  );
}

describe('editorKey', () => {
  it('พิมพ์ไทยแล้วเลื่อน cursor ทีละตัวอักษร ไม่หยุดกลางสระหรือวรรณยุกต์', () => {
    const s = type(emptyEditor(), 'ที่', 'นี่');
    expect(s).toMatchObject({ value: 'ที่นี่', cursor: 6 });
    expect(type(s, LEFT).cursor).toBe(3);
    expect(type(s, LEFT, LEFT).cursor).toBe(0);
    expect(type(s, LEFT, LEFT, RIGHT).cursor).toBe(3);
  });

  it('Backspace ลบทีละ code point ทั้ง key.backspace และ key.delete', () => {
    const s = type(emptyEditor(), 'ที่');
    expect(type(s, BACKSPACE).value).toBe('ที');
    expect(type(s, { delete: true }, { delete: true }).value).toBe('ท');
  });

  it('พิมพ์แทรกที่ตำแหน่ง cursor', () => {
    expect(type(emptyEditor(), 'ac', LEFT, 'b')).toMatchObject({ value: 'abc', cursor: 2 });
  });

  it('paste ที่มี CRLF/CR กลายเป็นขึ้นบรรทัด ไม่ส่งข้อความ', () => {
    const r = editorKey(emptyEditor(), { input: 'บรรทัดแรก\r\nบรรทัดสอง\rสาม' });
    expect(r.submit).toBeUndefined();
    expect(r.state.value).toBe('บรรทัดแรก\nบรรทัดสอง\nสาม');
  });

  it('\\ แล้ว Enter = ขึ้นบรรทัดใหม่ ไม่ส่ง', () => {
    const r = editorKey(type(emptyEditor(), 'ab\\'), RETURN);
    expect(r.submit).toBeUndefined();
    expect(r.state).toMatchObject({ value: 'ab\n', cursor: 3 });
  });

  it('Enter ส่งข้อความ ล้างช่อง และเก็บประวัติ (ไม่เก็บข้อความว่างหรือซ้ำกับล่าสุด)', () => {
    const r = editorKey(type(emptyEditor(), 'ทำหน้า login'), RETURN);
    expect(r.submit).toBe('ทำหน้า login');
    expect(r.state).toMatchObject({ value: '', cursor: 0, history: ['ทำหน้า login'], historyIndex: -1 });
    const again = editorKey(type(r.state, 'ทำหน้า login'), RETURN);
    expect(again.state.history).toEqual(['ทำหน้า login']);
    const empty = editorKey(again.state, RETURN);
    expect(empty.submit).toBe('');
    expect(empty.state.history).toEqual(['ทำหน้า login']);
  });

  it('↑↓ เรียกประวัติ ใหม่สุดก่อน แล้วกลับเป็นช่องว่าง', () => {
    const s = emptyEditor(['ล่าสุด', 'เก่า']);
    expect(type(s, UP)).toMatchObject({ value: 'ล่าสุด', cursor: 'ล่าสุด'.length });
    expect(type(s, UP, UP).value).toBe('เก่า');
    expect(type(s, UP, UP, UP).value).toBe('เก่า');
    expect(type(s, UP, DOWN).value).toBe('');
  });

  it('หลายบรรทัด: ↑↓ เลื่อนข้ามบรรทัดโดยคงคอลัมน์ตามความกว้างจริง', () => {
    const s = type(emptyEditor(['เก่า']), 'ทำงาน\nab');
    const up = type(s, UP);
    expect(up.value).toBe('ทำงาน\nab');
    expect(up.cursor).toBe(2); // หลัง "ทำ" ซึ่งกว้าง 2 ช่องเท่ากับ "ab"
    expect(type(up, DOWN).cursor).toBe('ทำงาน\nab'.length);
  });

  it('Ctrl+A / Ctrl+E ไปต้น/ท้ายบรรทัดปัจจุบัน ; Esc ล้าง', () => {
    const s = type(emptyEditor(), 'ab\ncd', LEFT);
    expect(type(s, { input: 'a', ctrl: true }).cursor).toBe(3);
    expect(type(s, { input: 'a', ctrl: true }, { input: 'e', ctrl: true }).cursor).toBe(5);
    expect(type(s, { escape: true })).toMatchObject({ value: '', cursor: 0 });
  });

  it('Tab และปุ่มที่กด Ctrl/Meta ไม่ถูกพิมพ์ลงช่อง', () => {
    expect(type(emptyEditor(), { input: '\t', tab: true }, { input: 'x', ctrl: true }, { input: 'y', meta: true }).value).toBe('');
  });
});
