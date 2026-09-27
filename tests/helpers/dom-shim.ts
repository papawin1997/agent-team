// DOM จำลองขั้นต่ำสำหรับรัน PAGE_JS ใน vitest (repo ไม่มี jsdom และห้ามเพิ่ม dependency)

export class FakeNode {
  tagName: string;
  children: FakeNode[] = [];
  className = '';
  id = '';
  type = '';
  disabled = false;
  selected = false;
  open = false;
  selectionStart: number | null = null;
  selectionEnd: number | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  onclick?: () => void;
  onchange?: () => void;
  oninput?: () => void;
  ownerDocument?: FakeDocument;
  scrolledIntoView = false;
  private ownText = '';
  private _value = '';
  private valueSet = false;

  constructor(tag: string) {
    this.tagName = tag.toLowerCase();
  }
  get value(): string {
    if (!this.valueSet && this.tagName === 'select') {
      const sel = this.children.find((c) => c.selected);
      if (sel) return sel.value;
    }
    return this._value;
  }
  set value(v: string) {
    this._value = v;
    this.valueSet = true;
  }
  appendChild(child: FakeNode): FakeNode {
    if (child.tagName === '#fragment') {
      const moved = child.children;
      child.children = [];
      moved.forEach((c) => this.appendChild(c));
    } else {
      this.children.push(child);
    }
    return child;
  }
  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.ownText = String(v);
    this.children = [];
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = String(v);
  }
  addEventListener(event: string, fn: () => void): void {
    (this.listeners[event] ?? (this.listeners[event] = [])).push(fn);
  }
  scrollIntoView(): void {
    this.scrolledIntoView = true;
  }
  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  setSelectionRange(start: number, end?: number): void {
    this.selectionStart = start;
    this.selectionEnd = end === undefined ? start : end;
  }
}

/** ยิง event ที่ผูกด้วย addEventListener ทั้งหมดของ event name นั้น (ตามลำดับที่ผูก) */
export function fire(node: FakeNode, event: string): void {
  (node.listeners[event] ?? []).forEach((fn) => fn());
}

export interface FakeDocument {
  activeElement: FakeNode | null;
  hidden: boolean;
  createElement(tag: string): FakeNode;
  createDocumentFragment(): FakeNode;
  getElementById(id: string): FakeNode | null;
}

export function find(root: FakeNode, pred: (n: FakeNode) => boolean): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode): void => {
    if (pred(n)) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export function createDom(dataJson: string): {
  app: FakeNode;
  document: FakeDocument;
  window: { scrollY: number; scrollTo: () => void; __LIVE__: boolean; AgentTeamList?: unknown };
} {
  const app = new FakeNode('div');
  app.id = 'app';
  const dataEl = new FakeNode('script');
  dataEl.id = 'data';
  dataEl.textContent = dataJson;
  const document: FakeDocument = {
    activeElement: null,
    hidden: false,
    createElement: (tag) => {
      const n = new FakeNode(tag);
      n.ownerDocument = document;
      return n;
    },
    createDocumentFragment: () => new FakeNode('#fragment'),
    getElementById: (id) => (id === 'data' ? dataEl : (find(app, (n) => n.id === id)[0] ?? null)),
  };
  return { app, document, window: { scrollY: 0, scrollTo: () => {}, __LIVE__: false } };
}
