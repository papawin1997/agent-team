# agent-team

ทีม agent 6 บทบาท (PM, Planning, Worker frontend, Worker backend, QA, Security) บน Claude Agent SDK

## ข้อกำหนดเบื้องต้น
- Node.js 20 ขึ้นไป
- login Claude (subscription) ที่ SDK ใช้ได้ (ตรวจด้วย `npm run smoke:auth`)
  agent-team ใช้โควตา subscription เท่านั้น: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  และ `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` จะถูกตัดออกจาก env ที่ส่งให้ agent เสมอ
  (ปิด "extra usage" ในบัญชีที่ claude.ai ด้วย ไม่งั้นการใช้เกินโควตาอาจถูกคิดเงิน — ตั้งจากโค้ดไม่ได้)


## ติดตั้ง
ทุกเครื่อง (ต้องมี Node.js 20+ และ git):

    npm i -g github:papawin1997/agent-team

อัปเดตเป็นเวอร์ชันล่าสุด: รันคำสั่งเดิมซ้ำ · ถอนการติดตั้ง: `npm rm -g agent-team`
ถ้า repo เป็น private เครื่องนั้นต้อง login GitHub ได้ (เช่น `gh auth login` หรือตั้ง SSH key)

เครื่องที่พัฒนา agent-team เอง ใช้ `npm link` แทน (แก้โค้ดแล้วมีผลทันทีโดยไม่ต้องติดตั้งใหม่):

    git clone https://github.com/papawin1997/agent-team.git
    cd agent-team
    npm install
    npm link

ตรวจว่า login Claude ใช้ได้: `npm run smoke:auth` (รันในโฟลเดอร์ repo)

## วิธีใช้
เปิด terminal ที่ไหนก็ได้ แล้วพิมพ์:

    agent-team                  # เมนูเลือกโปรเจกต์ (แนะนำ)
    agent-team .                # ใช้โฟลเดอร์ปัจจุบันเป็นโปรเจกต์ (ข้ามเมนูโปรเจกต์)
    agent-team C:/path/to/app   # ระบุโปรเจกต์ตรง ๆ (เหมือน --project C:/path/to/app)
    agent-team -r               # เลือกโปรเจกต์ แล้วทำต่องานค้างล่าสุดทันที
    agent-team . -r             # ทำต่องานค้างล่าสุดของโฟลเดอร์ปัจจุบัน (-r = --resume)

เมนูโปรเจกต์แสดงโปรเจกต์ที่เคยใช้บนเครื่องนี้ เรียงจากที่ใช้ล่าสุด:

    โปรเจกต์:
      1) shop-app — C:\work\shop-app · งานค้าง 2 · ใช้ล่าสุด 2026-09-26 14:03
      2) blog — D:\blog · งานค้าง 0 · ใช้ล่าสุด 2026-09-23 09:10
      3) old-app — C:\old · ⚠ ไม่พบโฟลเดอร์
    เลือก: <เลข> = เปิดโปรเจกต์   n = โปรเจกต์ใหม่   d<เลข> = เอาออกจากเมนู   q = ออก

- `n` ใส่ root path ของโปรเจกต์ ถ้ายังไม่มีโฟลเดอร์จะถามว่าสร้างใหม่ไหม (y/n) ถ้าโฟลเดอร์มีงานเก่าใน `.agent-team/` อยู่แล้วก็เห็นงานค้างเดิม
- `d<เลข>` เอาออกจากเมนูเท่านั้น ไม่ลบไฟล์ของโปรเจกต์
- รายชื่อเก็บต่อเครื่องที่ `~/.agent-team/projects.json` และถูกเพิ่มอัตโนมัติทุกครั้งที่รันกับโปรเจกต์ใด ๆ (รวมตอนระบุ path ตรง ๆ)
- ใช้ repo agent-team เองเป็นโปรเจกต์ไม่ได้ (จะ error) เพราะทีมจะโหลด `.claude/settings.json` และแก้โค้ดของทีมเอง
- `npm start -- --project <path>` ในโฟลเดอร์ repo ยังใช้ได้เหมือนเดิม

เมื่อเลือกโปรเจกต์แล้ว ถ้ามีงานค้าง PM จะแสดงรายการงานค้างทั้งหมด (เป้าหมาย, เฟส, ความคืบหน้า, เวลารันล่าสุด) แล้วให้เลือก:
`r<เลข>` ทำต่องานนั้น, `d<เลข>` ลบงานนั้น (ถามยืนยัน y/n แล้วลบถาวร), `n` เริ่มงานใหม่ (งานค้างเดิมยังอยู่)
ถ้ามีงานอื่นแก้โค้ดหลังจากงานที่ค้างไว้ จะมีคำเตือน ⚠ ว่าโค้ดอาจเปลี่ยนไปแล้ว (ยังทำต่อได้)
ถ้ามีงานอื่นกำลังรันอยู่ในโปรเจกต์เดียวกัน (อีกหน้าต่าง) `r`/`n` จะเตือนว่า worker อาจแก้ไฟล์ชนกันแล้วถาม y/n ก่อน
`-r`/`--resume` ข้ามเมนูงานแล้วทำต่องานค้างที่รันล่าสุด และบอกชื่องานที่เลือก ถ้าไม่มีงานค้าง หรือมีงานอื่นกำลังรันอยู่ในโปรเจกต์นี้ จะ error (ไม่เริ่มงานซ้อน)
Ctrl+C หยุดได้ทุกเมื่อ: state ถูกบันทึกทุกครั้งที่เปลี่ยน phase/รอบ จึงเสียอย่างมากแค่รอบที่กำลังทำอยู่ แล้วรันใหม่เลือกงานนี้จากเมนู หรือใช้ -r (stdin ที่ถูกปิด/pipe จะหยุดพร้อมข้อความ EOF ไม่ค้าง)
ระหว่างที่ agent ทำงานจะมีบรรทัดสถานะ เช่น `⠹ [QA] T2: กำลังตรวจ 1m23s · อ่านไฟล์ src/api/user.ts` (เวลาที่ผ่านไป + สิ่งที่ agent ทำล่าสุด) ถ้า output ไม่ใช่ terminal (pipe/redirect) จะพิมพ์แค่ `[QA] T2: กำลังตรวจ...` บรรทัดเดียวตอนเริ่ม

## flow การทำงาน
ภาพรวมตั้งแต่พิมพ์คำสั่งจนส่งมอบงาน:

    agent-team
      └─ เลือกโปรเจกต์ (เลขในเมนู / n ใส่ root path ใหม่)      ← ข้ามได้ด้วย agent-team <path>
          └─ เลือกงาน (r<เลข> ทำต่อ / n งานใหม่ / d<เลข> ลบ)   ← ข้ามได้ด้วย -r
              └─ REQUIREMENTS → DESIGN → REVIEW → BUILD → DELIVER → เสร็จ
                                  ↑__ขอแก้__|                |
                                  ↑__________ขอแก้/เพิ่ม______|

1. REQUIREMENTS: คุยกับ PM (ถามตอบ/เสนอไอเดีย) จนคุณกด confirm requirements
2. DESIGN: Planning ออกแบบและแตก task (frontend / backend) จากนั้น Security ตรวจ design ครั้งเดียว
   (แบบ advisory เท่านั้น — ถ้า Security ตรวจไม่สำเร็จก็ไม่ทำให้ทั้งรอบล้ม แค่ไม่มี securityNotes) แล้วแนบ securityNotes เข้า design
3. REVIEW: PM สรุปแบบ (รวม securityNotes จาก Security) ให้คุณ confirm หรือขอแก้ (ขอแก้ = วนกลับข้อ 1-3 โดยข้อความที่ขอแก้จะส่งให้ทั้ง PM และ Planning)
4. BUILD: worker ทำทีละ task ตามลำดับ dependency แล้ว QA ตรวจ และเมื่อ QA ผ่านแล้ว Security ตรวจต่ออีกรอบ (เฉพาะตอน QA ผ่านเท่านั้น เพื่อประหยัด API call)
   QA ไม่ผ่าน หรือ Security เจอ blocker/major ให้ worker แก้ใหม่ (Security ไม่ผ่าน = เสียรอบเหมือน QA ไม่ผ่าน)
   สูงสุด 5 รอบต่อ task ถ้าครบแล้วไม่ผ่าน PM จะถามคุณว่า
   continue (ทำต่ออีก 5 รอบ) / accept (รับตามสภาพ) / abort
5. DELIVER: PM ส่งมอบ ให้คุณตรวจรับ (accept) หรือขอแก้/เพิ่ม (change)

## state
แต่ละงานเก็บแยกโฟลเดอร์ที่ `<project>/.agent-team/jobs/<jobId>/` (`state.json`, `requirements.json`, `design.json`,
`reports/<taskId>-round<n>.json`) โดย `jobId` คือเวลาที่สร้างงาน แนะนำให้เพิ่ม `.agent-team/` ใน `.gitignore` ของโปรเจกต์นั้น
ถ้าเจอ `.agent-team/state.json` แบบเก่า (ก่อนรองรับหลายงาน) จะย้ายเข้า `jobs/` ให้อัตโนมัติตอนเริ่มรัน
งานที่กำลังรันมีไฟล์ `run.lock` (pid) กันไม่ให้ process อื่นทำต่อหรือลบงานเดียวกัน ถ้า lock ค้าง
(เช่น pid ถูก process อื่นเอาไปใช้ซ้ำ) เมนูจะบอก path ของไฟล์ให้ลบเอง
ข้อจำกัด: ถ้าเปิดงานเดียวกันจาก 2 หน้าต่างแทบพร้อมกันในจังหวะที่ lock เดิมค้างอยู่ ทั้งสองอาจได้ lock (ไม่มีการกันกรณีนี้) อย่าเปิดงานเดียวกันพร้อมกัน
ถ้าทำต่องานที่ค้างระหว่างคุยกับ PM ให้พิมพ์ข้อความต่อจากบทสนทนาเดิม

## log
บันทึกที่ `<project>/.agent-team/agent-team.log` (ต่อท้ายไฟล์เดิมข้ามรอบรัน/`--resume` เวลาเป็น UTC)
หนึ่งเหตุการณ์ต่อบรรทัด: `เวลา LEVEL event {json}` ตัวอย่างที่ดูบ่อย:

    grep " agent.result "    .agent-team/agent-team.log   # แต่ละครั้งที่เรียก agent: turns, เวลา, cost
    grep " qa.report "       .agent-team/agent-team.log   # ผล QA ต่อ task ต่อรอบ
    grep " security.report " .agent-team/agent-team.log   # ผล Security ต่อ task ต่อรอบ (เฉพาะรอบที่ QA ผ่านแล้ว)
    grep " guard.deny "      .agent-team/agent-team.log   # คำสั่ง/ไฟล์ที่ guard ปฏิเสธ
    grep " job.selected "    .agent-team/agent-team.log   # งานที่เลือกในแต่ละรอบรัน (jobId)
    grep -E " (WARN|ERROR) " .agent-team/agent-team.log

event หลัก: `run.start/run.end/run.error/run.interrupted`, `team.start/team.end`, `phase.change`,
`agent.start/agent.result/agent.no_result`, `qa.report`, `security.report`, `escalate.decision`, `guard.deny`,
`say` (ทุกข้อความที่แสดงใน terminal), `user.input` / `user.choice` (สิ่งที่คุณพิมพ์/เลือก)
event เกี่ยวกับ job (housekeeping ของหลายงานใน `jobs/`):
`job.selected` (งานที่เลือกในแต่ละรอบรัน), `job.migrated` (ย้าย state แบบเก่าเข้า `jobs/` สำเร็จ),
`job.unreadable` (ข้ามงานที่อ่าน state/lock ไม่ได้ระหว่าง list), `job.missing_state` (โฟลเดอร์งานไม่มี state.json),
`job.orphan_removed` (ลบโฟลเดอร์ที่สร้างงานไม่เสร็จ: มีแค่ lock ค้าง ไม่มี state.json),
`job.legacy_leftover` (มี artifact แบบเก่าตกค้างที่ root โดยไม่มี state.json ให้ย้าย),
`job.unlock_failed` (ปลด lock ไม่สำเร็จ), `job.remove_failed` (ลบงานเปล่า/งานที่ขอลบไม่สำเร็จแบบ best-effort)
log ไฟล์นี้ใช้ร่วมกันทุกงาน (ไม่แยกไฟล์ต่อ jobId) มีเฉพาะ `job.selected` เท่านั้นที่บอก `jobId` ของรอบรันนั้น
ข้อความยาวเกิน 1,000 ตัวอักษรจะถูกตัด และ log เขียนไม่ได้จะไม่ทำให้งานล้ม
ไม่มี prompt/คำตอบดิบของ agent ใน log (มีเฉพาะสรุป) — `cost` ที่เห็นคำนวณตามราคา API ไม่ใช่ยอดที่ถูกเรียกเก็บจริง
Security ถูกเรียกเฉพาะรอบที่ QA ผ่านแล้ว ดังนั้นรอบไหนมี `security.report` แปลว่า QA รอบนั้นผ่านจริง
แต่ Security อาจเจอ issue เพิ่มจนรอบนั้นถูกนับว่าไม่ผ่านอยู่ดี (issue ของ Security จะถูกรวมเข้า `qa.report`/
`reports/<id>-round<n>.json` ของรอบเดียวกันด้วย) ส่วนรอบที่ QA ไม่ผ่านตั้งแต่แรกจะไม่มี `security.report` เลย
(ประหยัด API call) — ใช้แยกได้ว่ารอบนั้นเสียเพราะ Security เจอช่องโหว่ ไม่ใช่ QA ไม่ผ่านงานปกติ

## ตั้งค่า (ไม่บังคับ)
สร้าง `agent-team.config.json` ที่ราก repo นี้ ตัวอย่าง:

    { "maxQaRounds": 5, "roles": { "planning": { "model": "claude-opus-5" },
      "frontend": { "skills": ["team:frontend-conventions"] },
      "security": { "skills": ["team:security-checklist"] } } }

ปรับได้: model, maxTurns, maxBudgetUsd, skills ต่อ role (เครื่องมือและสิทธิ์แก้ในโค้ด `src/config.ts`)
`security` override ได้เหมือน role อื่นทุกประการ (รวม model/maxTurns/maxBudgetUsd/skills)
Security เพิ่มการเรียก Sonnet 1 ครั้งต่อ design (ตรวจครั้งเดียว) และ 1 ครั้งต่อรอบ build ที่ QA ผ่านแล้ว (ต่อ task)

## Skills
วาง skill ที่ `skills/skills/<ชื่อ>/SKILL.md` แล้วเปิดให้ role ผ่าน config ด้านบน (ชื่อ `team:<ชื่อ>`)
ทุก role ค่าเริ่มต้นไม่มี skill และไม่โหลด skill/hook/CLAUDE.md ส่วนตัวใน `~/.claude`

## ความปลอดภัยและข้อจำกัด
- เขียนไฟล์ได้เฉพาะในโฟลเดอร์โปรเจกต์ ห้ามแตะ `.git`, `.agent-team`, `.claude`
- QA เขียนได้เฉพาะไฟล์ test, PM/Planning/Security อ่านอย่างเดียว (Security ไม่รันคำสั่งและไม่แก้ไฟล์ใด ๆ เลย)
- QA/Security ได้รับผลงานของ worker ห่อด้วย delimiter แบบสุ่มต่อครั้งพร้อมกำกับว่าเป็น DATA ไม่ใช่คำสั่ง เป็นด่านเสริมแบบ best-effort ไม่ใช่การรับประกันว่ากัน prompt injection ได้ทั้งหมด
- git: agent รันได้เฉพาะคำสั่งอ่านอย่างเดียว (status, diff, log, show, ls-files, rev-parse, blame) คำสั่งอื่นเช่น commit/push/reset ถูกปฏิเสธ (agent ไม่ commit/push ให้)
- Bash ถูกจำกัดด้วย allowlist คำสั่ง (dontAsk) + guard ที่ตรวจข้อความคำสั่งแบบ lexical เป็นด่านเสริมแบบ best-effort ไม่ใช่ sandbox ระดับ OS
- `node -e` / `python -c` / `go run` ถูกอนุญาตไว้ล่วงหน้า (จำเป็นสำหรับ build/test) จึงทำได้ทุกอย่างที่ผู้ใช้ OS ทำได้ รวมถึงเขียนไฟล์นอกโฟลเดอร์โปรเจกต์หรือแก้ `.git` และ guard มองไม่เห็นสิ่งที่อยู่ข้างใน จึงควรรันกับโปรเจกต์ที่ commit/สำรองไว้ก่อนเสมอ
- `docker compose *` / `docker ps` / `docker logs *` ถูกอนุญาตไว้ล่วงหน้า (พอสำหรับ spin up service อย่าง Postgres และตรวจสถานะ/log) แต่ `docker run`/`docker exec` ไม่ได้อนุญาต จึงยังสั่ง `-v /:/host` หรือ `--privileged` ผ่าน allowlist นี้ไม่ได้
- `--project` จะโหลด `.claude/settings.json` ของโปรเจกต์นั้น (รวม hooks/permissions) ใช้กับโฟลเดอร์ที่ไว้ใจได้เท่านั้น และห้ามชี้ `--project` มาที่ repo agent-team นี้เอง
- environment ทั้งหมดของ shell (รวม secret) ถูกส่งต่อให้ subprocess ของ agent ควรรันจาก shell ที่สะอาด
- QA ไม่มี browser: ฝั่ง frontend ตรวจได้แค่ build/lint/unit test/review โค้ด
- ตั้ง `AGENT_TEAM_DEBUG=1` เพื่อให้พิมพ์ init ของแต่ละ role (skills/plugins/tools)
