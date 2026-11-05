---
name: gen-subtasks
description: >-
  แตก Jira story card เป็น sub-tasks พร้อม template มาตรฐาน (📁📥📤🔁🧪🎯) สำหรับ copy
  ไปวางใน board. รองรับ 2 input: (1) Jira key เช่น RTRPMS-1920 → ดึงข้อมูลจาก Jira อัตโนมัติ
  (2) paste story text มาตรง ๆ. แตก layer อัตโนมัติตามความซับซ้อน: CRUD ครบ →
  [handler]+[service]+[repo], business เยอะ → [service] เดียว, กลาง → [service+repo] หรือ
  [handler+service]. Infer Input/Output จาก path param / query param / request body / JSON
  ที่ระบุใน story. Formalize ภาษาให้เป็นทางการ (สร้าง → Create, ดึง → Get, แก้ไข → Update,
  ลบ → Delete) พร้อม function name แบบ PascalCase. ใช้ skill นี้ทุกครั้งที่ผู้ใช้พูดว่า
  "แตก subtask", "แตก card", "gen subtask", "plan story", "ช่วยแตกงาน", หรือส่ง Jira key
  พร้อมขอให้แตกงาน. Skip เมื่อผู้ใช้ขอแค่อ่าน Jira card โดยไม่ต้องการแตก task.
---

# Gen Sub-tasks จาก Story Card

แตก Story card เป็น sub-tasks พร้อม template มาตรฐาน — พร้อม copy ไปวางใน Miro / Jira

## ขั้นตอนที่ 1: รับและอ่าน Input

**รูปแบบที่รองรับ:**

**กรณี A — Jira key (เช่น `RTRPMS-1920`):**
ให้ invoke skill `read-jira` ด้วย key นั้นก่อนเลย แล้วใช้ข้อมูลที่ได้ (Key details + attachments)
เป็น source ของ story — ไม่ต้องถามซ้ำ

**กรณี B — Paste story text:**
ใช้ข้อมูลที่ผู้ใช้ paste มาโดยตรง

หลังได้ข้อมูลแล้ว ให้สรุปความเข้าใจก่อน 1 ย่อหน้า:
- Feature นี้ทำอะไร
- Layer ที่จะแตก (จากขั้นตอนที่ 2)
- จำนวน sub-tasks ที่จะสร้าง

แล้วรอการยืนยันจากผู้ใช้ก่อนออก sub-tasks — เพราะถ้าเข้าใจ scope ผิดจะเสียเวลาแก้ทั้งหมด

---

## ขั้นตอนที่ 2: ตัดสินใจ Layer

วิเคราะห์ story แล้วเลือก pattern ที่เหมาะสมที่สุด:

### Pattern A — Full CRUD `[handler] + [service] + [repo]`
ใช้เมื่อ:
- งานเป็น endpoint ใหม่ที่ต้องรับ request → process → query DB → return response
- มีทั้ง input validation, business mapping, และ DB interaction
- ตัวอย่าง: สร้าง API ดึงรายการ, บันทึก, แก้ไข, ลบ record

### Pattern B — Service + Repo `[service] + [repo]`
ใช้เมื่อ:
- มี handler อยู่แล้ว แต่ยังขาด logic และ query
- งานเป็น internal function ที่ service อื่น call
- ตัวอย่าง: เพิ่ม use case ใหม่ให้ endpoint เดิม

### Pattern C — Handler + Service `[handler] + [service]`
ใช้เมื่อ:
- มี repo / DB query อยู่แล้ว แต่ยังขาด endpoint และ business logic
- ตัวอย่าง: expose API ใหม่จาก data ที่มีอยู่

### Pattern D — Service เดียว `[service]`
ใช้เมื่อ:
- Business logic ซับซ้อน, ไม่มี DB ใหม่, ไม่มี endpoint ใหม่
- เป็นการ refactor หรือเพิ่ม calculation/rule
- ตัวอย่าง: เพิ่มกฎการคำนวณ, เพิ่ม validation flow

### Pattern E — มี Database task ด้วย
เพิ่ม `[database]` task ต่อเนื่องก่อน Backend tasks เมื่อ:
- ต้องสร้าง / แก้ตาราง (DDL)
- เพิ่ม Migration script
- INSERT / UPDATE seed / master data
- เพิ่ม Stored Procedure, View, Index

---

## ขั้นตอนที่ 3: Infer Input และ Output

ถ้า story ไม่ได้ระบุ Input/Output ชัดเจน ให้ infer จากข้อมูลต่อไปนี้ตามลำดับ:

### Path Parameter
```
GET /api/goal-assignment/:goalAssID
→ Input: goalAssID int
```

### Query Parameter
```
GET /api/employees?page=1&limit=10&departmentID=3
→ Input: page int, limit int, departmentID int
```

### Request Body (JSON)
```json
{ "goalAssID": 1, "employeeID": "E001", "weight": 0.5 }
→ Input: models.CreateGoalAssignRequest
   (สร้าง struct ตามชื่อ endpoint + "Request")
```

### Response (JSON หรือ existing model)
```
→ Output: models.ResultGetGoalAssignEmp, error
```

**กฎการตั้งชื่อ:**
- Input model: ชื่อ PascalCase + suffix `Request` เช่น `CreateGoalAssignRequest`
- Output model: ขึ้นต้นด้วย `Result` + ชื่อ function เช่น `ResultGetGoalAssignEmp`
- ถ้า infer ไม่ได้จริง ๆ ให้ใส่ `- [ต้องการข้อมูลเพิ่มเติม]`

---

## ขั้นตอนที่ 4: Formalize ภาษา

แปลงคำอธิบายใน story ให้เป็นทางการ:

| คำใน story | ความหมาย | Function name |
|---|---|---|
| สร้าง, เพิ่ม, บันทึก | Create | `CreateXxx` |
| ดึง, ดู, แสดง, get | Get / List | `GetXxx` / `ListXxx` |
| แก้ไข, อัปเดต, เปลี่ยน | Update | `UpdateXxx` |
| ลบ, remove | Delete | `DeleteXxx` |
| ตรวจสอบ, check, validate | Validate | `ValidateXxx` |
| คำนวณ | Calculate | `CalculateXxx` |

**Module path** — ถอดจากชื่อ feature:
```
goal assignment → pkg\admin\goalassignment\
employee       → pkg\admin\employee\
pm form        → pkg\admin\pmform\
```

---

## ขั้นตอนที่ 5: สร้าง Sub-tasks

สร้าง sub-tasks ทีละ layer ตามลำดับ: database (ถ้ามี) → repo → service → handler

**Numbering:** `[TicketKey]-1`, `[TicketKey]-2`, ... ต่อเนื่อง

---

### Template: Database Task

```
[TicketKey]-N [database] <ชื่อสั้น>
📁 file: -
📥 Input: -
📤 Output: -
🔁 Flow: -
🧪 Unit: -
🎯 Objective:
- <ระบุ SQL/Migration/Stored Proc ที่ต้องทำ>
- ระบุ environment: DEV / UAT
```

---

### Template: Repo Task

```
[TicketKey]-N [repo] <Verb><FunctionName>
📁 file: pkg\<module>\repositories\repository.go
📥 Input: <params>
📤 Output: <model>, error
🔁 Flow: -
🧪 Unit: unit test & mockery
🎯 Objective:
- <GORM query / SQL ที่ต้องเขียน เช่น SELECT จาก table X WHERE condition Y>
- return <OutputModel>
```

---

### Template: Service Task

```
[TicketKey]-N [service] <Verb><FunctionName>
📁 file: pkg\<module>\services\service.go
📥 Input: <params>
📤 Output: <model>, error
🔁 Flow: -
🧪 Unit: unit test & mockery
🎯 Objective:
- create <OutputModel>
- call repo <RepoFunctionName>
- <business logic ถ้ามี>
- return <OutputModel>
```

---

### Template: Handler Task

```
[TicketKey]-N [handler] <Verb><FunctionName>
📁 file: pkg\<module>\handlers\handler.go
📥 Input: <path param / query param / body model>
📤 Output: <HTTP response model>
🔁 Flow: <METHOD> /api/<path>
🧪 Unit: unit test & mockery
📘 Swagger: เพิ่ม API documentation & endpoint test
🎯 Objective:
- รับ <input source: path/query/body>
- convert → <InputModel>
- call service <ServiceFunctionName>
- return <[GET/POST/PUT/DELETE] /path>
```

---

## ขั้นตอนที่ 6: ตรวจสอบก่อน output

ก่อน print ผลลัพธ์ ตรวจสอบทุก sub-task:

- [ ] Ticket key + numbering ถูกต้อง (`[Key]-1`, `[Key]-2`, ...)
- [ ] `📁 file` path ถูก format เป็น `pkg\module\layer\file.go`
- [ ] `📥 Input` ระบุ type ชัดเจน ไม่ใช่แค่ชื่อตัวแปร
- [ ] `📤 Output` มี `, error` ต่อท้ายเสมอ (Go convention)
- [ ] ทุกช่องที่ infer ไม่ได้ใส่ `- [ต้องการข้อมูลเพิ่มเติม]`
- [ ] `🎯 Objective` อธิบายเป็น bullet action ชัดเจน ไม่ใช่ copy story มาวาง

## ขอบเขต

- Skill นี้สร้างเฉพาะ **Database และ Backend (Go)** task เท่านั้น
- ถ้า story มีงาน Frontend หรือ DevOps ให้ระบุท้ายผลลัพธ์ว่า:
  `⚠️ งานส่วน [Frontend/DevOps] ไม่ถูกรวมในการแตก sub-task นี้`
- Output เป็น plain text พร้อม copy — ไม่ต้องสร้าง Jira ticket อัตโนมัติ
