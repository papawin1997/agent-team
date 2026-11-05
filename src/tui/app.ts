import { Box, render, Static, Text, useInput } from 'ink';
import React, { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { formatElapsed } from '../activity';
import { editorKey, type EditorState, emptyEditor, type KeyInput } from './editor';
import { menuKey, type MenuState, newMenu } from './menu';
import type { Activity, LogLine, MenuPrompt, Mounted, ScreenStore } from './screen';
import { graphemes } from './text';

const h = React.createElement;

export const HINT = 'Enter ส่ง · \\ แล้ว Enter ขึ้นบรรทัด · ↑↓ ประวัติ · Esc ล้าง · Ctrl+C หยุด';
export const BUSY_NOTICE = 'agent กำลังทำงาน — ข้อความยังอยู่ในช่องพิมพ์ ส่งได้เมื่อมีคำถามถัดไป';
export const TEXT_ROW_PLACEHOLDER = 'พิมพ์ข้อความถึง PM…';
const MENU_HINT = '↑↓ เลือก · Enter ยืนยัน · เลข 1-9 · Tab หรือพิมพ์ตัวอักษร = ไปช่องพิมพ์';
const MENU_TEXT_HINT = 'Enter ส่ง · ↑ กลับไปตัวเลือก · Esc ล้าง/กลับ · \\ แล้ว Enter ขึ้นบรรทัด';
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 120;

/** แบ่งบรรทัดที่ cursor อยู่ แล้ววาด cursor ปลอมเป็นช่องสีกลับ (ไม่พึ่งตำแหน่ง cursor จริงของ terminal) */
const INVERSE = '\x1b[7m';
const INVERSE_OFF = '\x1b[27m';

/**
 * บรรทัดเป็นข้อความก้อนเดียว ใส่ cursor ด้วยรหัส ANSI สีกลับ — ห้ามแยกเป็น Text ซ้อนหลายชิ้น:
 * Ink วัดขนาดใหม่ไม่ถูกตอนมีลูกชิ้นใหม่แทรกเข้ามา (ตัวอักษรไปโผล่บนเส้นขอบล่างของกรอบ)
 */
function withCursor(line: string, at: number): string {
  const g = graphemes(line.slice(at))[0];
  const after = g ? line.slice(at + g.length) : '';
  return `${line.slice(0, at)}${INVERSE}${g ?? ' '}${INVERSE_OFF}${after}`;
}

function EditorLines({ editor, active, prefix }: { editor: EditorState; active: boolean; prefix: string }): React.ReactElement {
  const lines = editor.value.split('\n');
  const indent = ' '.repeat(Array.from(prefix).length);
  let start = 0;
  return h(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line, i) => {
      const lineStart = start;
      start += line.length + 1;
      const here = active && editor.cursor >= lineStart && editor.cursor <= lineStart + line.length;
      const body = here ? withCursor(line, editor.cursor - lineStart) : line;
      return h(Text, { key: i }, `${i === 0 ? prefix : indent}${body}`);
    }),
  );
}

function MenuView({ prompt, menu }: { prompt: MenuPrompt; menu: MenuState }): React.ReactElement {
  const textRow = prompt.options.length;
  const onText = prompt.allowText && menu.index === textRow;
  const textLine = !prompt.allowText
    ? null
    : onText || menu.editor.value !== ''
      ? h(EditorLines, { key: 'text', editor: menu.editor, active: onText, prefix: `${onText ? '❯' : ' '} ${textRow + 1}. ` })
      : h(Text, { key: 'text', dimColor: true }, `  ${textRow + 1}. ${TEXT_ROW_PLACEHOLDER}`);
  return h(
    Box,
    { borderStyle: 'round', borderColor: 'cyan', paddingX: 1, flexDirection: 'column' },
    prompt.prompt ? h(Text, { bold: true }, prompt.prompt) : null,
    ...prompt.options.map((o, i) =>
      h(
        Text,
        { key: o.value, color: i === menu.index ? 'cyan' : undefined },
        `${i === menu.index ? '❯' : ' '} ${i + 1}. ${o.value}`,
        o.label ? h(Text, { dimColor: true }, `  ${o.label}`) : null,
      ),
    ),
    textLine,
    h(Text, { dimColor: true }, onText ? MENU_TEXT_HINT : MENU_HINT),
  );
}

function activityLine(a: Activity, frame: number, now: number): string {
  const detail = a.detail ? ` · ${a.detail}` : '';
  return `${FRAMES[frame % FRAMES.length]} ${a.label}${detail} · ${formatElapsed(now - a.startedAt)}`;
}

export interface AppProps {
  store: ScreenStore;
  /** Ctrl+C: index ส่งต่อเป็น process 'SIGINT' ให้ handler หยุดงานเดิม */
  onInterrupt: () => void;
  now?: () => number;
}

export function App({ store, onInterrupt, now = Date.now }: AppProps): React.ReactElement {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  // เก็บสถานะช่องพิมพ์/เมนูใน ref: ปุ่มที่มาติดกันก่อน React วาดใหม่ (พิมพ์เร็ว) ต้องเห็นค่าล่าสุดเสมอ
  const ui = useRef<{ editor: EditorState; menu: MenuState; menuFor?: number }>({ editor: emptyEditor(), menu: newMenu() });
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [frame, setFrame] = useState(0);
  const busy = state.activity !== undefined;

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(timer);
  }, [busy]);

  /** เมนูของคำถามปัจจุบัน (คำถามใหม่ = เริ่มเมนูใหม่) */
  const menuFor = (prompt: MenuPrompt): MenuState => {
    if (ui.current.menuFor !== prompt.id) {
      ui.current.menu = newMenu();
      ui.current.menuFor = prompt.id;
    }
    return ui.current.menu;
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        onInterrupt();
        return;
      }
      const k: KeyInput = { ...key, input };
      const prompt = store.getState().prompt;
      if (prompt?.kind === 'menu') {
        const r = menuKey(menuFor(prompt), k, prompt.options, prompt.allowText);
        ui.current.menu = r.state;
        if (r.choice !== undefined) store.answer({ choice: r.choice });
        else if (r.text !== undefined) store.answer({ text: r.text });
        redraw();
        return;
      }
      const r = editorKey(ui.current.editor, k);
      if (r.submit !== undefined && prompt?.kind !== 'text') {
        // flow ของทีมรับข้อความได้เฉพาะตอนถาม: เก็บข้อความไว้ในช่อง
        store.setNotice(BUSY_NOTICE);
        return;
      }
      ui.current.editor = r.state;
      if (r.submit !== undefined) store.answer({ text: r.submit });
      redraw();
    },
    { isActive: state.closed !== true },
  );

  const prompt = state.prompt;
  const log = h(Static<LogLine>, { items: [...state.log], children: (line: LogLine) => h(Text, { key: line.id }, line.text) });
  if (state.closed) return h(Box, { flexDirection: 'column' }, log);
  return h(
    Box,
    { flexDirection: 'column' },
    log,
    h(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      state.activity ? h(Text, { color: 'yellow' }, activityLine(state.activity, frame, now())) : null,
      prompt?.kind === 'text' && prompt.prompt ? h(Text, { bold: true }, prompt.prompt) : null,
      prompt?.kind === 'menu'
        ? h(MenuView, { prompt, menu: menuFor(prompt) })
        : h(
            Box,
            { borderStyle: 'round', borderColor: prompt ? 'white' : 'gray', paddingX: 1 },
            h(EditorLines, { editor: ui.current.editor, active: true, prefix: '> ' }),
          ),
      state.notice ? h(Text, { color: 'yellow' }, state.notice) : null,
      prompt?.kind === 'menu' ? null : h(Text, { dimColor: true }, HINT),
    ),
  );
}

/** เปิดจอจริง: ปิดการจัดการ Ctrl+C ของ Ink เพื่อส่งต่อให้ handler หยุดงานเดิม */
export function mountApp(store: ScreenStore, onInterrupt: () => void): Mounted {
  const instance = render(h(App, { store, onInterrupt }), { exitOnCtrlC: false });
  return { unmount: () => instance.unmount() };
}
