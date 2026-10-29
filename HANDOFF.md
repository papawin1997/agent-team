# Handoff — agent-team: วินัยจาก skill, Jira, เตือนโควตา

เขียนเมื่อ 2026-10-29 ให้ agent ที่มารับงานต่อ คุยกับผู้ใช้เป็น **ภาษาไทย** (handoff ฉบับก่อนหน้าดูได้จาก git history ของไฟล์นี้ แต่ล้าสมัยแล้ว)

## สถานะ
- branch `feat/skills-jira-quota` (แตกจาก `main` ที่ `af69ed8`) มี commit เดียวคือ design + ไฟล์นี้ ยังไม่ได้แก้โค้ด
- design **ผู้ใช้อนุมัติแล้ว**: `docs/superpowers/specs/2026-10-29-team-skills-jira-quota-design.md` — อ่านก่อนทำอะไรทั้งนั้น (ผ่าน builder check แล้ว ข้อตัดสินใจทั้งหมดอยู่ท้ายไฟล์)
- ยังไม่ได้รัน `npm install` ใน repo นี้ (`node_modules` ไม่มี) — ต้อง install ก่อนรันเทสต์ ; type ของ SDK 0.3.278 ดูได้จากสำเนาที่ติดตั้ง global: `$(npm root -g)/agent-team/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`SDKRateLimitEvent` ~บรรทัด 5320)

## ขั้นต่อไป
1. เขียน implementation plan จาก design (skill `superpowers:writing-plans` หรือ `tb-writing-plans` ที่ผู้ใช้ชอบ) ทำตามลำดับ **ส่วน 1 → 2 → 3** แต่ละส่วนเทสต์ผ่านได้ด้วยตัวเอง
2. ให้ผู้ใช้อนุมัติแผน แล้วลงมือแบบ TDD
3. ส่วนที่ 3 ต้องให้ผู้ใช้รันงานเล็กจริงเพื่อดู `quota.event` ใน log (ใช้โควตาจริง ห้ามรันเองโดยไม่ถาม)

## สิ่งที่ผู้ใช้ต้องการ (สรุปจากการคุย)
- อยากให้ทีมทำงานตามวินัยของ skill tb-* ของผู้ใช้ (`~/.claude/skills/`) แต่ **ประหยัด token**: ไม่โหลด skill เต็ม ไม่ทำ HTML เพราะไม่มีใครอ่าน → ย่อวินัยใส่ system prompt (แนวทาง A)
- อยากให้ PM อ่าน requirement จากการ์ด Jira (RTRED-xxxx) แล้วถามตอบต่อ
- ใช้ subscription เท่านั้น: โควตาใกล้เต็มหรือเริ่มใช้ extra usage → เตือนใน terminal แล้วถาม handoff/continue ; handoff ต้องให้ AI ตัวอื่นหรือคนอ่านทำต่อได้ (ผู้ใช้มี AI หลายตัว)

## ข้อตกลงการทำงาน
- ไม่ `git add -A`/`.` ; stage เฉพาะ path ; ไม่ add `agent_structure.txt`
- free-text `io.ask` ใน phases ใช้ `askNonEmpty` (`src/io-util.ts`)
- ห้ามใช้ repo นี้เป็น `--project` ของ agent-team เอง
