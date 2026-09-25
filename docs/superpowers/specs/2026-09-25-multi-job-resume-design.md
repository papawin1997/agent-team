# Multi-job resume — design

วันที่: 2026-09-25 · branch: `feat/multi-job-resume`

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
      requirements.json
      design.json
      reports/<taskId>-round<n>.json
```

- `jobId` = เวลาท้องถิ่นตอนสร้างงาน รูปแบบ `YYYYMMDD-HHmmss` ถ้าชื่อซ้ำกับงานที่มีอยู่แล้ว (สร้างในวินาทีเดียวกัน) ให้ต่อท้ายด้วย `-2`, `-3`, ...
- `State` เพิ่ม `createdAt?: string` และ `updatedAt?: string` (ISO 8601) ไม่บังคับมี จึงยังเป็น `version: 1`
  - `FileStateStore.save` ตั้ง `updatedAt = now` ก่อนเขียนไฟล์ทุกครั้ง (รับ clock จากภายนอกได้ เพื่อให้เทสต์ได้)
  - `JobRepository.create` ตั้ง `createdAt` ตอนสร้าง
  - งานเก่าที่ไม่มี `updatedAt` ให้ใช้เวลาแก้ไข (mtime) ของ `state.json` แทน
- งานที่ `phase` เป็น `DONE`/`ABORTED` ยังเก็บโฟลเดอร์ไว้เป็นประวัติ แต่ไม่แสดงในเมนู
- **คำเตือนว่าโค้ดอาจเปลี่ยน:** งาน X จะถูกเตือนถ้ามีงานอื่น (จะค้างหรือจบแล้วก็ได้) ที่ `updatedAt` ใหม่กว่า X
  ข้อความ: `⚠ มีงานอื่นรันหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว`

### ย้ายของเดิมให้อัตโนมัติ (legacy migration)

ถ้ามี `.agent-team/state.json` อยู่:
1. สร้าง `jobs/<id>/` โดยใช้ id จาก mtime ของ `state.json`
2. ย้าย `state.json`, `requirements.json`, `design.json`, `reports/` (เฉพาะที่มีอยู่) เข้าไป
3. ไม่แตะ `agent-team.log`

ทำทุกครั้งตอนเริ่มรัน ถ้าไม่มีไฟล์ legacy ก็ไม่ทำอะไร

### โค้ด

- `src/state.ts`: `FileStateStore(jobDir, now?)` เปลี่ยนมารับ path โฟลเดอร์ของงาน ส่วน interface `StateStore` ไม่เปลี่ยน
- `src/jobs.ts` (ไฟล์ใหม่) มีคลาส `JobRepository(projectDir, opts?: { now?, log? })` (`log` = Logger ไม่บังคับ ใช้บันทึก WARN)
  - `migrateLegacy(): Promise<void>`
  - `list(): Promise<JobInfo[]>` คืนทุกงาน (รวม DONE/ABORTED) โดย `JobInfo = { id, state, updatedAt: Date }`
    ถ้าเจอโฟลเดอร์ที่ไม่มี `state.json` หรืออ่านไม่ได้ ให้ข้ามไปและบันทึก WARN ใน log
  - `create(): Promise<{ id: string; store: FileStateStore }>` สร้างโฟลเดอร์ + `state.json` เริ่มต้น (`newState()` + `createdAt`)
  - `store(id): FileStateStore`
  - `remove(id): Promise<void>` ลบโฟลเดอร์งานแบบ recursive
- phase ทั้งหมด (`src/phases/*`) ไม่ต้องแก้

## ส่วนที่ 2: flow ตอนเริ่มรัน

ไฟล์ใหม่ `src/job-menu.ts` มีฟังก์ชัน
`selectJob(repo, io, opts: { resume: boolean }): Promise<{ id: string; store: StateStore; resume: boolean }>`

1. `repo.migrateLegacy()` แล้วเรียก `repo.list()` คัดเฉพาะงานค้าง (phase ไม่ใช่ `DONE`/`ABORTED`) เรียงตาม `updatedAt` ใหม่ไปเก่า
2. **ไม่มีงานค้าง:**
   - ถ้าใส่ `opts.resume` → throw `ไม่พบงานค้างให้ resume`
   - ถ้าไม่ใส่ → `create()` แล้วคืน `resume: false`
3. **ใส่ `opts.resume`:** คืนงานค้างที่ใหม่สุด พร้อม `resume: true` ไม่แสดงเมนู
4. **ไม่ใส่ `--resume`:** แสดงเมนูแบบนี้

```
[PM] มีงานค้าง 2 งาน:
  1) "ระบบ todo + login" — เฟส BUILD (สร้างงาน/QA), เสร็จ 2/5 task (กำลังทำ api: QA รอบ 3/5) · รันล่าสุด 2026-09-24 14:10
     ⚠ มีงานอื่นรันหลังจากงานนี้ โค้ดอาจเปลี่ยนไปแล้ว
  2) "หน้า report" — เฟส REVIEW (รอยืนยัน design) · รันล่าสุด 2026-09-25 09:30
เลือก: r<เลข> = ทำต่องานนั้น   d<เลข> = ลบงานนั้น   n = เริ่มงานใหม่
>
```

- รับคำตอบด้วย `io.ask` ตัด whitespace และไม่สนตัวพิมพ์เล็ก/ใหญ่ รูปแบบที่รับ: `r<n>`, `d<n>`, `n`, `new` ถ้าเลขอยู่นอกช่วงหรือพิมพ์ไม่ตรงรูปแบบ
  → `io.say('เลือกไม่ถูกต้อง ...')` แล้วแสดงเมนูใหม่ (ไม่ส่งไปให้ LLM)
- `r<n>` → คืนงานนั้นพร้อม `resume: true`
- `d<n>` → `io.choose('ลบงาน "<ชื่อ>" ถาวรใช่ไหม?', ['yes','no'])`: ถ้าตอบ yes ให้ `remove(id)` จากนั้นกลับไปขั้น 1 (ถ้าลบจนไม่เหลืองานค้างจะเข้าขั้น 2 คือเริ่มงานใหม่) ถ้าตอบ no ให้แสดงเมนูใหม่
- `n` → `create()` แล้วคืน `resume: false` งานค้างอื่นยังอยู่ครบ

### สรุปของแต่ละงาน (`formatJobSummary` ใน `src/format.ts`)

- **ชื่องาน:** `requirements.goal` ถ้ายังไม่มี ใช้ `pendingPrompt` (ตัดให้เหลือ 60 ตัวอักษร) ถ้าไม่มีทั้งคู่ใช้ `(ยังคุย requirements ไม่เสร็จ)`
- **เฟส** แสดงเป็นภาษาไทย: REQUIREMENTS = คุย requirements กับ PM, DESIGN = ออกแบบ, REVIEW = รอยืนยัน design, BUILD = สร้างงาน/QA, DELIVER = รอตรวจรับ
- **ความคืบหน้า** (แสดงเฉพาะเมื่อมี `design`): `เสร็จ X/Y task` และถ้ามี task ที่ยังไม่เสร็จแต่ `rounds > 0` ให้ต่อด้วย `(กำลังทำ <id>: QA รอบ r/max)`
- **รันล่าสุด:** เวลาท้องถิ่น `YYYY-MM-DD HH:mm`

### การเปลี่ยนแปลงอื่น

- `src/orchestrator.ts` `runTeam(deps, { resume })`:
  - `resume: true` → `load()` ถ้าไม่มี state จะ throw เหมือนเดิม
  - `resume: false` → ใช้ state ที่ `create()` เขียนไว้ ถ้าไม่มีให้สร้าง `newState()`
  - **ลบ** การ throw "มีงานค้าง ใช้ --resume" ออก
- `src/index.ts`: ใช้ `JobRepository` + `selectJob` แล้วใส่ `jobId` ใน log `run.start` และแก้ข้อความ Ctrl+C / error เป็น
  `รันใหม่แล้วเลือกงานนี้จากเมนู หรือใช้ --resume เพื่อทำต่องานล่าสุด`
  ข้อความตอน ABORTED เปลี่ยนให้อ้างถึง `.agent-team/jobs/<id>/`
- README: อธิบายเมนู, โครงสร้าง `jobs/` และความหมายใหม่ของ `--resume`

## การจัดการ error

- ไฟล์ `state.json` ของงานใดงานหนึ่งเสีย (JSON พัง/version ไม่รองรับ) → ข้ามงานนั้น บันทึก WARN แต่ไม่ทำให้ทั้งเมนูพัง
- ลบงานไม่สำเร็จ → `io.say` บอก error แล้วแสดงเมนูใหม่
- ย้ายไฟล์ legacy ไม่สำเร็จ → throw พร้อมบอก path (ไม่พยายามทำต่อเพื่อไม่ให้ state ปนกัน)

## การทดสอบ (TDD)

- `tests/jobs.test.ts` (ใช้ temp dir จริง): create/list/remove, `updatedAt` ถูกตั้งตอน save, id ไม่ชนกันเมื่อสร้างในวินาทีเดียวกัน,
  migration ย้ายทั้ง state และ artifact, ไม่มี legacy ก็ไม่ทำอะไร, ข้ามงานที่ state เสีย
- `tests/job-menu.test.ts` (ใช้ `ScriptedIO` + repo ใน temp dir): ไม่มีงานค้างก็เริ่มใหม่เลย / `--resume` เลือกงานล่าสุด /
  `--resume` ตอนไม่มีงาน → error / `r2` / `d1` + yes → ลบแล้วแสดงเมนูใหม่ / `d1` + no / ลบจนหมดแล้วเริ่มใหม่ / พิมพ์ผิดแล้วถามซ้ำ /
  คำเตือนโค้ดอาจเปลี่ยน / `n` แล้วงานเก่ายังอยู่
- `tests/format.test.ts`: `formatJobSummary` ครบทุกกรณีของชื่องาน, เฟส และความคืบหน้า
- `tests/state.test.ts`: ปรับให้ตรงกับ constructor ใหม่ + ตั้งค่า `updatedAt`
- `tests/orchestrator.test.ts`: แก้เทสต์เดิมที่ error ให้ใช้ `--resume`
- จบด้วย `npm test` และ `npm run typecheck` ต้องผ่านทั้งหมด

## ไม่ทำ (out of scope)

- พิมพ์ถาม PM เป็นข้อความอิสระในเมนูเลือกงาน
- `--resume <id>`
- ตรวจการเปลี่ยนแปลงของโค้ดด้วย git
- ลบ/เก็บกวาดงานที่ DONE/ABORTED
