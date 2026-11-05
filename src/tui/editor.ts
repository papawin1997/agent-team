import { deleteBackward, displayWidth, nextBoundary, offsetAtWidth, prevBoundary } from './text';

/** ปุ่มที่กด: รูปเดียวกับ Key ของ Ink บวกตัวอักษรที่พิมพ์ (paste = ทั้งก้อน) */
export interface KeyInput {
  input: string;
  return?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface EditorState {
  value: string;
  /** offset ใน value (อยู่ที่ขอบ grapheme เสมอ) */
  cursor: number;
  /** ข้อความที่เคยส่ง ใหม่สุดก่อน (จำเฉพาะในการรันนี้) */
  history: readonly string[];
  /** -1 = ไม่ได้อยู่ในประวัติ */
  historyIndex: number;
}

export interface EditorResult {
  state: EditorState;
  /** มีค่าเมื่อกด Enter ส่งข้อความ */
  submit?: string;
}

export const emptyEditor = (history: readonly string[] = []): EditorState => ({ value: '', cursor: 0, history, historyIndex: -1 });

const lineStart = (value: string, cursor: number): number => value.lastIndexOf('\n', cursor - 1) + 1;
const lineEnd = (value: string, cursor: number): number => {
  const nl = value.indexOf('\n', cursor);
  return nl === -1 ? value.length : nl;
};

function insert(s: EditorState, input: string): EditorState {
  const text = input.replace(/\r\n?/g, '\n');
  return { ...s, value: s.value.slice(0, s.cursor) + text + s.value.slice(s.cursor), cursor: s.cursor + text.length };
}

/** ข้ามบรรทัดในข้อความหลายบรรทัด (undefined = อยู่บรรทัดแรก/สุดท้ายแล้ว ให้ไปใช้ประวัติแทน) */
function moveLine(s: EditorState, dir: -1 | 1): EditorState | undefined {
  const start = lineStart(s.value, s.cursor);
  const column = displayWidth(s.value.slice(start, s.cursor));
  if (dir === -1) {
    if (start === 0) return undefined;
    const prevStart = lineStart(s.value, start - 1);
    return { ...s, cursor: prevStart + offsetAtWidth(s.value.slice(prevStart, start - 1), column) };
  }
  const end = lineEnd(s.value, s.cursor);
  if (end === s.value.length) return undefined;
  const nextStart = end + 1;
  return { ...s, cursor: nextStart + offsetAtWidth(s.value.slice(nextStart, lineEnd(s.value, nextStart)), column) };
}

function recall(s: EditorState, dir: -1 | 1): EditorState {
  const index = dir === -1 ? Math.min(s.historyIndex + 1, s.history.length - 1) : Math.max(s.historyIndex - 1, -1);
  if (index === s.historyIndex) return s;
  const value = index === -1 ? '' : (s.history[index] ?? '');
  return { ...s, value, cursor: value.length, historyIndex: index };
}

export function editorKey(s: EditorState, k: KeyInput): EditorResult {
  if (k.return) {
    if (s.value.slice(0, s.cursor).endsWith('\\')) {
      return { state: { ...s, value: `${s.value.slice(0, s.cursor - 1)}\n${s.value.slice(s.cursor)}` } };
    }
    const submit = s.value;
    const keep = submit.trim() === '' || s.history[0] === submit;
    return { state: emptyEditor(keep ? s.history : [submit, ...s.history]), submit };
  }
  if (k.escape) return { state: { ...s, value: '', cursor: 0, historyIndex: -1 } };
  if (k.leftArrow) return { state: { ...s, cursor: prevBoundary(s.value, s.cursor) } };
  if (k.rightArrow) return { state: { ...s, cursor: nextBoundary(s.value, s.cursor) } };
  if (k.upArrow) return { state: moveLine(s, -1) ?? recall(s, -1) };
  if (k.downArrow) return { state: moveLine(s, 1) ?? recall(s, 1) };
  if (k.ctrl && k.input === 'a') return { state: { ...s, cursor: lineStart(s.value, s.cursor) } };
  if (k.ctrl && k.input === 'e') return { state: { ...s, cursor: lineEnd(s.value, s.cursor) } };
  if (k.backspace || k.delete) {
    const r = deleteBackward(s.value, s.cursor);
    return { state: { ...s, value: r.text, cursor: r.cursor } };
  }
  if (k.input && !k.ctrl && !k.meta && !k.tab) return { state: insert(s, k.input) };
  return { state: s };
}
