// ตรรกะตัวอักษรของ UI ใหม่: grapheme และความกว้างที่ตรงกับ terminal (วิธี A — ผู้ใช้ยืนยันด้วยไม้บรรทัดแล้ว)
// ต่างจาก string-width ของ Ink ตรงสระอำ: "น้ำ" กว้าง 2 ช่อง (น + ำ) ไม่ใช่ 1

const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

function codePointWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (ZERO_WIDTH.test(ch)) return 0;
  return isWide(cp) ? 2 : 1;
}

/** จำนวนช่องบนจอ: สระบน/ล่าง วรรณยุกต์ = 0, สระอำ = 1, อักษรจีน/emoji = 2 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) {
    width += PICTOGRAPH.test(g) ? 2 : Array.from(g).reduce((sum, ch) => sum + codePointWidth(ch), 0);
  }
  return width;
}

/** ขอบ grapheme ก่อนหน้า (cursor ต้องอยู่ที่ขอบ grapheme อยู่แล้ว) */
export function prevBoundary(text: string, cursor: number): number {
  let pos = 0;
  for (const g of graphemes(text.slice(0, cursor))) {
    if (pos + g.length >= cursor) return pos;
    pos += g.length;
  }
  return 0;
}

export function nextBoundary(text: string, cursor: number): number {
  const g = graphemes(text.slice(cursor))[0];
  return g === undefined ? cursor : cursor + g.length;
}

/** Backspace แบบคีย์บอร์ดไทย: ลบทีละ code point */
export function deleteBackward(text: string, cursor: number): { text: string; cursor: number } {
  if (cursor === 0) return { text, cursor };
  const head = Array.from(text.slice(0, cursor));
  head.pop();
  const kept = head.join('');
  return { text: kept + text.slice(cursor), cursor: kept.length };
}

/** offset ในบรรทัดที่ขอบ grapheme ซึ่งความกว้างก่อนหน้าไม่เกิน column (ใช้ตอน ↑↓ ข้ามบรรทัด) */
export function offsetAtWidth(line: string, column: number): number {
  let width = 0;
  let pos = 0;
  for (const g of graphemes(line)) {
    const w = displayWidth(g);
    if (width + w > column) return pos;
    width += w;
    pos += g.length;
  }
  return pos;
}
