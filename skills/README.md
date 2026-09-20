# Skills ของ agent-team

โฟลเดอร์นี้เป็น plugin ชื่อ `team` (ดู `.claude-plugin/plugin.json`)

เพิ่ม skill โดยสร้าง `skills/<ชื่อ-skill>/SKILL.md` (จะได้พาธ `skills/skills/<ชื่อ-skill>/SKILL.md`)
แล้วเปิดให้ role ใช้ผ่านไฟล์ `agent-team.config.json` ที่ราก repo:

{ "roles": { "frontend": { "skills": ["team:<ชื่อ-skill>"] } } }

ชื่อ skill ของ plugin ต้องขึ้นต้นด้วย `team:` และเปิดได้ทีละชื่อเท่านั้น (ห้ามใช้ "all")
