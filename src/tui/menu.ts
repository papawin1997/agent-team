import { editorKey, type EditorState, emptyEditor, type KeyInput } from './editor';

export interface MenuOption {
  value: string;
  /** ป้ายภาษาไทย เช่น confirm = ยืนยัน */
  label?: string;
}

export interface MenuState {
  /** แถวที่เลือกอยู่ ; แถวพิมพ์ = options.length */
  index: number;
  /** ข้อความในแถวพิมพ์ (ค้างไว้แม้ย้ายกลับไปที่ตัวเลือก) */
  editor: EditorState;
}

export interface MenuResult {
  state: MenuState;
  choice?: string;
  text?: string;
}

export const newMenu = (): MenuState => ({ index: 0, editor: emptyEditor() });

const printable = (k: KeyInput): boolean => k.input !== '' && !k.ctrl && !k.meta && !k.escape && !k.tab && !k.return;

/** เมนูลูกศร: ↑↓ เลือก, Enter/เลข ยืนยัน, Tab หรือพิมพ์ตัวอักษร = ไปแถวพิมพ์ (allowText) */
export function menuKey(s: MenuState, k: KeyInput, options: readonly MenuOption[], allowText: boolean): MenuResult {
  const rows = options.length + (allowText ? 1 : 0);
  const textRow = allowText ? options.length : -1;
  if (k.upArrow) return { state: { ...s, index: (s.index + rows - 1) % rows } };
  if (k.downArrow) return { state: { ...s, index: (s.index + 1) % rows } };
  if (k.tab && allowText) return { state: { ...s, index: s.index === textRow ? 0 : textRow } };

  if (s.index === textRow) {
    if (k.escape) return { state: s.editor.value !== '' ? { ...s, editor: emptyEditor() } : { ...s, index: 0 } };
    if (k.return && !s.editor.value.slice(0, s.editor.cursor).endsWith('\\')) {
      if (s.editor.value.trim() === '') return { state: s };
      return { state: { ...s, editor: emptyEditor() }, text: s.editor.value };
    }
    return { state: { ...s, editor: editorKey(s.editor, k).state } };
  }

  if (/^[1-9]$/.test(k.input) && !k.ctrl && !k.meta) {
    const option = options[Number(k.input) - 1];
    if (option) return { state: s, choice: option.value };
  }
  if (k.return) {
    const option = options[s.index];
    return option ? { state: s, choice: option.value } : { state: s };
  }
  if (allowText && printable(k)) return { state: { index: textRow, editor: editorKey(s.editor, k).state } };
  return { state: s };
}
