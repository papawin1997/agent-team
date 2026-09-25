# Multi-job resume — design

วันที่: 2026-09-25 · branch: `feat/multi-job-resume`
แก้ตามรีวิว: `docs/check/2026-09-25-multi-job-resume-tb-scrutinize.html` (findings #1–#8)

## เป้าหมาย

ตอนนี้ 1 โปรเจกต์มี state ได้ไฟล์เดียว (`.agent-team/state.json`) ถ้ามีงานค้างแล้วรันโดยไม่ใส่ `--resume` โปรแกรมจะ error
ให้ใช้ `--resume` หรือลบโฟลเดอร์ทิ้ง (`src/orchestrator.ts:17-21`)

ต้องการให้:
- เก็บงานค้างได้หลายงานต่อ 1 โปรเจกต์
- ตอนเริ่มรัน PM แสดงงานค้างทั้งหมดพร้อมสรุปว่าแต่ละงานค้างอะไร แล้วให้ user เลือก: **ทำต่องานไหน / ลบงานค้างงานไหน / เริ่มงานใหม่**

## การตัดสินใจของ user

| # | เรื่อง | เลือก |
|---|---|---|
| 1 | กลับมา resume งาน A หลังจากงาน B แก้โค้ดไปแล้ว | เตือนอย่างเดียว ยังให้ทำต่อได้ |
| 2 | `--resume` เมื่อมีหลายงาน | ทำต่องานค้างที่รันล่าสุดโดยไม่ถาม |
| 3 | ลบงานค้าง | ถามยืนยัน yes/no แล้วลบถาวร จากนั้นแสดงเมนูใหม่ |
| 4 | พิมพ์ถาม PM เป็นข้อความอิสระในเมนู | ไม่มี ใช้สรุปที่ละเอียดพอแทน (ไม่เสียค่า LLM) |

## ส่วนที่ 1: การเก็บข้อมูล

```
<project>/.agent-team/
  agent-team.log                 ← ไฟล์เดียวร่วมกันทุกงาน
  jobs/
    <jobId>/
      state.json
      run.lock                   ← มีเฉพาะตอนที่มี process กำลังใช้งานนี้อยู่ (เก็บ pid)
      requirements.json
      design.json
      reports/<taskId>-round<n>.json
```

- `jobId` = เวลาท้องถิ่นตอนสร้างงาน รูปแบบ `YYYYMMDD-HHmmss` ถ้าชื่อซ้ำกับงานที่มีอยู่แล้ว ให้ต่อท้ายด้วย `-2`, `-3`, ...
  ข้อนี้ไม่ใช้กับ migration (ดูหัวข้อ legacy)
- field ใหม่ใน `State` ทุกตัวไม่บังคับมี จึงยังเป็น `version: 1` ได้
  - `title?: string`: ชื่องาน ได้จากข้อความแรกที่ user พิมพ์ใน REQUIREMENTS (#1)
  - `updatedAt?: string` (ISO 8601): `FileStateStore.save` ตั้ง `updatedAt = now` ทุกครั้ง
  - `lastBuildAt?: string` (ISO 8601): `FileStateStore.save` ตั้ง `lastBuildAt = now` เฉพาะตอน `state.phase === 'BUILD'` (#5)
    เพราะ worker แก้โค้ดได้แค่ในเฟส BUILD และ build.ts save ทุกรอบ QA อยู่แล้ว เลยไม่ต้องแก้ build.ts
  - `now` รับจากภายนอกได้ เพื่อให้เทสต์ได้
  - งานเก่าที่ไม่มี `updatedAt` ให้ใช้ mtime ของ `state.json` แทน
  - ไม่มี `createdAt` เพราะ `jobId` บอกเวลาสร้างอยู่แล้ว (#2)
- งานที่ `phase` เป็น `DONE`/`ABORTED` ยังเก็บโฟลเดอร์ไว้เป็นประวัติ แต่ไม่แสดงในเมนู

### งานเปล่า (#1)

**งานเปล่า** คืองานที่ `phase === 'REQUIREMENTS'` และไม่มีทั้ง `title`, `pmSessionId` และ `requirements`
เช่น user กด `n` แล้ว Ctrl+C ก่อนพิมพ์อะไร

- ไม่แสดงในเมนู ไม่นับตอนคำนวณคำเตือน และ `--resume` ไม่เลือก
- `selectJob` ลบงานเปล่าที่ไม่ได้ถูก lock ทิ้งให้อัตโนมัติก่อนแสดงเมนู

### ตั้งชื่องาน (#1)

`src/phases/requirements.ts` แก้จุดเดียว: หลังจาก `askNonEmpty` ได้ข้อความแรก ถ้า `state.title` ยังไม่มี
ให้ตั้ง `state.title = ข้อความนั้น (ตัดเหลือ 60 ตัวอักษร)` แล้ว `store.save(state)` ทันทีก่อนเรียก PM
ถ้า Ctrl+C ระหว่าง PM ตอบ งานก็ยังมีชื่อ ไม่กลายเป็นงานเปล่า

### คำเตือนว่าโค้ดอาจเปลี่ยน (#5)

งาน X จะขึ้นคำเตือนถ้ามีงานอื่น Y (จะค้างหรือจบแล้วก็ได้) ที่ `Y.lastBuildAt > X.updatedAt`
ข้อความ: `⚠ งาน "<ชื่อ Y>" แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว` ถ้ามีหลายงานให้แสดงงานที่ใหม่สุดพร้อม `และอีก N งาน`

### Lock (#3)

- `jobs/<id>/run.lock` เก็บ pid ของ process ที่ใช้งานนี้อยู่
- เขียน lock ด้วย `fs.writeFile(..., { flag: 'wx' })` ถ้ามีไฟล์อยู่แล้วให้อ่าน pid แล้วเช็กด้วย `process.kill(pid, 0)`
  ถ้า process ยังอยู่ = lock ไม่สำเร็จ ถ้า process ไม่อยู่แล้ว (ESRCH) = lock ค้าง ให้เขียนทับได้ ถ้าเป็น pid ของ process ตัวเองก็ถือว่า lock สำเร็จ
- ได้ lock ตอน `create()` และตอนเลือกงานมาทำต่อ ปล่อย lock (ลบไฟล์) ใน `finally` ของ `index.ts` และใน SIGINT handler
- ในเมนู งานที่ถูก lock โดย process ที่ยังทำงานอยู่ จะแสดง `(กำลังรันอยู่ pid N)` และเลือก `r`/`d` ไม่ได้
  (ถ้าเลือกจะ `io.say` บอกเหตุผลแล้วแสดงเมนูใหม่)
- `--resume` ข้ามงานที่ถูก lock ถ้าไม่เหลืองานที่ว่างให้ throw `งานค้างทั้งหมดกำลังรันอยู่ใน process อื่น`

### ย้ายของเดิมให้อัตโนมัติ (legacy migration) (#4)

ถ้ามี `.agent-team/state.json` หรือ artifact แบบเก่า (`requirements.json`, `design.json`, `reports/`) อยู่ที่ root:
1. id = mtime ของ `state.json` (รูปแบบเดียวกับ jobId) ถ้าไม่มี `state.json` แล้ว (ย้ายไปครึ่งทางในรอบก่อน)
   ให้หาโฟลเดอร์ใน `jobs/` ที่ไม่มี `state.json` แล้วใช้โฟลเดอร์นั้น
2. ถ้า `jobs/<id>/` มีอยู่แล้วแต่ไม่มี `state.json` ให้ใช้โฟลเดอร์นั้นต่อ ไม่ต่อท้าย suffix
   ถ้ามี `state.json` อยู่แล้ว (ชนกับงานอื่นจริง ๆ) ค่อยต่อท้าย `-2`, ...
3. ย้าย artifact ก่อน (`requirements.json`, `design.json`, `reports/` เฉพาะที่มี) และย้าย **`state.json` เป็นอย่างสุดท้าย**
4. ไม่แตะ `agent-team.log`

ทำทุกครั้งตอนเริ่มรัน รันซ้ำได้ผลเดิม (idempotent) ถ้าล้มครึ่งทาง รอบถัดไปจะย้ายต่อจนครบ ถ้าไม่มีไฟล์ legacy ก็ไม่ทำอะไร

### โค้ด

- `src/state.ts`: `FileStateStore(jobDir, now?)` เปลี่ยนมารับ path โฟลเดอร์ของงาน และเพิ่ม field `title`/`updatedAt`/`lastBuildAt` ตามที่อธิบายไว้ด้านบน
  ส่วน interface `StateStore` ไม่เปลี่ยน
- `src/jobs.ts` (ไฟล์ใหม่) มีคลาส `JobRepository(projectDir, opts?: { now?, log? })` (`log` = Logger ไม่บังคับ ใช้บันทึก WARN)
  - `migrateLegacy(): Promise<void>`
  - `list(): Promise<JobInfo[]>` คืนทุกงาน (รวม DONE/ABORTED) โดย
    `JobInfo = { id, state, updatedAt: Date, lockedBy?: number }` (`lockedBy` = pid ที่ยังทำงานอยู่)
    ถ้าเจอโฟลเดอร์ที่ไม่มี `state.json` หรืออ่านไม่ได้ ให้ข้ามไปและบันทึก WARN
  - `create(): Promise<{ id: string; store: FileStateStore }>` สร้างโฟลเดอร์, เขียน lock และเขียน `state.json` เริ่มต้น (`newState()`)
  - `lock(id): Promise<boolean>`, `unlock(id): Promise<void>` (unlock ไม่ throw ถ้าไม่มีไฟล์)
  - `store(id): FileStateStore`
  - `remove(id): Promise<void>` ลบโฟลเดอร์งานแบบ recursive
- `src/phases/requirements.ts`: ตั้ง `title` (จุดเดียว) ส่วน phase อื่นไม่ต้องแก้

## ส่วนที่ 2: flow ตอนเริ่มรัน

ไฟล์ใหม่ `src/job-menu.ts` มีฟังก์ชัน
`selectJob(repo, io, opts: { resume: boolean }): Promise<{ id: string; store: StateStore }>`
งานที่คืนออกมาถูก lock ไว้แล้วเสมอ

1. `repo.migrateLegacy()` → `repo.list()` → ลบงานเปล่าที่ไม่ได้ถูก lock → คัดเฉพาะงานค้าง (phase ไม่ใช่ `DONE`/`ABORTED` และไม่ใช่งานเปล่า)
   แล้วเรียงตาม `updatedAt` ใหม่ไปเก่า
2. **ไม่มีงานค้าง:**
   - ถ้าใส่ `opts.resume` → throw `ไม่พบงานค้างให้ resume` (เปลี่ยนจากเดิมที่จบเงียบ ๆ เมื่อ state เป็น DONE ต้องเขียนไว้ใน README)
   - ถ้าไม่ใส่ → `create()`
3. **ใส่ `opts.resume`:** เลือกงานค้างที่ใหม่สุดซึ่งไม่ได้ถูก lock แล้ว `lock()` และคืนงานนั้นโดยไม่แสดงเมนู (ดูหัวข้อ Lock)
4. **ไม่ใส่ `--resume`:** แสดงเมนูแบบนี้

```
[PM] มีงานค้าง 2 งาน:
  1) "ระบบ todo + login" — เฟส BUILD (สร้างงาน/QA), เสร็จ 2/5 task (กำลังทำ api: QA รอบ 3/5) · รันล่าสุด 2026-09-24 14:10
     ⚠ งาน "หน้า report" แก้โค้ดหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว
  2) "หน้า report" — เฟส REVIEW (รอยืนยัน design) · รันล่าสุด 2026-09-25 09:30 (กำลังรันอยู่ pid 4120)
เลือก: r<เลข> = ทำต่องานนั้น   d<เลข> = ลบงานนั้น   n = เริ่มงานใหม่
>
```

- รับคำตอบด้วย `io.ask` ตัด whitespace และไม่สนตัวพิมพ์เล็ก/ใหญ่ รูปแบบที่รับ: `r<n>`, `d<n>`, `n`, `new` ถ้าเลขอยู่นอกช่วงหรือพิมพ์ไม่ตรงรูปแบบ
  → `io.say('เลือกไม่ถูกต้อง ...')` แล้วแสดงเมนูใหม่ (ไม่ส่งไปให้ LLM)
- `r<n>` → `lock(id)` ถ้าได้ lock ก็คืนงานนั้น ถ้าไม่ได้ให้บอกว่ากำลังรันอยู่แล้วแสดงเมนูใหม่
- `d<n>` → ถ้างานถูก lock ให้บอกว่ากำลังรันอยู่แล้วแสดงเมนูใหม่ ถ้าไม่ถูก lock ให้ถามยืนยันด้วย **`io.ask` ตรง ๆ** (#6)
  `ลบงาน "<ชื่อ>" ถาวรใช่ไหม? (y/n)` รับ `y`/`yes`/`n`/`no` (ตอบอย่างอื่นให้ถามซ้ำ)
  ถ้าตอบ yes ให้ `remove(id)` แล้วกลับไปขั้น 1 (ถ้าลบจนไม่เหลืองานค้างจะเข้าขั้น 2 คือเริ่มงานใหม่) ถ้าตอบ no ให้แสดงเมนูใหม่
- `n` → `create()` งานค้างอื่นยังอยู่ครบ

### สรุปของแต่ละงาน (`formatJobSummary` ใน `src/format.ts`)

- **ชื่องาน:** `requirements.goal` ถ้าไม่มีใช้ `title` (#1) (งานเปล่าไม่ถูกแสดง จึงต้องมีอย่างใดอย่างหนึ่ง)
  ถ้างานเก่าจาก legacy ไม่มีทั้งคู่ ให้ใช้ `(ยังคุย requirements ไม่เสร็จ)`
- **เฟส** แสดงเป็นภาษาไทย: REQUIREMENTS = คุย requirements กับ PM, DESIGN = ออกแบบ, REVIEW = รอยืนยัน design, BUILD = สร้างงาน/QA, DELIVER = รอตรวจรับ
- **ความคืบหน้า** (แสดงเฉพาะเมื่อมี `design`): `เสร็จ X/Y task` และถ้ามี task ที่ยังไม่เสร็จแต่ `rounds > 0` ให้ต่อด้วย `(กำลังทำ <id>: QA รอบ r/max)`
- **รันล่าสุด:** เวลาท้องถิ่น `YYYY-MM-DD HH:mm`
- **สถานะ lock:** `(กำลังรันอยู่ pid N)` เมื่อมี `lockedBy`

### `runTeam` (#2)

- เปลี่ยนเป็น `runTeam(deps): Promise<State>` **ไม่มี flag `resume` แล้ว** ใช้ `state = (await store.load()) ?? newState()`
  เพราะ `selectJob` ยืนยันแล้วว่างานที่เลือกมี state และงานใหม่จะอยู่ในโฟลเดอร์ใหม่เสมอ จึงไม่มีกรณีเริ่มงานใหม่ทับ state เก่าอีก
- ลบการ throw "มีงานค้าง ใช้ --resume" และ "ไม่พบ state ให้ resume (.agent-team/state.json)" (#8)
- log `team.start` เหลือแค่ `{ phase }`
- เทสต์ใน `tests/orchestrator.test.ts` ที่ต้องลบ: `resume โดยไม่มี state -> error`, `เริ่มใหม่ทั้งที่มีงานค้าง -> error บอกให้ใช้ --resume`
  และ `it.each` DONE/ABORTED "ทำความสะอาดข้อมูลเก่า" ส่วนเทสต์อื่นให้เปลี่ยน `runTeam(deps, { resume: ... })` เป็น `runTeam(deps)`

### `src/index.ts` (#7)

- คง log `run.start` ไว้ที่เดิม ส่วน `args.resume` ยังบันทึกไว้เหมือนเดิม
- สร้าง `JobRepository` แล้วเรียก `selectJob` จากนั้นบันทึก event `job.selected { jobId, resume: args.resume }`
- SIGINT handler อ่าน `jobId` จากตัวแปรที่อาจยังไม่มี (optional): ถ้ามีให้ `unlock` แล้วพิมพ์
  `หยุดแล้ว — งาน <jobId> ถูกบันทึกไว้ รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume` ถ้ายังไม่มี (กดตอนอยู่ในเมนู) ให้พิมพ์แค่ `หยุดแล้ว`
- ข้อความตอน error เปลี่ยนเป็น `รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume เพื่อทำต่องานล่าสุด`
- ข้อความตอน ABORTED ให้อ้างถึง `.agent-team/jobs/<id>/`
- `finally` เรียก `unlock(jobId)`

### README (#8)

แก้บรรทัด 13-35 ให้อธิบายเมนู (r/d/n), โครงสร้าง `jobs/<id>/`, lock, ความหมายใหม่ของ `--resume`
(งานล่าสุดที่ไม่ได้ถูก lock และถ้าไม่มีงานค้างจะ error) และการย้ายไฟล์ legacy ให้อัตโนมัติ

## การจัดการ error

- ไฟล์ `state.json` ของงานใดงานหนึ่งเสีย (JSON พัง/version ไม่รองรับ) → ข้ามงานนั้น บันทึก WARN แต่ไม่ทำให้ทั้งเมนูพัง
- ลบงานไม่สำเร็จ → `io.say` บอก error แล้วแสดงเมนูใหม่
- ย้ายไฟล์ legacy ไม่สำเร็จ → throw พร้อมบอก path รอบถัดไปจะย้ายต่อจากเดิมได้ (#4)
- unlock ไม่สำเร็จ → บันทึก WARN แต่ไม่ throw (ถ้า lock ค้าง รอบหน้าจะรู้ได้จาก pid ที่ตายไปแล้ว)

## การทดสอบ (TDD)

- `tests/jobs.test.ts` (ใช้ temp dir จริง): create/list/remove, `updatedAt` ถูกตั้งทุกครั้งที่ save,
  `lastBuildAt` ถูกตั้งเฉพาะตอน phase เป็น BUILD, id ไม่ชนกันเมื่อสร้างในวินาทีเดียวกัน,
  migration ย้ายทั้ง state และ artifact, **ย้ายล้มครึ่งทางแล้วรันใหม่ได้ครบในโฟลเดอร์เดียวกัน**, ไม่มี legacy ก็ไม่ทำอะไร,
  ข้ามงานที่ state เสีย, lock/unlock, lock ค้างจาก pid ที่ตายแล้วเขียนทับได้, lock ของ pid ที่ยังอยู่ทำให้ `lock()` คืน false
- `tests/job-menu.test.ts` (ใช้ `ScriptedIO` + repo ใน temp dir): ไม่มีงานค้างก็เริ่มใหม่เลย / `--resume` เลือกงานล่าสุด /
  `--resume` ข้ามงานที่ถูก lock / `--resume` ตอนไม่มีงาน → error / `r2` / `d1` + `y` → ลบแล้วแสดงเมนูใหม่ / `d1` + `n` /
  ตอบยืนยันผิดรูปแบบแล้วถามซ้ำ / ลบจนหมดแล้วเริ่มใหม่ / พิมพ์ผิดแล้วถามซ้ำ / `r`/`d` งานที่ถูก lock ถูกปฏิเสธ /
  งานเปล่าไม่ขึ้นในเมนูและถูกลบ / คำเตือนขึ้นเฉพาะเมื่องานอื่นมี `lastBuildAt` ใหม่กว่า (การคุยกับ PM อย่างเดียวไม่ทำให้ขึ้นคำเตือน) /
  `n` แล้วงานเก่ายังอยู่
- `tests/format.test.ts`: `formatJobSummary` ครบทุกกรณีของชื่องาน (goal / title / fallback), เฟส, ความคืบหน้า และสถานะ lock
- `tests/phases/requirements.test.ts`: ตั้ง `title` จากข้อความแรกและ save ก่อนเรียก PM, ถ้ามี title อยู่แล้วไม่เขียนทับ
- `tests/state.test.ts`: ปรับให้ตรงกับ constructor ใหม่ + `updatedAt`/`lastBuildAt`
- `tests/orchestrator.test.ts`: ลบ 3 เทสต์ที่ระบุไว้ในหัวข้อ `runTeam` และเปลี่ยนวิธีเรียก
- จบด้วย `npm test` และ `npm run typecheck` ต้องผ่านทั้งหมด

## ไม่ทำ (out of scope)

- พิมพ์ถาม PM เป็นข้อความอิสระในเมนูเลือกงาน
- `--resume <id>`
- ตรวจการเปลี่ยนแปลงของโค้ดด้วย git
- ลบ/เก็บกวาดงานที่ DONE/ABORTED
- lock ข้ามเครื่อง (เช่นโปรเจกต์อยู่บน network drive) เพราะเช็ก pid ได้เฉพาะในเครื่องเดียวกัน
