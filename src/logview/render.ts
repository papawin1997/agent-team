import { PAGE_CSS, PAGE_JS } from './page-assets';
import type { ViewData } from './view-data';

/** JSON ที่วางใน <script> ได้ปลอดภัย: กัน </script> และ U+2028/2029 */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .split(LINE_SEPARATOR)
    .join('\\u2028')
    .split(PARAGRAPH_SEPARATOR)
    .join('\\u2029');
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderHtml(data: ViewData, opts: { live?: boolean } = {}): string {
  const name = data.projectDir.split(/[\\/]/).filter(Boolean).pop() ?? data.projectDir;
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-team logs — ${escapeHtml(name)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="data" type="application/json">${embedJson(data)}</script>
<script>window.__LIVE__ = ${opts.live ? 'true' : 'false'};</script>
<script>${PAGE_JS}</script>
</body>
</html>
`;
}
