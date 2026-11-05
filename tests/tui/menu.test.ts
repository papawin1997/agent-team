import { describe, expect, it } from 'vitest';
import type { KeyInput } from '../../src/tui/editor';
import { type MenuOption, type MenuResult, menuKey, newMenu } from '../../src/tui/menu';

const OPTIONS: MenuOption[] = [
  { value: 'confirm', label: 'ยืนยัน' },
  { value: 'revise', label: 'ขอแก้' },
];

/** กดปุ่มต่อกันจากเมนูใหม่ คืนผลของปุ่มสุดท้าย */
function press(keys: Array<Partial<KeyInput>>, allowText = true): MenuResult {
  let result: MenuResult = { state: newMenu() };
  for (const k of keys) result = menuKey(result.state, { input: '', ...k }, OPTIONS, allowText);
  return result;
}

describe('menuKey', () => {
  it('Enter เลือกตัวเลือกปัจจุบัน ; ↓ แล้ว Enter = ตัวถัดไป', () => {
    expect(press([{ return: true }]).choice).toBe('confirm');
    expect(press([{ downArrow: true }, { return: true }]).choice).toBe('revise');
  });

  it('กดเลขเลือกได้ทันที', () => {
    expect(press([{ input: '2' }]).choice).toBe('revise');
  });

  it('↑ จากแถวแรกวนไปแถวพิมพ์ (มีแถวพิมพ์) หรือแถวสุดท้าย (ไม่มีแถวพิมพ์)', () => {
    expect(press([{ upArrow: true }]).state.index).toBe(2);
    expect(press([{ upArrow: true }], false).state.index).toBe(1);
  });

  it('พิมพ์ตัวอักษรบนตัวเลือก = กระโดดไปแถวพิมพ์พร้อมตัวอักษรนั้น ; Enter ส่งเป็นข้อความ', () => {
    const typed = press([{ input: 'ทำไม' }]);
    expect(typed.state.index).toBe(2);
    expect(typed.state.editor.value).toBe('ทำไม');
    const sent = menuKey(typed.state, { input: '\r', return: true }, OPTIONS, true);
    expect(sent.text).toBe('ทำไม');
    expect(sent.choice).toBeUndefined();
  });

  it('↑ จากแถวพิมพ์กลับไปตัวเลือกได้ ข้อความที่พิมพ์ค้างยังอยู่ ; Tab สลับไปมา', () => {
    const back = press([{ input: 'ถาม' }, { upArrow: true }]);
    expect(back.state.index).toBe(1);
    expect(back.state.editor.value).toBe('ถาม');
    expect(press([{ tab: true }]).state.index).toBe(2);
    expect(press([{ tab: true }, { tab: true }]).state.index).toBe(0);
  });

  it('แถวพิมพ์: Enter ตอนว่างไม่ส่ง ; Esc ล้าง แล้ว Esc อีกครั้งกลับตัวเลือกแรก ; เลขกลายเป็นข้อความ', () => {
    const empty = press([{ tab: true }, { return: true }]);
    expect(empty.text).toBeUndefined();
    expect(empty.choice).toBeUndefined();
    const cleared = press([{ input: 'x' }, { escape: true }]);
    expect(cleared.state.index).toBe(2);
    expect(cleared.state.editor.value).toBe('');
    expect(press([{ input: 'x' }, { escape: true }, { escape: true }]).state.index).toBe(0);
    expect(press([{ tab: true }, { input: '2' }]).state.editor.value).toBe('2');
  });

  it('แถวพิมพ์: \\ แล้ว Enter ขึ้นบรรทัดใหม่ ไม่ส่ง', () => {
    const r = press([{ input: 'a\\' }, { return: true }]);
    expect(r.text).toBeUndefined();
    expect(r.state.editor.value).toBe('a\n');
  });

  it('ไม่มีแถวพิมพ์: ตัวอักษรถูกเมิน', () => {
    const r = press([{ input: 'x' }], false);
    expect(r.choice).toBeUndefined();
    expect(r.text).toBeUndefined();
    expect(r.state.index).toBe(0);
  });
});
