// logic กรอง/เรียง/แบ่งหน้าของหน้า agent-team logs (ฟังก์ชันล้วน ไม่แตะ DOM)
// ฝังเป็น <script> แยกก่อน PAGE_JS แล้วใช้ผ่าน global AgentTeamList — เทสต์ได้ด้วย new Function(LIST_JS + 'return AgentTeamList')
// เนื้อหาจริงอยู่ที่ src/logview/web/list.js (ไฟล์ .js จริงที่ผ่าน // @ts-check) — อ่านตอนโหลดโมดูลนี้
// เพื่อให้ editor/typecheck ทำงานกับโค้ดฝั่งเบราว์เซอร์ได้ตรง ๆ โดยยังคง export ชื่อเดิมไว้

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIST_JS = fs.readFileSync(fileURLToPath(new URL('./web/list.js', import.meta.url)), 'utf8');
