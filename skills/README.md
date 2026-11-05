# Skills ของ agent-team

โฟลเดอร์นี้เป็น plugin ชื่อ `team` (ดู `.claude-plugin/plugin.json`) skill อยู่ที่ `skills/skills/<ชื่อ>/SKILL.md`

## skill จาก skill-ai-naja
skill ส่วนใหญ่ sync มาจาก https://github.com/papawin1997/skill-ai-naja ด้วย

    npm run sync-skills                      # ต้นทาง: SKILL_AI_NAJA_DIR → ~/ai-skills → clone จาก GitHub
    npm run sync-skills -- --from <path>     # ระบุโฟลเดอร์ต้นทางเอง

- copy ทุกโฟลเดอร์ที่มี `SKILL.md` ยกเว้นรายชื่อ `deny` ใน `sync.json` (skill ที่ต้องใช้ subagent/browser/commit หรือซ้ำกับระบบของ agent-team)
- `synced.json` จดชื่อที่ sync มา: sync รอบต่อไปลบเฉพาะตัวที่หายจากต้นทางหรือถูกเพิ่มเข้า deny
- skill ที่เขียนเองไม่ถูกแตะ ถ้าชื่อซ้ำกับต้นทางจะไม่ถูกทับ (ขึ้นในหมวด "ข้าม")
- อย่าแก้ไฟล์ของ skill ที่ sync มาใน repo นี้ — แก้ที่ skill-ai-naja แล้ว sync ใหม่
- sync เสร็จแล้วตรวจ diff และ commit เอง
- `licenses/` คัดมาจากต้นทาง (skill ชุด tb-* ดัดแปลงจาก superpowers ซึ่งเป็น MIT)

## เปิดให้ role ใช้
ค่าเริ่มต้นไม่เปิด skill ให้ role ใด เปิดผ่าน `agent-team.config.json` ที่ราก repo:

    { "roles": { "frontend": { "skills": ["team:tb-test-driven-development"] } } }

ชื่อต้องขึ้นต้นด้วย `team:` และเปิดได้ทีละชื่อ (ห้ามใช้ "all") ชื่อที่ไม่มีในโฟลเดอร์นี้จะทำให้ agent-team แจ้ง error ตอนเริ่ม
