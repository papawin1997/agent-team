# Design — วินัยจาก skill, อ่าน Jira, เตือนโควตา + handoff

วันที่ 2026-10-29 · สถานะ: รออนุมัติ (ผ่าน builder check แล้ว)

## เจตนา

ผู้ใช้ทำงานเองด้วย workflow ของ skill ชุด tb-* ใน `~/.claude/skills/` (tb-brainstorming → tb-writing-plans → tb-test-driven-development → tb-scrutinize, เจอบัคใช้ tb-investigate-error, อ่านการ์ดด้วย read-jira) และอยากให้ทีมใน agent-team ทำงานด้วยวินัยเดียวกัน
ข้อจำกัดหลักคือ **ประหยัด token**: skill ต้นฉบับยาว (TDD 371 บรรทัด, writing-plans 242) และทำไฟล์ HTML/spec ที่ไม่มีใครอ่าน เพราะผู้ใช้ไม่ได้นั่งตรวจ
ผู้ใช้ใช้ subscription เท่านั้น จึงอยากรู้ตัวก่อนโควตาหมด และมี AI หลายตัว ถ้าต้องหยุดอยากได้ handoff ที่ใครก็ทำต่อได้

ทำเป็น 3 ส่วนแยกกัน ตามลำดับ: **1 → 2 → 3** (แต่ละส่วนเทสต์ผ่านและใช้ได้ด้วยตัวเอง)

## Non-goals / Anti-goals

- ไม่โหลด skill ฉบับเต็มเข้า agent และไม่เรียก Skill tool (เปลือง turn + context ทุกรอบ QA) — ไม่แตะกลไก `skills` / plugin `team` เดิม
- ไม่สร้าง HTML, ไฟล์ spec/plan, browser companion, subagent review ใด ๆ จาก agent ในทีม
- ไม่แก้ไฟล์ใน `~/.claude/skills/` (ฉบับย่อในทีมจึงไม่ sync ตามต้นฉบับ — ยอมรับ)
- ไม่ให้ agent ตัวไหนเห็น `JIRA_TOKEN` และไม่เปิด `curl`/`python` เพิ่มให้ role ใด
- ไม่เขียน Jira (สร้าง/แก้/เปลี่ยนสถานะการ์ด) — อ่านอย่างเดียว
- ไม่ตัด agent กลางขั้นเพราะโควตาใกล้เต็ม (ห้ามทิ้งไฟล์แก้ครึ่ง ๆ)
- handoff ไม่ใช้ AI เขียน (ต้องไม่ใช้โควตา และต้องเขียนได้แม้โควตาเต็มแล้ว)

---

## ส่วนที่ 1 — วินัยจาก skill ใน system prompt

แก้เฉพาะ `src/prompts.ts` (ค่าคงที่ prompt ของแต่ละ role และฟังก์ชัน build*Prompt) — เพิ่มย่อหน้า "Discipline" สั้น ๆ (ราว 5–15 บรรทัดต่อ role) สกัดจาก skill ต้นฉบับ เขียนเป็นอังกฤษเหมือน prompt เดิม ผลทั้งหมดลงช่องเดิมของ JSON schema ไม่เพิ่ม/เปลี่ยน schema

| role | ต้นฉบับ | เนื้อหาที่ต้องมี |
|---|---|---|
| PM (`PM_PROMPT`) | tb-brainstorming | ถามทีละข้อ (มีอยู่แล้ว) + ถามหา "ทำไม/ผลลัพธ์ที่ถือว่าสำเร็จ" + ถามหาสิ่งที่ไม่ทำ (ลง `outOfScope`) + เสนอข้อสันนิษฐานให้ผู้ใช้แก้แทนคำถามเปิดเมื่อทำได้ + ไม่ถามสิ่งที่หาเองได้จากโค้ด (อ่านโค้ดก่อน) · งานที่ดูเป็น quick คงกฎเดิม "ถามได้อย่างมาก 1 ข้อ" |
| Planning | tb-writing-plans | task เล็กพอให้ worker ทำจบในรอบเดียว, ระบุไฟล์ที่คาดว่าจะแตะใน description, acceptanceCriteria ต้องตรวจได้ด้วยการรันเทสต์/คำสั่ง, ระบุเทสต์ที่ต้องเขียน, ไม่มีขั้น commit, ตรวจทวน design กับ requirements ก่อนส่ง (ทำเองในหัว ไม่ใช่ subagent) |
| frontend/backend (`workerPrompt`) | tb-test-driven-development | เมื่อโปรเจกต์มีระบบเทสต์: เขียนเทสต์ของ acceptance criteria ก่อน → รันให้เห็นว่า fail ด้วยเหตุผลที่ถูก → เขียนโค้ดน้อยที่สุดให้ผ่าน → รันชุดเทสต์ทั้งหมด · ไม่มีระบบเทสต์: แจ้งใน `summary` ว่าตรวจด้วยวิธีใด · ห้ามแก้เทสต์ให้ผ่านโดยลดเงื่อนไข |
| worker รอบแก้ (`buildWorkFixPrompt` และส่วน previousReport ของ `buildWorkPrompt`) | tb-investigate-error / debug-mantra | ก่อนแก้แต่ละ blocker/major: ทำให้ปัญหาเกิดซ้ำ (รันเทสต์/คำสั่ง) → ไล่ code path ที่พังหาสาเหตุจริง → แก้ที่ต้นเหตุ ไม่ใช่อาการ → ยืนยันด้วยเทสต์ · สรุปสาเหตุที่พบสั้น ๆ ใน `summary` (ไม่ทำรายงานแยก) |
| QA (`QA_PROMPT`) | tb-scrutinize | นอกจากเทียบ acceptance criteria: ตรวจว่าโค้ดทำตาม "เจตนา" ของ task/requirements จริง, ไล่ code path จริงที่เรียกโค้ดใหม่ (ไม่ดูแค่ไฟล์ที่เปลี่ยน), ถ้ามีวิธีที่ง่ายกว่าชัดเจนรายงานเป็น `minor` พร้อมเหตุผล · ทุก issue ต้องมีเหตุผลและ `file` ที่อ้างได้ |
| Security | tb-scrutinize (บางส่วน) | ไล่ data flow จาก input ผู้ใช้ถึงจุดเสี่ยงจริงก่อนรายงาน (กันรายงานลอย ๆ) — เพิ่มสั้น ๆ 1–2 บรรทัด |

เกณฑ์ตรวจรับส่วนที่ 1:
- เทสต์ใน `tests/prompts.test.ts` ยืนยันว่าแต่ละ role มีข้อความวินัยหลัก (เช่น worker มีคำว่า fail ก่อน implement, QA มี intent/code path) และ prompt ไม่มีคำว่า HTML/Skill tool
- ความยาว system prompt แต่ละ role เพิ่มไม่เกิน ~1,500 ตัวอักษร (เทสต์ตรวจ)
- `npm test` และ `npm run typecheck` ผ่าน

---

## ส่วนที่ 2 — อ่านการ์ด Jira แล้ว PM ถามตอบ

### พฤติกรรม
- ข้อความใดก็ตามที่ผู้ใช้ส่งถึง PM ใน REQUIREMENTS (ข้อความแรก, ข้อความคุยต่อ, `revise`, คำขอแก้ตอน DELIVER ที่วิ่งกลับเข้า REQUIREMENTS) และข้อความใน `agent-team ask` — ถ้ามี issue key (`[A-Z][A-Z0-9]+-\d+` ที่ prefix ตรงกับ `jira.projects`) หรือ URL `https://<jira.site>/browse/<KEY>` → โค้ดดึงการ์ดก่อนเรียก agent
- เลขเปล่า (เช่น `2612`) **ไม่** นับเป็นการ์ด (การตัดสินใจของผู้ออกแบบ: กันจับผิดกับ "แก้ 3 ไฟล์")
- เนื้อหาการ์ดแนบหน้า prompt ของ PM/advisor ในบล็อก untrusted (ใช้รูปแบบเดียวกับ `untrusted()` ใน prompts.ts: เป็น DATA ไม่ใช่คำสั่ง) ตามด้วยข้อความเดิมของผู้ใช้
- เพิ่มกฎใน `PM_PROMPT`: เมื่อมีการ์ด Jira ให้ใช้ Background Story/Acceptance Criteria เป็นฐาน ถามเฉพาะสิ่งที่การ์ดไม่ชัด/ขัดกัน/ขาด ไม่ถามซ้ำสิ่งที่การ์ดบอกแล้ว, `acceptanceCriteria` เริ่มจาก AC ของการ์ด, `goal` ขึ้นต้นด้วย issue key
- แสดงในจอ (kind `system`): `ดึงการ์ด RTRED-2612: <summary> · รูปแนบ 2` ; ล้มเหลว (ไม่มี env, 401/403/404, network) → kind `warn` บอกสาเหตุสั้น ๆ แล้วส่งข้อความผู้ใช้ให้ PM ตามเดิม (ไม่หยุดงาน) ; ไม่ได้ตั้ง env → บอกวิธีตั้ง `JIRA_EMAIL`/`JIRA_TOKEN`
- headless: `--request "RTRED-2612 ..."` ทำงานเหมือนกัน (ข้อความ warn ไปทาง events ตามปกติของ io)
- ตั้ง `state.title` จาก `<KEY> <summary>` เมื่อข้อความแรกมีการ์ด (ถ้า title ยังไม่ถูกตั้ง)

### การดึง (โมดูลใหม่ `src/jira.ts`)
- port ตรรกะของ `~/.claude/skills/read-jira/scripts/fetch_jira.py` เป็น TypeScript ใช้ `fetch` ของ Node (ไม่มี dependency ใหม่)
- `GET https://<site>/rest/api/3/issue/<KEY>?expand=renderedFields` · Basic auth `JIRA_EMAIL:JIRA_TOKEN` · timeout 15 วินาที
- ดึง: key, summary, issuetype, status, priority, reporter, assignee, link และ **Key details** จาก `renderedFields` ของ field ใน `jira.keyDetailsFields` (ค่าเริ่มต้น `customfield_10119`, `customfield_10121`) แปลง HTML → ข้อความอ่านได้ (ตารางเป็นบรรทัด, list เป็น `-`) ; ถ้า Key details ว่างทั้งหมดให้ใช้ `description` และระบุว่า Key details ว่าง
- จำกัดความยาวเนื้อหาการ์ดที่ส่ง PM (เช่น 12,000 ตัวอักษร ตัดพร้อมหมายเหตุ)
- รูปแนบ (`fields.attachment` ที่ mimeType `image/*`, สูงสุด 5 รูป, รูปละไม่เกิน 5 MB) ดาวน์โหลดไว้ที่ `.agent-team/jobs/<id>/jira/<KEY>-<n>.<ext>` (ask: `.agent-team/ask/jira/`) แล้วบอก PM ใน prompt ให้เปิดด้วย Read (path relative ต่อโปรเจกต์) — guard อนุญาต Read ใน `.agent-team` อยู่แล้วหรือไม่ต้องตรวจตอนลงมือ ถ้าไม่ ให้เปิดเฉพาะ Read ของ `.agent-team/**/jira/` สำหรับ pm/advisor
- แคชต่องาน: `.agent-team/jobs/<id>/jira/<KEY>.json` การ์ดที่ดึงแล้วในงานเดียวกันไม่ดึงซ้ำ (แนบเนื้อหาเฉพาะครั้งแรกที่การ์ดนั้นถูกพูดถึงใน session ของ PM ครั้งต่อไปบอกแค่ว่า "อ่านแล้ว")
- ห้าม log token / header auth ; log event `jira.fetch` (key, ok, status, attachments) ลง agent-team.log

### Config และ env
- `agent-team.config.json` เพิ่ม `jira`: `{ site: "digital-and-technology.atlassian.net", projects: ["RTRED"], keyDetailsFields: ["customfield_10119","customfield_10121"] }` (ทั้งหมด optional ค่าเริ่มต้นตามนี้) — ปรับ schema ใน `src/config.ts`
- `src/env.ts`: ตัด `JIRA_TOKEN`, `JIRA_EMAIL` ออกจาก `agentEnv()` (ไม่สนตัวพิมพ์บน Windows เหมือน billing vars)

เกณฑ์ตรวจรับส่วนที่ 2:
- เทสต์หน่วยของ `src/jira.ts` ด้วย fetch ปลอม: แยก key จาก URL/ข้อความ, ไม่จับเลขเปล่า, แปลง HTML, ใช้ description เมื่อ Key details ว่าง, 401/404/timeout คืน error ที่อ่านได้, ไม่มี env
- เทสต์ requirements phase: ข้อความมี key → prompt ของ PM มีบล็อกการ์ด; ดึงล้ม → PM ยังได้ข้อความผู้ใช้ + io ได้ warn; การ์ดซ้ำไม่ดึงซ้ำ
- เทสต์ env: `JIRA_TOKEN` ไม่อยู่ใน `agentEnv()`
- README มีหัวข้อ Jira (ตั้ง env อย่างไร, ใช้อย่างไร)

---

## ส่วนที่ 3 — เตือนโควตา subscription + handoff

### สัญญาณ
SDK 0.3.278 ส่ง `SDKRateLimitEvent` (`type: 'rate_limit_event'`, `rate_limit_info: { status: 'allowed'|'allowed_warning'|'rejected', utilization?, resetsAt?, rateLimitType? }`) ใน stream ของ `query()` — `src/runner.ts` (`once`) อ่าน event นี้ log เป็น `quota.event` และส่งต่อให้ตัวติดตามโควตา (`QuotaMonitor`) ที่ใช้ร่วมกันทั้ง run
ยังไม่ได้ยืนยันกับการรันจริงว่า event มาบ่อยแค่ไหนและ `utilization` เป็น 0–1 หรือ 0–100 — โค้ดต้องรับได้ทั้งสองแบบ (ค่า > 1 ถือเป็นเปอร์เซ็นต์) และต้องมีขั้น "ทดลองจริง" ท้ายแผน

### พฤติกรรม
- จุดปลอดภัยอยู่ก่อนการเรียก agent ทุกครั้ง (phases เรียก agent ทีละตัว ไม่ขนานกัน — ตรวจกับโค้ดแล้ว)
- **`allowed_warning`** — ไม่ทำอะไรกลางขั้น จดไว้ใน monitor ; ที่ "จุดปลอดภัย" ถัดไป (ก่อนเรียก agent ครั้งถัดไป — แนะนำทำเป็น wrapper ของ `RoleRunner` ที่เช็ค monitor ก่อนทุก method และ wrapper ของ advisor ใน ask) แสดง:
  `⚠ โควตา 5 ชม. ใช้ไป 85% · รีเซ็ต 16:30` (kind `warn`, เวลาเป็นเวลาท้องถิ่น, ประเภท five_hour/seven_day/... แปลเป็นไทย ไม่มีข้อมูลก็ละส่วนนั้น)
  แล้ว `io.choose('จะทำอย่างไรต่อ?', ['handoff', 'continue'])`
  - `continue` → ทำต่อ และไม่ถามซ้ำจนกว่า `resetsAt` (หรือ `rateLimitType`) จะเปลี่ยน
  - `handoff` → เขียน handoff แล้วหยุดแบบเดียวกับ Ctrl+C (ปลด lock, ไม่แตะ state เพิ่ม, exit code ไม่ใช่ 0) พิมพ์ path ของ handoff และ `agent-team -r`
- **เริ่มใช้ extra usage (เสียเงินจริง)** — ผู้ใช้ตัดสินใจ: นับเป็นสัญญาณเหมือน `allowed_warning` คือเตือนแล้วถาม handoff/continue ที่จุดปลอดภัยถัดไป ตรวจจาก `overageInUse === true` หรือ `rateLimitType === 'overage'` หรือ `overageStatus` เป็น `allowed_warning`/`rejected` ข้อความเตือนต้องบอกชัดว่า "กำลังใช้ extra usage (คิดเงินเพิ่ม)" ; เลือก continue แล้วไม่ถามซ้ำในรอบรันนี้ ; ถ้าเปลี่ยนจากไม่ใช้ → ใช้ ถือเป็นเหตุการณ์ใหม่ (ถามแม้เคยตอบ continue ให้คำเตือนโควตาปกติไปแล้ว)
- **`rejected`** — ไม่ถาม: ยกเลิก agent ที่ค้างอยู่ (SDK จะล้มเองอยู่แล้ว), เขียน handoff, หยุดแบบเดียวกัน แจ้งเวลารีเซ็ต (kind `error`)
- ระหว่างรอผู้ใช้ตอบคำถามอื่นอยู่ ไม่ต้องแทรก — รอถึงจุดปลอดภัยถัดไป
- headless: คำถาม handoff/continue ไปผ่าน `question.json` เหมือนคำถามอื่น ; หยุดเพราะโควตาให้ `exit.json` มีเหตุผล `quota` และ path ของ handoff (เพิ่ม field ใน status JSON ถ้าจำเป็น และอัปเดต `claude-skill/agent-team/SKILL.md` ให้ Claude Code บอกผู้ใช้)
- โหมด `ask`: ใช้ monitor เดียวกัน ; เลือก handoff = ใช้ handoff ของ ask เดิมไม่ได้ (เรียก AI) → เขียน handoff สั้นจากประวัติข้อความที่มี (คำถามล่าสุดของผู้ใช้) หรือแค่บอกให้ `/save` ภายหลัง — ผู้สร้างเลือกทางง่ายสุดที่ไม่เรียก AI

### handoff.md (สร้างด้วยโค้ดจาก state เท่านั้น, โมดูลใหม่ เช่น `src/job-handoff.ts`)
เขียนที่ `.agent-team/jobs/<id>/handoff.md` (เขียนทับทุกครั้ง, atomic tmp+rename เหมือน state) ภาษาไทย markdown ล้วน อ่านจบได้ในตัวเองโดยไม่ต้องรู้จัก agent-team:
1. หัว: ชื่องาน, job id, เหตุที่หยุด (โควตา + เวลารีเซ็ต), เวลาที่เขียน, path โปรเจกต์
2. เป้าหมาย + ระดับงาน + เฟสที่ค้าง
3. Requirements (goal, features, constraints, outOfScope, acceptanceCriteria) — อ้างการ์ด Jira ถ้ามี
4. Design ย่อ (overview, architecture, apiContract, dataModel, securityNotes) — ถ้ามี
5. ตาราง task: id, title, owner, สถานะ (เสร็จ / เสร็จแบบรับตามสภาพ / กำลังทำ รอบ n / ยังไม่เริ่ม), dependsOn
6. ปัญหาค้าง: blocker/major จาก `lastReport` ของ task ที่ยังไม่เสร็จ พร้อม file
7. ไฟล์ที่แก้ไปแล้ว: `git diff --stat` + ไฟล์ใหม่ที่ยังไม่ track (ถ้าเป็น git repo; ไม่ใช่ git ใช้ `touchedFiles`) + หมายเหตุว่ายังไม่ได้ commit
8. วิธีทำต่อ:
   - ด้วย agent-team: `agent-team -r` (หรือ `--job <id>`) หลังโควตารีเซ็ต
   - ด้วย AI ตัวอื่น/คน: ขั้นต่อไปเป็นข้อ ๆ (task ที่ค้างตามลำดับ dependency พร้อม acceptance criteria), คำสั่ง build/test ที่ worker รายงานไว้ใน `howToVerify` ล่าสุด, อ้าง `state.json`/`design.json` เป็นข้อมูลอ้างอิง, ห้ามแก้ไฟล์ใน `.agent-team/` ถ้าจะกลับมาใช้ agent-team ต่อ
- ไม่ใส่ secret (ไม่มีอยู่ใน state อยู่แล้ว; ห้ามดึง env ใด ๆ มาใส่)
- เพิ่ม `logs` view ไม่ต้อง — แค่ log event `quota.handoff` (path, reason)

เกณฑ์ตรวจรับส่วนที่ 3:
- เทสต์ runner: `rate_limit_event` ใน stream ปลอม → monitor ได้ status/utilization/resetsAt
- เทสต์ overage: `overageInUse: true` (แม้ status เป็น `allowed`) → เตือนว่าเสียเงินแล้วถาม ; continue ให้ warning ปกติแล้วยังถามเมื่อเริ่ม overage
- เทสต์ wrapper: warning → ถามก่อนเรียก agent ครั้งถัดไป ไม่ถามกลางการเรียก; `continue` ไม่ถามซ้ำในรอบเดียวกัน, ถามใหม่เมื่อ resetsAt เปลี่ยน; `handoff` เขียนไฟล์และหยุด; `rejected` เขียนไฟล์และหยุดโดยไม่ถาม
- เทสต์ handoff: state ทุกเฟส (REQUIREMENTS ไม่มี design, BUILD มี task ค้างพร้อม lastReport, quick) สร้าง markdown ครบหัวข้อและไม่ล้ม; โปรเจกต์ไม่ใช่ git ไม่ล้ม
- headless: หยุดเพราะโควตาสะท้อนใน exit/status
- README อธิบายพฤติกรรมนี้
- **ทดลองจริง** (ผู้ใช้เป็นคนรัน เพราะใช้โควตาจริง): รันงานเล็กแล้วดู `quota.event` ใน log ว่ามาจริงและค่าเป็นรูปแบบใด

---

## ข้อจำกัดรวม

- TypeScript ตาม style ของ repo (คอมเมนต์ไทย, zod, ไม่มี dependency ใหม่), ข้อความในจอภาษาไทยผ่าน `io.say(text, kind)`
- เทสต์ด้วย vitest และ fakes ใน `tests/helpers/` ห้ามเรียก SDK/Jira จริงในเทสต์
- ไม่ commit ระหว่างทำ ผู้ใช้ตรวจ diff และ commit เอง (ตาม tb-writing-plans)
- ไม่ลบหรือเปลี่ยนพฤติกรรมเดิมที่ไม่เกี่ยว (Ctrl+C, resume, headless protocol เดิมต้องเข้ากันได้ย้อนหลัง)

## สิ่งที่ผู้ออกแบบตัดสินใจเอง (ผู้ใช้ควรตรวจ)

1. วินัยเขียนเป็นอังกฤษใน prompt (เหมือน prompt เดิม) — ภาษาที่ agent คุยกับผู้ใช้ยังเป็นไทย
2. เลขเปล่าไม่นับเป็นการ์ด Jira
3. handoff สร้างด้วยโค้ด ไม่ใช้ AI
4. ใช้เกณฑ์ `allowed_warning` ของ SDK ไม่ตั้งเปอร์เซ็นต์เอง (เพิ่มภายหลังได้ถ้าเตือนช้า)
5. เลือก continue แล้วไม่ถามซ้ำในรอบโควตาเดียวกัน
6. เนื้อหาการ์ด Jira ถือเป็นข้อมูล untrusted (การ์ดเขียนโดยคนอื่น)
7. ข้อความที่ผู้ใช้เพิ่งพิมพ์แต่ยังไม่ถึง PM/advisor ตอนเลือก handoff (หรือโดน rejected) — บันทึกเป็น `state.pendingPrompt` ก่อนหยุด (ผ่อนกฎ "ไม่แตะ state" เฉพาะจุดนี้) และใส่ไว้ใน handoff.md หัวข้อ "ข้อความล่าสุดที่ยังไม่ได้ส่ง" เพื่อให้ `-r` เล่นซ้ำได้และ AI อื่นเห็น
8. headless: ใช้ `ExitStatus` เดิม `stopped` แล้วเพิ่ม field `reason: 'quota'` และ `handoffPath` (driver เก่าที่ไม่รู้จัก field ใหม่ยังเห็นเป็น stopped ตามเดิม) อัปเดต SKILL.md ให้บอกผู้ใช้เมื่อ reason เป็น quota ; exit code ของ headless คงตาม mapping ของ stopped เดิม ; โหมด interactive จบด้วย exit code ไม่ใช่ 0
9. ข้อความเดียวมีหลายการ์ด: ดึงสูงสุด 3 ใบ, title และ prefix ของ goal ใช้ใบแรก, เพดาน 12,000 ตัวอักษรใช้รวมทุกใบ
10. "ไม่ถามซ้ำหลัง continue" จำในหน่วยความจำของรอบรันนี้เท่านั้น (`-r` รอบใหม่ถามใหม่ได้)
11. `git diff --stat` ใน handoff แสดงการเปลี่ยนทั้งหมดของ working tree และเขียนหมายเหตุว่าอาจรวมการแก้ของผู้ใช้ก่อนเริ่มงาน (ใช้ `startTree` เป็นฐานเมื่อมี)

## สิ่งที่ปล่อยให้ผู้สร้างตัดสิน

ชื่อไฟล์/โมดูล, รูปแบบการแปลง HTML→ข้อความ, ตำแหน่งจุดปลอดภัยที่แม่นยำ (wrapper ของ runner แนะนำ แต่ไม่บังคับ), ข้อความในจอที่แน่นอน, วิธีจัดการ handoff ในโหมด ask
