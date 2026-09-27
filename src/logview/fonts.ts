import * as fs from 'node:fs';
import * as path from 'node:path';
import { TEAM_ROOT } from '../config';

/** ฟอนต์ที่ฝังในหน้า logs (SIL Open Font License, ดู OFL-*.txt ในโฟลเดอร์เดียวกัน) */
export const FONTS_DIR = path.join(TEAM_ROOT, 'assets', 'fonts');

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** woff2 แบบ variable (น้ำหนัก 400–700) ตัดเฉพาะชุดตัวอักษรที่ใช้ — ไทยใช้ Noto Sans Thai, อังกฤษใช้ Inter, log/โค้ดใช้ JetBrains Mono */
export const FONT_FILES: readonly { family: string; file: string; unicodeRange: string }[] = [
  { family: 'Noto Sans Thai', file: 'NotoSansThai-Thai.woff2', unicodeRange: 'U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC' },
  { family: 'Inter', file: 'Inter-Latin.woff2', unicodeRange: LATIN },
  { family: 'JetBrains Mono', file: 'JetBrainsMono-Latin.woff2', unicodeRange: LATIN },
];

const cache = new Map<string, string>();

/** @font-face ที่ฝังฟอนต์เป็น base64 (อ่านไฟล์ครั้งเดียวต่อโฟลเดอร์) ไฟล์ที่หาไม่เจอถูกข้าม หน้าจะใช้ฟอนต์ระบบใน --font-sans/--font-mono แทน */
export function fontFaceCss(dir: string = FONTS_DIR): string {
  const hit = cache.get(dir);
  if (hit !== undefined) return hit;
  const css = FONT_FILES.map((f) => {
    let data: Buffer;
    try {
      data = fs.readFileSync(path.join(dir, f.file));
    } catch {
      return '';
    }
    return (
      `@font-face{font-family:"${f.family}";font-style:normal;font-weight:400 700;font-display:swap;` +
      `src:url(data:font/woff2;base64,${data.toString('base64')}) format("woff2");unicode-range:${f.unicodeRange}}`
    );
  })
    .filter(Boolean)
    .join('\n');
  cache.set(dir, css);
  return css;
}
