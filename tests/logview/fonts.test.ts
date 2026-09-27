import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_FILES, FONTS_DIR, fontFaceCss } from '../../src/logview/fonts';

describe('fonts', () => {
  it('ไฟล์ฟอนต์และ license อยู่ใน assets/fonts และเป็น woff2 จริง', () => {
    expect(FONT_FILES.map((f) => f.family)).toEqual(['Noto Sans Thai', 'Inter', 'JetBrains Mono']);
    for (const f of FONT_FILES) {
      const buf = fs.readFileSync(path.join(FONTS_DIR, f.file));
      expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
    for (const lic of ['OFL-NotoSansThai.txt', 'OFL-Inter.txt', 'OFL-JetBrainsMono.txt']) {
      expect(fs.readFileSync(path.join(FONTS_DIR, lic), 'utf8')).toContain('SIL Open Font License');
    }
  });

  it('สร้าง @font-face ที่ฝัง base64 ครบ 3 ชุด พร้อม unicode-range และ font-display:swap', () => {
    const css = fontFaceCss();
    expect(css.match(/@font-face\{/g)).toHaveLength(3);
    expect(css).toContain('font-family:"Noto Sans Thai"');
    expect(css).toContain('unicode-range:U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC');
    expect(css).toContain('src:url(data:font/woff2;base64,d09GMg');
    expect(css).toContain('font-display:swap');
    expect(css).toContain('font-weight:400 700');
    expect(css).not.toContain('http');
  });

  it('ไม่มีไฟล์ฟอนต์ -> คืนสตริงว่าง (หน้าใช้ฟอนต์ระบบแทน) และไม่ throw', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-team-nofonts-'));
    expect(fontFaceCss(empty)).toBe('');
  });

  it('package.json ส่ง assets ไปกับ npm i -g', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(FONTS_DIR, '..', '..', 'package.json'), 'utf8')) as { files: string[] };
    expect(pkg.files).toContain('assets');
  });
});
