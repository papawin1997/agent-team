// CSS + JS ของหน้า agent-team logs (ฝังลงใน HTML ไฟล์เดียว; ฟอนต์ฝังโดย render.ts จาก assets/fonts)
// PAGE_JS: เนื้อหาจริงอยู่ที่ src/logview/web/page.js (ไฟล์ .js จริงที่ผ่าน // @ts-check) — ดูเหตุผลที่ list-assets.ts

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PAGE_CSS = String.raw`
:root{
--bg:#f6f7f9;--card:#fff;--fg:#1f2933;--muted:#5b6876;--border:#d9dee5;--err:#c62828;--err-bg:#fdecea;--warn:#a15c00;--warn-bg:#fff4e0;--ok:#1b7f3b;--info:#2457c5;--info-bg:#e8effc;--code:#eef1f5;
--r-pm:#7c3aed;--r-planning:#1d4ed8;--r-frontend:#be185d;--r-backend:#0f766e;--r-qa:#c2410c;--r-security:#86198f;--r-other:#64748b;--role-fg:#fff;
--font-sans:"Inter","Noto Sans Thai","Leelawadee UI","Segoe UI",Tahoma,system-ui,sans-serif;
--font-mono:"JetBrains Mono","Noto Sans Thai",ui-monospace,"Cascadia Mono",Consolas,monospace;
--fs-h1:clamp(1.5rem,1.3rem + 1vw,2rem);
--fs-h2:clamp(1.2rem,1.1rem + .5vw,1.4rem);
--fs-h3:clamp(1.05rem,1rem + .25vw,1.15rem);
--fs-body:clamp(.9375rem,.9rem + .2vw,1rem);
--fs-small:.875rem;
--fs-caption:.8125rem;
--fs-mono:.8125rem;
--lh-heading:1.35;--lh-body:1.7;--lh-mono:1.5;
--ls-body:0;--ls-heading:0;--ls-caption:.01em
}
@media (prefers-color-scheme: dark){:root{
--bg:#12161c;--card:#1b2129;--fg:#e4e8ee;--muted:#a3adb8;--border:#2e3742;--err:#ff8a80;--err-bg:#3a1d1d;--warn:#ffcc80;--warn-bg:#3a2e1a;--ok:#81c995;--info:#8ab4f8;--info-bg:#1d2a40;--code:#232b35;
--r-pm:#c4b5fd;--r-planning:#93c5fd;--r-frontend:#f9a8d4;--r-backend:#5eead4;--r-qa:#fdba74;--r-security:#f0abfc;--r-other:#cbd5e1;--role-fg:#12161c
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-sans);font-size:var(--fs-body);line-height:var(--lh-body);letter-spacing:var(--ls-body);-webkit-font-smoothing:antialiased}
#app{max-width:1100px;margin:0 auto;padding:16px}
h1,h2,h3{font-weight:600;line-height:var(--lh-heading);letter-spacing:var(--ls-heading)}
h1{font-size:var(--fs-h1);margin:0 0 4px}
h2{font-size:var(--fs-h2);margin:0 0 10px}
h3{font-size:var(--fs-h3);margin:6px 0}
section,.head{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:12px}
.muted{color:var(--muted)}
.small{font-size:var(--fs-caption);letter-spacing:var(--ls-caption)}
select,button,input{font:inherit;font-size:var(--fs-small);line-height:1.5;color:inherit;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 10px;max-width:100%}
button{cursor:pointer;margin:2px}
button:disabled{opacity:.45;cursor:default}
input[type=search]{flex:1 1 220px;min-width:0;font-size:max(16px,var(--fs-body))}
.finding{border-left:4px solid;border-radius:6px;padding:8px 12px;margin:8px 0}
.sev-error{border-color:var(--err);background:var(--err-bg)}
.sev-warn{border-color:var(--warn);background:var(--warn-bg)}
.sev-info{border-color:var(--info);background:var(--info-bg)}
.detail{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0;background:var(--code);padding:8px 10px;border-radius:6px;font-family:var(--font-mono);font-size:var(--fs-mono);line-height:var(--lh-mono);max-height:320px;overflow:auto}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.stat{border:1px solid var(--border);border-radius:6px;padding:6px 10px;overflow-wrap:anywhere}
.stat b{display:block;font-size:var(--fs-caption);letter-spacing:var(--ls-caption);color:var(--muted);font-weight:normal}
.card{border:1px solid var(--border);border-left:4px solid var(--role,var(--border));border-radius:6px;margin:6px 0}
.card>button{width:100%;margin:0;text-align:left;border:0;border-radius:0 6px 6px 0;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;padding:8px 10px}
.card.failed>button{background:var(--err-bg)}
.card .body{padding:4px 10px 10px}
.step{border-top:1px dashed var(--border);padding:6px 0}
.t{color:var(--muted);font-size:var(--fs-caption);letter-spacing:var(--ls-caption);margin-right:6px}
.kind-api_error{color:var(--err)}
.filters,.controls,.pager{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px}
.pager{margin:10px 0 0}
.pager-info{color:var(--muted);font-size:var(--fs-small)}
.filters button.on{background:var(--info-bg);border-color:var(--info)}
.role-pm{--role:var(--r-pm)}
.role-planning{--role:var(--r-planning)}
.role-frontend{--role:var(--r-frontend)}
.role-backend{--role:var(--r-backend)}
.role-qa{--role:var(--r-qa)}
.role-security{--role:var(--r-security)}
.role-other{--role:var(--r-other)}
.role-badge{display:inline-block;border:1px solid var(--role);background:var(--role);color:var(--role-fg);border-radius:999px;padding:0 8px;margin:0 6px 0 0;font-size:var(--fs-caption);font-weight:600;line-height:1.7;white-space:nowrap}
button.role-badge{margin:2px}
.filters .chip{border-color:var(--role);color:var(--role);font-weight:600}
.filters .chip.on{background:var(--role);border-color:var(--role);color:var(--role-fg)}
details{border-top:1px solid var(--border);padding:4px 0}
summary{cursor:pointer;overflow-wrap:anywhere}
.lv{display:inline-block;min-width:52px;font-size:var(--fs-caption);font-weight:700;letter-spacing:var(--ls-caption);margin-right:6px}
.lv-INFO{color:var(--muted)}
.lv-WARN{color:var(--warn)}
.lv-ERROR,.lv-RAW{color:var(--err)}
.ev{font-family:var(--font-mono);font-size:var(--fs-mono);margin-right:6px}
.ok{color:var(--ok)}
.bad{color:var(--err)}
@media (max-width:600px){select,input{font-size:max(16px,var(--fs-body))}}
`;

export const PAGE_JS = fs.readFileSync(fileURLToPath(new URL('./web/page.js', import.meta.url)), 'utf8');
