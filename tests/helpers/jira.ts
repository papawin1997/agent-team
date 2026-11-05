import type { HttpResponse } from '../../src/jira';

/** JSON ตอบกลับของ GET /rest/api/3/issue/RTRPMS-1 (ย่อ) — over ทับ key ระดับบนสุด */
export const issueJson = (over: Record<string, unknown> = {}) => ({
  key: 'RTRPMS-1',
  fields: {
    summary: 'สร้างหน้า login',
    issuetype: { name: 'Story' },
    status: { name: 'To Do' },
    priority: { name: 'High' },
    reporter: { displayName: 'Somchai' },
    assignee: null,
    attachment: [
      { filename: 'ui.png', mimeType: 'image/png', size: 3, content: 'https://x.test/att/1' },
      { filename: 'spec.pdf', mimeType: 'application/pdf', size: 3, content: 'https://x.test/att/2' },
    ],
  },
  renderedFields: {
    customfield_10119: '<p>Background story</p>',
    customfield_10121: '<ul><li>AC1</li></ul>',
    description: '<p>desc</p>',
  },
  ...over,
});

export const httpRes = (status: number, body?: unknown, bytes?: Uint8Array): HttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer as ArrayBuffer,
});
