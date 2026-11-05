---
name: review-angular
description: >-
  Audit Angular code ก่อน merge — ตรวจหา issue สำคัญและแจ้งผลเป็น Markdown ภาษาไทย
  ครอบคลุม 8 หมวด: Memory Leak, Security, Change Detection, Performance, RxJS,
  TypeScript, Component Design, Module. ใช้ skill นี้ทุกครั้งที่ผู้ใช้พูดว่า
  "review-angular", "ช่วย review Angular", "ตรวจโค้ด Angular", "audit component",
  "เช็กก่อน merge", "review code ก่อน push" หรือ paste Angular code มาแล้วถามว่า
  มีปัญหาอะไรไหม — แม้จะไม่ได้พูดคำว่า review-angular ตรง ๆ ก็ตาม
---

# review-angular — Audit Angular Code

เป้าหมาย: **ไล่หา issue ในโค้ด Angular แล้วรายงานเป็น Markdown ภาษาไทย** ที่อ่านเข้าใจง่าย
อ้างอิง `file:line` ทุกครั้ง และบอกวิธีแก้ที่กระทบน้อยที่สุดสำหรับแต่ละ finding

---

## ลำดับการทำงาน

### 1. รับ input
Input ที่รองรับ:
- path ของไฟล์หรือ folder เช่น `src/app/features/login`
- โค้ดที่ paste มาตรง ๆ

ถ้า input ไม่ชัด ให้ถามก่อน อย่าเดาเอง

### 2. อ่านโค้ดจริง
เปิดอ่านไฟล์จริงจาก workspace ก่อนเสมอ อย่าวิเคราะห์จากความจำ
สำหรับ folder ให้ไล่ไฟล์ `.ts` และ `.html` ทั้งหมดใต้ folder นั้น

### 3. ตรวจทั้ง 8 หมวด

ตรวจโค้ดตาม checklist นี้ทุกหมวด:

#### 🔴 หมวด 1: Memory Leak
- Observable ที่ subscribe แล้วไม่มี unsubscribe (ไม่ใช้ `takeUntil`, `async pipe`, `take(1)`, หรือ `DestroyRef`)
- EventEmitter ที่ลืม remove listener
- `setInterval` / `setTimeout` ที่ไม่ clear ใน `ngOnDestroy`
- Subject / BehaviorSubject ที่ไม่ `complete()` ใน `ngOnDestroy`

#### 🔴 หมวด 2: Security
- `[innerHTML]` ที่รับค่าจาก user input โดยตรงโดยไม่ sanitize
- `bypassSecurityTrustHtml` / `bypassSecurityTrustUrl` ที่รับค่าจาก user input
- interpolation `{{ }}` กับ HTML string (XSS)
- URL จาก user input ที่ไม่ validate (javascript: protocol injection)

#### 🟡 หมวด 3: Change Detection
- Component ที่ใช้ default CD แต่ตรงตามเงื่อนไข OnPush ครบ (input เป็น immutable, ไม่มี side effect ใน template)
- `markForCheck()` หรือ `detectChanges()` ที่เรียกมากเกินจำเป็น
- subscription ใน component ที่อัปเดต state แต่ไม่ trigger CD เมื่อใช้ OnPush

#### 🟡 หมวด 4: Performance
- `*ngFor` ที่ไม่มี `trackBy`
- Method call ใน template เช่น `{{ getFullName() }}` แทนที่จะเป็น property หรือ pipe
- Pipe ที่ไม่ได้ mark เป็น `pure: false` แต่ใช้ side effect
- `*ngIf` / `*ngFor` ซ้อนกันลึกเกิน 3 ชั้นโดยไม่จำเป็น

#### 🟡 หมวด 5: RxJS
- Nested `subscribe` ภายใน `subscribe` อีกอัน (ควรใช้ `switchMap`, `mergeMap`, `concatMap`)
- `switchMap` แทน `concatMap` หรือ `mergeMap` ในที่ที่ order หรือ completion สำคัญ
- `subscribe` ที่ไม่มี error handler
- `Subject` ที่ควรเป็น `BehaviorSubject` หรือ `ReplaySubject`
- `tap` ที่ใช้แทน `map` ผิดวัตถุประสงค์

#### 🔵 หมวด 6: TypeScript
- `any` ที่ใช้โดยไม่จำเป็น (ควรเป็น `unknown` หรือ interface จริง)
- Function parameter / return type ที่ไม่มี type annotation
- `@Input()` ที่ไม่มี type หรือเป็น `any`
- Interface ที่ขาด — ใช้ object literal type inline แทนที่จะ define interface

#### 🔵 หมวด 7: Component Design
- Smart component ที่มี HTTP call ตรง (ควร delegate ผ่าน service)
- Dumb component ที่มี business logic ผสม
- Component ที่ทำหลายเรื่องเกินไป (> 300 บรรทัด หรือ > 5 responsibilities)
- `@Output()` EventEmitter ที่ส่งข้อมูลกลับแล้ว parent ต้อง mutate service state เอง

#### 🔵 หมวด 8: Module / Lazy Loading
- Feature module ที่ load แบบ eager ทั้งที่สามารถ lazy load ได้
- SharedModule ที่ import ทั้ง module ทั้งที่ใช้แค่บางส่วน
- Component ที่ declare ซ้ำใน module มากกว่า 1 แห่ง
- `forRoot()` pattern ที่เรียกซ้ำใน feature module

---

### 4. ออกรายงาน Markdown

จัด output เป็น Markdown ภาษาไทยตาม template นี้:

```
# รายงาน review-angular
**ไฟล์/โฟลเดอร์:** <path>
**วันที่:** <วันที่>

---

### สรุปภาพรวม

- 🔴 Critical (ต้องแก้ก่อน merge): **<จำนวน>** <ชื่อ issue แต่ละข้อคั่นด้วย `, `>
- 🟡 Warning (ควรแก้): **<จำนวน>** <ชื่อ issue แต่ละข้อคั่นด้วย `, `>
- 🔵 Info (ปรับปรุงได้): **<จำนวน>** <ชื่อ issue แต่ละข้อคั่นด้วย `, `>
- ✅ ผ่านทั้งหมด: **<จำนวนหมวดที่ผ่าน>** (<รายชื่อหมวดคั่นด้วย `, `>)

---

## 🔴 Critical

### [C1] <ชื่อ issue>
- **ไฟล์:** `file:line`
- **ปัญหา:** <อธิบายว่าอะไรผิด>
- **ความเสี่ยง:** <อธิบาย impact>
- **วิธีแก้:** <โค้ดตัวอย่างหรือ step แก้ที่กระทบน้อยที่สุด>

---

## 🟡 Warning

### [W1] <ชื่อ issue>
...

---

## 🔵 Info

### [I1] <ชื่อ issue>
...
```

**หมายเหตุสำหรับ "สรุปภาพรวม":**
- ถ้าหมวดใดไม่มี issue ให้แสดง **0** และไม่ต้องแสดงรายชื่อ issue
- หมวดที่นับเป็น ✅ ผ่าน คือหมวดที่ตรวจครบแล้วไม่พบ issue ใด ๆ เลย
- ตัวอย่างที่ถูก:
  ```
  - 🔴 Critical (ต้องแก้ก่อน merge): **0**
  - 🟡 Warning (ควรแก้): **2** Subscription leak ใน valueChanges, subscribe ไม่มี error handler
  - 🔵 Info (ปรับปรุงได้): **1** ขาด return type annotation
  - ✅ ผ่านทั้งหมด: **5** (Security, Change Detection, Performance, RxJS, Module)
  ```

**กฎการจัด severity:**
- 🔴 **Critical** — Memory Leak, Security issue (อาจส่งผลต่อ production หรือ security โดยตรง)
- 🟡 **Warning** — Change Detection, Performance, RxJS (อาจทำให้ระบบช้าหรือ behave ผิด)
- 🔵 **Info** — TypeScript, Component Design, Module (code quality / maintainability)

---

## ขอบเขต

- skill นี้ **วิเคราะห์และรายงาน** เท่านั้น ไม่แก้โค้ดโดยตรง
- ถ้าต้องการแก้ finding ใด ให้แจ้งหลังได้รับรายงานแล้ว จะดำเนินการตาม copilot-instructions
- ถ้าโค้ดสั้นหรือไม่มี issue ให้รายงานสั้น ๆ และระบุ "✅ ไม่พบปัญหา" ได้เลย
- อ้าง `file:line` ทุกครั้ง ห้ามพูดถึง issue แบบลอย ๆ โดยไม่อ้างอิง
