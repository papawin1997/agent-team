import type { StateStore } from '../deps';
import type { QuotaBadge } from '../quota';
import type { State } from '../state';
import { displayWidth, graphemes } from './text';

/** ข้อมูลแถบสถานะล่างจอ */
export interface BarInfo {
  title?: string;
  /** เฟสของงาน หรือ "ปรึกษา" ในโหมด ask */
  phase?: string;
  /** เฉพาะเฟส BUILD */
  tasks?: { done: number; total: number };
  quota?: QuotaBadge;
}

const SEP = ' · ';
const MAX_TITLE = 30;

export function jobBar(state: State): Pick<BarInfo, 'title' | 'phase' | 'tasks'> {
  const bar: Pick<BarInfo, 'title' | 'phase' | 'tasks'> = { phase: state.phase };
  if (state.title) bar.title = state.title;
  if (state.phase === 'BUILD' && state.design) {
    const tasks = state.design.tasks;
    bar.tasks = { done: tasks.filter((t) => state.progress[t.id]?.done === true).length, total: tasks.length };
  }
  return bar;
}

function shorten(text: string): string {
  const parts = graphemes(text);
  return parts.length > MAX_TITLE ? `${parts.slice(0, MAX_TITLE - 1).join('')}…` : text;
}

/** จัดแถบตามความกว้างจอ: ตัดชื่องาน → เวลา → จำนวนงาน ; เฟสและโควตาอยู่เสมอ */
export function layoutBar(bar: BarInfo, elapsed: string, width: number): { left: string; right: string } {
  const right = bar.quota?.text ?? '';
  const parts: Array<{ key: 'title' | 'phase' | 'tasks' | 'time'; text: string | undefined }> = [
    { key: 'title', text: bar.title ? shorten(bar.title) : undefined },
    { key: 'phase', text: bar.phase },
    { key: 'tasks', text: bar.tasks ? `งาน ${bar.tasks.done}/${bar.tasks.total}` : undefined },
    { key: 'time', text: elapsed },
  ];
  const dropped = new Set<string>();
  const left = (): string =>
    parts
      .filter((p) => p.text && !dropped.has(p.key))
      .map((p) => p.text)
      .join(SEP);
  const fits = (): boolean => displayWidth(left()) + (right ? displayWidth(right) + 2 : 0) <= width;
  for (const key of ['title', 'time', 'tasks']) {
    if (fits()) break;
    dropped.add(key);
  }
  return { left: left(), right };
}

/** ห่อ store ของงาน: แจ้งแถบสถานะทุกครั้งที่ save (ตัวแจ้งพังต้องไม่ทำให้การบันทึกล้ม) */
export function watchStore(store: StateStore, onSave: (state: State) => void): StateStore {
  return {
    load: () => store.load(),
    saveArtifact: (name, data) => store.saveArtifact(name, data),
    save: async (state) => {
      await store.save(state);
      try {
        onSave(state);
      } catch {
        // แถบสถานะเป็นของแถม: ห้ามกระทบงาน
      }
    },
  };
}
