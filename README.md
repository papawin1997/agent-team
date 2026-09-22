# agent-team

ทีม agent 5 บทบาท (PM, Planning, Worker frontend, Worker backend, QA) บน Claude Agent SDK

## ข้อกำหนดเบื้องต้น
- Node.js 20 ขึ้นไป
- login Claude (subscription) ที่ SDK ใช้ได้ (ตรวจด้วย `npm run smoke:auth`)
  agent-team ใช้โควตา subscription เท่านั้น: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  และ `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` จะถูกตัดออกจาก env ที่ส่งให้ agent เสมอ
  (ปิด "extra usage" ในบัญชีที่ claude.ai ด้วย ไม่งั้นการใช้เกินโควตาอาจถูกคิดเงิน — ตั้งจากโค้ดไม่ได้)

## วิธีใช้
    npm install
    npm start -- --project C:/path/to/app          # โฟลเดอร์ต้องมีอยู่แล้ว (ว่างได้)
    npm start -- --project C:/path/to/app --resume  # ทำต่อจากที่หยุดไว้
Ctrl+C หยุดได้ทุกเมื่อ: state ถูกบันทึกทุกครั้งที่เปลี่ยน phase/รอบ จึงเสียอย่างมากแค่รอบที่กำลังทำอยู่ แล้วรันต่อด้วย --resume (stdin ที่ถูกปิด/pipe จะหยุดพร้อมข้อความ EOF ไม่ค้าง)

## flow
1. REQUIREMENTS: คุยกับ PM (ถามตอบ/เสนอไอเดีย) จนคุณกด confirm requirements
2. DESIGN: Planning ออกแบบและแตก task (frontend / backend)
3. REVIEW: PM สรุปแบบให้คุณ confirm หรือขอแก้ (ขอแก้ = วนกลับข้อ 1-3 โดยข้อความที่ขอแก้จะส่งให้ทั้ง PM และ Planning)
4. BUILD: worker ทำทีละ task ตามลำดับ dependency แล้ว QA ตรวจ
   QA ไม่ผ่านให้ worker แก้ใหม่ สูงสุด 5 รอบต่อ task ถ้าครบแล้วไม่ผ่าน PM จะถามคุณว่า
   continue (ทำต่ออีก 5 รอบ) / accept (รับตามสภาพ) / abort
5. DELIVER: PM ส่งมอบ ให้คุณตรวจรับ (accept) หรือขอแก้/เพิ่ม (change)

## state
บันทึกใน `<project>/.agent-team/` (`state.json`, `requirements.json`, `design.json`,
`reports/<taskId>-round<n>.json`) แนะนำให้เพิ่ม `.agent-team/` ใน `.gitignore` ของโปรเจกต์นั้น
ถ้าใช้ `--resume` ระหว่างคุยกับ PM ให้พิมพ์ข้อความต่อจากบทสนทนาเดิม

## log
บันทึกที่ `<project>/.agent-team/agent-team.log` (ต่อท้ายไฟล์เดิมข้ามรอบรัน/`--resume` เวลาเป็น UTC)
หนึ่งเหตุการณ์ต่อบรรทัด: `เวลา LEVEL event {json}` ตัวอย่างที่ดูบ่อย:

    grep " agent.result " .agent-team/agent-team.log   # แต่ละครั้งที่เรียก agent: turns, เวลา, cost
    grep " qa.report "   .agent-team/agent-team.log   # ผล QA ต่อ task ต่อรอบ
    grep " guard.deny "  .agent-team/agent-team.log   # คำสั่ง/ไฟล์ที่ guard ปฏิเสธ
    grep -E " (WARN|ERROR) " .agent-team/agent-team.log

event หลัก: `run.start/run.end/run.error/run.interrupted`, `team.start/team.end`, `phase.change`,
`agent.start/agent.result/agent.no_result`, `qa.report`, `escalate.decision`, `guard.deny`,
`say` (ทุกข้อความที่แสดงใน terminal), `user.input` / `user.choice` (สิ่งที่คุณพิมพ์/เลือก)
ข้อความยาวเกิน 1,000 ตัวอักษรจะถูกตัด และ log เขียนไม่ได้จะไม่ทำให้งานล้ม
ไม่มี prompt/คำตอบดิบของ agent ใน log (มีเฉพาะสรุป) — `cost` ที่เห็นคำนวณตามราคา API ไม่ใช่ยอดที่ถูกเรียกเก็บจริง

## ตั้งค่า (ไม่บังคับ)
สร้าง `agent-team.config.json` ที่ราก repo นี้ ตัวอย่าง:

    { "maxQaRounds": 5, "roles": { "planning": { "model": "claude-opus-5" },
      "frontend": { "skills": ["team:frontend-conventions"] } } }

ปรับได้: model, maxTurns, maxBudgetUsd, skills ต่อ role (เครื่องมือและสิทธิ์แก้ในโค้ด `src/config.ts`)

## Skills
วาง skill ที่ `skills/skills/<ชื่อ>/SKILL.md` แล้วเปิดให้ role ผ่าน config ด้านบน (ชื่อ `team:<ชื่อ>`)
ทุก role ค่าเริ่มต้นไม่มี skill และไม่โหลด skill/hook/CLAUDE.md ส่วนตัวใน `~/.claude`

## ความปลอดภัยและข้อจำกัด
- เขียนไฟล์ได้เฉพาะในโฟลเดอร์โปรเจกต์ ห้ามแตะ `.git`, `.agent-team`, `.claude`
- QA เขียนได้เฉพาะไฟล์ test, PM/Planning อ่านอย่างเดียว
- git: agent รันได้เฉพาะคำสั่งอ่านอย่างเดียว (status, diff, log, show, ls-files, rev-parse, blame) คำสั่งอื่นเช่น commit/push/reset ถูกปฏิเสธ (agent ไม่ commit/push ให้)
- Bash ถูกจำกัดด้วย allowlist คำสั่ง (dontAsk) + guard ที่ตรวจข้อความคำสั่งแบบ lexical เป็นด่านเสริมแบบ best-effort ไม่ใช่ sandbox ระดับ OS
- `node -e` / `python -c` / `go run` ถูกอนุญาตไว้ล่วงหน้า (จำเป็นสำหรับ build/test) จึงทำได้ทุกอย่างที่ผู้ใช้ OS ทำได้ รวมถึงเขียนไฟล์นอกโฟลเดอร์โปรเจกต์หรือแก้ `.git` และ guard มองไม่เห็นสิ่งที่อยู่ข้างใน จึงควรรันกับโปรเจกต์ที่ commit/สำรองไว้ก่อนเสมอ
- `docker *` ถูกอนุญาตไว้ล่วงหน้าทั้งหมด (ไม่จำกัดเฉพาะ `docker compose`) จึงสั่ง `docker run -v /:/host` หรือ `--privileged` ได้ถ้า agent เลือกทำ — guard ตรวจแบบ lexical เท่านั้น ไม่ได้บล็อก flag เหล่านี้ ควรรันเฉพาะกับโปรเจกต์ที่ไว้ใจได้และไม่มี secret/credential บน host ที่ไม่อยากให้ container เข้าถึง
- `--project` จะโหลด `.claude/settings.json` ของโปรเจกต์นั้น (รวม hooks/permissions) ใช้กับโฟลเดอร์ที่ไว้ใจได้เท่านั้น และห้ามชี้ `--project` มาที่ repo agent-team นี้เอง
- environment ทั้งหมดของ shell (รวม secret) ถูกส่งต่อให้ subprocess ของ agent ควรรันจาก shell ที่สะอาด
- QA ไม่มี browser: ฝั่ง frontend ตรวจได้แค่ build/lint/unit test/review โค้ด
- ตั้ง `AGENT_TEAM_DEBUG=1` เพื่อให้พิมพ์ init ของแต่ละ role (skills/plugins/tools)
