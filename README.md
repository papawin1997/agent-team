# agent-team

ทีม agent 6 บทบาท (PM, Planning, Worker frontend, Worker backend, QA, Security) บน Claude Agent SDK

## ข้อกำหนดเบื้องต้น
- Node.js 20.6 ขึ้นไป
- login Claude (subscription) ที่ SDK ใช้ได้ (ตรวจด้วย `npm run smoke:auth`)
  agent-team ใช้โควตา subscription เท่านั้น: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  และ `CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` จะถูกตัดออกจาก env ที่ส่งให้ agent เสมอ
  (ปิด "extra usage" ในบัญชีที่ claude.ai ด้วย ไม่งั้นการใช้เกินโควตาอาจถูกคิดเงิน — ตั้งจากโค้ดไม่ได้)

## ติดตั้ง
ทุกเครื่อง (ต้องมี Node.js 20.6+ และ git):

    npm i -g github:papawin1997/agent-team

อัปเดตเป็นเวอร์ชันล่าสุด: รันคำสั่งเดิมซ้ำ · ถอนการติดตั้ง: `npm rm -g agent-team`
ถ้า repo เป็น private เครื่องนั้นต้อง login GitHub ได้ (เช่น `gh auth login` หรือตั้ง SSH key)

เครื่องที่พัฒนา agent-team เอง ใช้ `npm link` แทน (แก้โค้ดแล้วมีผลทันทีโดยไม่ต้องติดตั้งใหม่):

    git clone https://github.com/papawin1997/agent-team.git
    cd agent-team
    npm install
    npm link

ตรวจว่า login Claude ใช้ได้: `npm run smoke:auth`
- เครื่องที่ clone repo (ใช้ `npm link`): รันในโฟลเดอร์ repo ได้เลย
- เครื่องที่ติดตั้งแบบ global จาก GitHub เท่านั้น (ไม่มีโฟลเดอร์ repo): ต้อง cd เข้าโฟลเดอร์แพ็กเกจที่ติดตั้งไว้ก่อน

      cd "$(npm root -g)/agent-team" && npm run smoke:auth   # bash
      cd (Join-Path (npm root -g) agent-team); npm run smoke:auth   # PowerShell

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

## ระดับงาน: quick / standard / full
PM จะจัดระดับงานให้ตอนเสนอ requirements:
- **quick** — งานเล็กที่ชัดเจน (ประมาณ 1–3 ไฟล์ ไม่มี design/API/data model ใหม่) PM เสนองาน 1 task ให้ worker ทำเลย แล้ว QA รันเทสต์ทั้งหมด (สูงสุด 2 รอบ ปรับได้ด้วย `quickMaxQaRounds` ใน `agent-team.config.json`) ไม่มีขั้น Planning/REVIEW/Security จึงเร็วและถูกกว่ามาก
- **standard** — งานขนาดกลาง (หลายไฟล์/หลาย task แต่ไม่ใช่ระบบใหม่) มี Planning และให้คุณยืนยัน design แต่ไม่มี Security ตรวจ design ส่วน Security ตรวจ task เฉพาะที่แตะไฟล์เสี่ยง
- **full** — ขั้นตอนเต็มตาม flow ด้านล่าง

ตอน PM เสนอ quick คุณเลือกได้ว่า `quick` / `standard` / `full` / `revise` (PM เสนอ standard เลือกได้ `standard` / `full` / `revise`) ถ้าคำขอแตะเรื่องเสี่ยง (login/สิทธิ์, secret/token, การชำระเงิน, ลบหรือย้ายข้อมูล, SQL, อัปโหลดไฟล์, รันคำสั่ง shell, CORS/webhook) จะมีคำเตือน ⚠ และแนะนำ full
คำเตือนนี้ตรวจแบบ keyword-based (best-effort) เท่านั้น อาจพลาดคำที่มีความหมายเสี่ยงแต่ไม่ตรง keyword หรือเตือนงานที่ไม่ได้เสี่ยงจริงก็ได้ ควรใช้วิจารณญาณของคุณเองประกอบด้วยเสมอ
คำเสี่ยงที่พิมพ์เองสะสมเฉพาะรอบรันปัจจุบัน (ถ้า resume งานกลางการคุยกับ PM คนละ process ข้อความเสี่ยงที่พิมพ์รอบก่อนจะไม่ถูกนับซ้ำ) และไม่ลดลงเมื่อคุณถอนคำขอ (เช่นพิมพ์ "ไม่เอา login แล้ว" ก็ยังถูกเตือนเรื่อง auth ต่อในรอบรันนั้น) ผลกระทบต่ำเพราะเป็นแค่คำเตือน ไม่ใช่การบล็อก

Security ใน quick/standard: หลัง QA ผ่าน ถ้า task แตะไฟล์เสี่ยง (auth/session/permission, .env/secret/key, payment, migration/sql/schema, upload, cors/webhook/proxy, Dockerfile/compose/CI, dependency manifest) หรือ diff มีคำเสี่ยง (เช่น child_process, raw SQL) จะเรียก Security ตรวจ task นั้นพร้อมบอกเหตุผล ไฟล์เทสต์ไม่นับ (ดูใน log: security.trigger)

ยกระดับ (คุณเป็นคนเลือกเสมอ ไม่มีการลดระดับเอง):
- quick ไม่ผ่าน QA ครบรอบ → เลือก standard (แนะนำ) หรือ full ได้ นอกจาก continue/accept/abort
- standard ที่ requirements/design มีคำเสี่ยง → ตอนยืนยัน design จะเตือน ⚠ และมีตัวเลือก full (Security ตรวจ design ทันทีโดยไม่ต้องออกแบบใหม่)

ถ้างาน quick ไม่ผ่าน QA ครบรอบ ตัวเลือกจะมี `standard`/`full` เพิ่ม เพื่อยกระดับไปออกแบบใหม่ (โค้ดที่ทำไปแล้วยังอยู่) ถ้างานนี้เคยเป็น standard/full มาก่อน (มี design จริงอยู่แล้วตอนถูกเปลี่ยนเป็น quick) design เดิมจะถูกคืนกลับมาให้ Planning เห็นเป็น previousDesign ไม่ได้เริ่มออกแบบใหม่ทั้งหมด

    agent-team --quick      # บอก PM ว่าอยากได้ quick (ยังผ่านเกณฑ์และเช็คคำเสี่ยงตามปกติ)
    agent-team --standard   # ไม่เสนอ quick (standard หรือ full)
    agent-team --full       # ไม่เสนอ quick ใช้ขั้นตอนเต็มเสมอ

ทั้งสามแฟล็กจะถูกบอก PM ในข้อความแรกที่คุยกับ PM ของการรันครั้งนี้เสมอ แม้เป็นการทำต่องานค้างที่เคยคุยกับ PM มาก่อนแล้วก็ตาม

## ใช้ผ่าน Claude Code (headless)

ให้ Claude Code สั่ง agent-team แทนการเปิด terminal เอง Claude จะส่งทุกคำถามของทีมกลับมาให้คุณตอบในแชต

ติดตั้ง skill ครั้งเดียว (copy ไปที่ `~/.claude/skills/agent-team/SKILL.md` รันซ้ำเพื่ออัปเดต):

    agent-team install-skill

แล้วบอก Claude Code เช่น "ให้ agent-team ทำหน้า login ในโปรเจกต์ C:/work/my/app"

คำสั่งที่ skill ใช้ (เรียกเองก็ได้):

- `agent-team run --headless --project <path> --request "..." [--quick|--standard|--full]` เริ่มงานใหม่ (ทำต่อ: `--resume` หรือ `--job <id>`) ไม่มีเมนูและไม่อ่าน stdin
- `agent-team wait [--job <id>] [--since <seq>] [--timeout <วินาที>]` รอจนมีคำถาม/งานจบ (ค่าเริ่มต้น 540 วินาที) พิมพ์ JSON สถานะ
- `agent-team status [--job <id>] [--since <seq>]` เหมือน wait แต่ตอบทันที
- `agent-team answer [--job <id>] -- "<คำตอบ>"` ตอบคำถามที่รออยู่
- `agent-team stop [--job <id>]` หยุดงาน (process ไม่หยุดใน 10 วินาทีจะถูก kill)

`run`, `wait`, `status`, `answer`, `stop`, `install-skill` เป็นคำสั่งย่อยเมื่ออยู่คำแรก (เหมือน `logs`; `run` ใส่หรือไม่ใส่ก็ได้: `agent-team run --headless ...` = `agent-team --headless ...`) ถ้าโฟลเดอร์โปรเจกต์ชื่อตรงกับคำเหล่านี้ให้พิมพ์ `./run`, `./status` ฯลฯ เช่น `agent-team ./status`

ทุกคำสั่งรับ `--project <path>` (ไม่ใส่ = โฟลเดอร์ปัจจุบัน) ไฟล์สื่อสารอยู่ใน `.agent-team/jobs/<id>/` (`events.jsonl`, `question.json`, `answer.json`, `activity.json`, `exit.json`, `stop.json`)
ถ้าไม่มีใครตอบคำถามเกิน `headlessIdleMinutes` (ค่าเริ่มต้น 120 นาที) งานจะหยุดแบบ resume ต่อได้ด้วย `--job <id>`

## flow การทำงาน
ภาพรวมตั้งแต่พิมพ์คำสั่งจนส่งมอบงาน:

    agent-team
      └─ เลือกโปรเจกต์ (เลขในเมนู / n ใส่ root path ใหม่)      ← ข้ามได้ด้วย agent-team <path>
          └─ เลือกงาน (r<เลข> ทำต่อ / n งานใหม่ / d<เลข> ลบ)   ← ข้ามได้ด้วย -r
              └─ REQUIREMENTS → DESIGN → REVIEW → BUILD → DELIVER → เสร็จ
                    |________________quick: ข้าม DESIGN/REVIEW________↑    |
                                  ↑__ขอแก้__|      ↑__escalate เป็น full__|
                                  ↑__________ขอแก้/เพิ่ม_________________|

1. REQUIREMENTS: คุยกับ PM (ถามตอบ/เสนอไอเดีย) จนคุณกด confirm requirements — ถ้า PM เสนอ quick และคุณเลือก quick
   จะข้าม DESIGN/REVIEW ไป BUILD เลย (ดูหัวข้อ "ระดับงาน: quick / standard / full" ด้านบน)
2. DESIGN: Planning ออกแบบและแตก task (frontend / backend) จากนั้น Security ตรวจ design ครั้งเดียว
   (แบบ advisory เท่านั้น — ถ้า Security ตรวจไม่สำเร็จก็ไม่ทำให้ทั้งรอบล้ม แค่ไม่มี securityNotes) แล้วแนบ securityNotes เข้า design
3. REVIEW: PM สรุปแบบ (รวม securityNotes จาก Security) ให้คุณ confirm หรือขอแก้ (ขอแก้ = วนกลับข้อ 1-3 โดยข้อความที่ขอแก้จะส่งให้ทั้ง PM และ Planning)
4. BUILD: worker ทำทีละ task ตามลำดับ dependency แล้ว QA ตรวจ และเมื่อ QA ผ่านแล้ว Security ตรวจต่ออีกรอบ (เฉพาะตอน QA ผ่านเท่านั้น เพื่อประหยัด API call)
   QA ไม่ผ่าน หรือ Security เจอ blocker/major ให้ worker แก้ใหม่ (Security ไม่ผ่าน = เสียรอบเหมือน QA ไม่ผ่าน)
   สูงสุด 5 รอบต่อ task (โหมด quick สูงสุด `quickMaxQaRounds` รอบ) ถ้าครบแล้วไม่ผ่าน PM จะถามคุณว่า
   continue (ทำต่ออีก 5 รอบ) / accept (รับตามสภาพ) / abort — งาน quick จะมีตัวเลือก standard/full เพิ่ม เพื่อยกระดับกลับไป DESIGN
   (ถ้างานนี้เคยเป็น standard/full มาก่อน design เดิมจะถูกคืนกลับมาให้ Planning ใช้ต่อ ไม่เริ่มออกแบบใหม่ทั้งหมด)
5. DELIVER: PM ส่งมอบ ให้คุณตรวจรับ (accept) หรือขอแก้/เพิ่ม (change) — คำขอแก้ที่ถูก triage เป็น quick จะข้าม
   DESIGN/REVIEW ไป BUILD เลยเหมือนข้อ 1

รอบแก้หลัง QA ไม่ผ่าน:
- worker ทำต่อใน session เดิม (ส่งแค่ผล QA) ได้ติดกัน 2 ครั้ง ครั้งถัดไปเปิด session ใหม่พร้อม task/design เต็ม ถ้า resume ไม่สำเร็จจะเปิดใหม่ให้เองในรอบเดียวกัน
- ถ้าโปรเจกต์เป็น git repo QA จะได้ diff เฉพาะสิ่งที่ worker แก้ในรอบนั้น (snapshot ด้วย index ชั่วคราว ไม่แตะ index/branch/stash ของคุณ ไม่รวม .agent-team) แล้วตรวจแค่ส่วนที่เปลี่ยน + ปัญหาเดิม แต่ยังรัน build/lint/test ทั้งหมดทุกรอบ รอบแรกและโปรเจกต์ที่ไม่ใช่ git ตรวจทั้ง task เหมือนเดิม
- submodule/repo ซ้อนอยู่ในโปรเจกต์ diff จะเห็นแค่การเปลี่ยน commit ของ submodule เท่านั้น ไม่เห็นไฟล์ข้างในที่เปลี่ยนจริง
- ดูได้ใน log: `worker.session`, `worker.resume_failed`, `qa.scope`, `snapshot.failed`

## ดู log / หาสาเหตุเมื่อ agent error
    agent-team logs                  # เลือกโปรเจกต์จากเมนู → สร้างหน้า log แล้วเปิดเบราว์เซอร์
    agent-team logs C:/path/to/app   # ระบุโปรเจกต์ตรง ๆ (หรือ agent-team logs . ในโฟลเดอร์โปรเจกต์)
    agent-team logs . --live         # เปิด server ที่ 127.0.0.1 หน้าเว็บอัปเดตเองทุก 3 วินาที (Ctrl+C เพื่อหยุด)

- แบบปกติเขียนไฟล์ `<project>/.agent-team/logs.html` (ไฟล์เดียว เปิด offline ได้) แล้วเปิดเบราว์เซอร์ให้ ถ้าเบราว์เซอร์ไม่เปิดเอง ให้เปิดไฟล์ตาม path ที่พิมพ์ไว้
- บนสุดคือกล่อง "สาเหตุที่น่าจะเป็น" ที่วิเคราะห์จาก log + transcript ของ agent: 529 Overloaded (เซิร์ฟเวอร์ Anthropic รับโหลดไม่ไหว), เชื่อมต่อ API ไม่ได้, 429 rate limit, 401/403, ใช้ turn/งบเกิน, guard ปฏิเสธคำสั่ง, agent จบโดยไม่ส่งผลลัพธ์, agent หยุดกลางคัน
- ตั้งแต่รุ่นที่ runner บันทึก `agent.api_retry` เอง (SDK ส่ง `system/api_retry` มาให้ตรง ๆ) สาเหตุพวก 529/rate limit/401-403 จะมาจาก log โดยตรง ไม่ต้องพึ่ง transcript ของ `~/.claude` เลย จึงยังเห็นสาเหตุได้แม้ transcript จะถูกลบ เปิดจากคนละเครื่อง หรือ `CLAUDE_CONFIG_DIR` ต่างกัน (รอบรันเก่าก่อนมี event นี้ยังใช้ transcript เหมือนเดิม)
- เลือกรอบรันได้จาก dropdown (ค่าเริ่มต้นคือรอบล่าสุดที่เรียก agent หรือมีปัญหา ไม่ใช่รอบสุดท้ายเสมอไป เพราะรอบสุดท้ายอาจเป็นแค่คุยต่อกับ PM โดยยังไม่เรียก agent ซึ่งจะบัง error ของรอบก่อนหน้า — รอบที่ไม่ได้เรียก agent จะมีคำว่า "(ไม่ได้เรียก agent)" ต่อท้ายใน dropdown) มีสรุปเวลา/ค่าใช้จ่าย, การ์ดของแต่ละครั้งที่เรียก agent (กดขยายดู transcript ย่อ: ข้อความ agent, tool ที่เรียกพร้อมผล, API error — ตัดแต่ละชิ้นที่ 2,000 ตัวอักษร ไม่แสดง prompt เต็ม) และ timeline ทุก event พร้อมตัวกรอง
- ส่วน "การเรียก agent" กรองตาม role (ปุ่มสีประจำ role กดได้หลายอัน) และสถานะ, เรียงตามเวลาเริ่ม/ระยะเวลา/cost/turns ส่วน Timeline กรองตามประเภท ค้นหาข้อความ และเรียงเก่า→ใหม่/ใหม่→เก่า ทั้งสองส่วนแบ่งหน้าได้ 10/20/50 ต่อหน้า (ค่าเริ่มต้น 20) — ค่าเหล่านี้ไม่ถูกจำ เปิดหน้าใหม่จะกลับเป็นค่าเริ่มต้น
- แต่ละ role มีสีและไอคอนประจำตัว: 🧭 pm, 📐 planning, 🎨 frontend, ⚙️ backend, 🔍 qa, 🛡️ security (role อื่น 🤖)
- ฟอนต์ Noto Sans Thai + Inter (และ JetBrains Mono สำหรับ log/โค้ด) ฝังอยู่ในไฟล์ `logs.html` เลย (จาก `assets/fonts/`, SIL Open Font License) เปิด offline ได้และหน้าตาเหมือนกันทุกเครื่อง ไม่มี request ออกไปภายนอก — ไฟล์จึงใหญ่ขึ้นราว 150 KB
- transcript อ่านจาก `~/.claude/projects/<path โปรเจกต์ที่แปลงเป็นชื่อโฟลเดอร์>/<sessionId>.jsonl` ที่ Claude Agent SDK เขียนไว้ (ใช้ `CLAUDE_CONFIG_DIR` ถ้าตั้งไว้) ถ้าไฟล์ถูกลบหรือเปิดจากคนละเครื่องจะขึ้นว่าไม่พบ transcript
- `logs.html` มีสิ่งที่คุณพิมพ์และข้อความของ agent อยู่ด้วย ระวังก่อนส่งต่อ และให้ `.agent-team/` อยู่ใน `.gitignore`
- `logs` ต้องเป็นคำแรกหลัง `agent-team` เสมอ ถ้าโฟลเดอร์โปรเจกต์ชื่อ `logs` ให้พิมพ์ `agent-team ./logs`; `--live` ใช้ได้กับ `logs` เท่านั้น และใช้ `-r` กับ `logs` ไม่ได้
- งานที่หยุดเพราะ error จะพิมพ์ `ดูสาเหตุ: agent-team logs "<path>"` ให้ copy ไปรันได้เลย

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
`agent.start/agent.result/agent.no_result`, `agent.api_retry` (SDK เจอ error ที่ retryable เช่น 529/rate limit/login แล้วจะลองใหม่),
`agent.session` (sessionId จริงของ SDK ทันทีที่รู้ ไม่ต้องรอ agent.result — ใช้หาสาเหตุตอน `--live`),
`qa.report`, `security.report`, `escalate.decision`, `level.decided` (ระดับงานที่ตัดสิน: level, by, reason, riskFlags), `guard.deny`,
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
(ไฟล์นี้จะอยู่ถาวรเฉพาะเครื่องที่ clone แล้ว `npm link` เท่านั้น — เครื่องที่ติดตั้งแบบ global จาก GitHub
ทุกครั้งที่รัน `npm i -g` ซ้ำเพื่ออัปเดตเวอร์ชัน โฟลเดอร์แพ็กเกจเดิมจะถูกลบแล้วติดตั้งใหม่ ไฟล์ที่แก้เองจะหายไปด้วย)

    { "maxQaRounds": 5, "roles": { "planning": { "model": "claude-opus-5" },
      "frontend": { "skills": ["team:frontend-conventions"] },
      "security": { "skills": ["team:security-checklist"] } } }

ปรับได้: model, maxTurns, maxBudgetUsd, skills ต่อ role (เครื่องมือและสิทธิ์แก้ในโค้ด `src/config.ts`)
`security` override ได้เหมือน role อื่นทุกประการ (รวม model/maxTurns/maxBudgetUsd/skills)
Security เพิ่มการเรียก Sonnet 1 ครั้งต่อ design (ตรวจครั้งเดียว) และ 1 ครั้งต่อรอบ build ที่ QA ผ่านแล้ว (ต่อ task)
`headlessIdleMinutes` — เวลาที่รอการตอบคำถามเป็นนาที ก่อนที่ process headless จะหยุดรอ (สถานะ `idle` งานไม่ถูกยกเลิก ทำต่อได้ด้วย `agent-team run --headless --job <id>`) (ค่าเริ่มต้น 120, ต้องเป็นจำนวนเต็มบวก)

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
