---
name: agent-team
description: Drive the local agent-team CLI (PM → Planning → workers → QA → Security) in headless mode. Use when the user asks to have agent-team ("ทีม agent", "ให้ agent-team ทำ") build, fix or continue work in a project, check an agent-team job's status, answer its questions, or stop it. The user stays the decision-maker - relay every question to them and never answer on their behalf.
---

# agent-team (headless)

agent-team เรียกโมเดลที่มีค่าใช้จ่ายทุกครั้งที่รัน เริ่มงานเฉพาะเมื่อผู้ใช้ขอชัดเจน

## เริ่มงาน

1. ยืนยันกับผู้ใช้ก่อน: โฟลเดอร์โปรเจกต์ (absolute path), คำขอ (ข้อความแรกถึง PM) และระดับถ้าผู้ใช้ระบุ (`--quick` / `--full`)
2. รันด้วย Bash tool แบบ `run_in_background: true`:

   agent-team run --headless --project "<path>" --request "<คำขอ>" [--quick|--full]

   ทำต่องานเดิมใช้ `--resume` (งานค้างล่าสุด) หรือ `--job <jobId>` แทน `--request`
   บรรทัดแรกของ output เป็น JSON `{"jobId", "since", "projectDir"}`
3. เรียก wait ครั้งแรก (Bash `timeout: 600000`):

   agent-team wait --project "<path>"

   ถ้ารู้ jobId จาก output แล้วให้ใส่ `--job <jobId> --since <since>` เลย จากนั้นใช้ `--job` และ `--since` ทุกครั้ง

## Loop

    agent-team wait --project "<path>" --job <jobId> --since <lastSeq>

เรียกด้วย Bash `timeout: 600000` เสมอ (wait รอสูงสุด 540 วินาที) จำ `lastSeq` จากผลทุกครั้งแล้วส่งเป็น `--since` ครั้งถัดไป แล้วดู `status`:

- `running`: ยังทำงานอยู่ แจ้งความคืบหน้าสั้น ๆ จาก `phase` / `activity` แล้วเรียก wait ซ้ำ
- `question`:
  1. แสดง `messages` ให้ผู้ใช้ (สรุป requirements / design / ผล QA ที่ต้องใช้ตัดสินใจ ห้ามตัดสาระสำคัญ)
  2. ถาม `question.prompt` กับผู้ใช้ ถ้ามี `question.options` ให้เป็นตัวเลือก (AskUserQuestion) — `kind: choiceOrText` ผู้ใช้พิมพ์ข้อความอิสระเพื่อถาม PM ได้, `kind: text` เป็นข้อความอิสระ, `kind: choice` ต้องเป็นหนึ่งในตัวเลือก
  3. ส่งคำตอบของผู้ใช้ตามจริง:

         agent-team answer --project "<path>" --job <jobId> -- "<คำตอบ>"

  4. เรียก wait ต่อ
- `done`: งานเสร็จ สรุป `messages` ให้ผู้ใช้
- `aborted`: งานถูกยกเลิกตามที่ผู้ใช้เลือก
- `error` / `idle` / `stopped` / `dead`: แจ้ง `message` ถ้าผู้ใช้อยากทำต่อ รัน `agent-team run --headless --project "<path>" --job <jobId>` แบบ background แล้วเข้า loop ใหม่

## กฎ

- ห้ามตอบคำถามแทนผู้ใช้ แม้คำตอบจะดูชัด (เช่น confirm) ผู้ใช้เป็นคนตัดสินทุกจุด
- ห้ามแก้ไฟล์ใน `.agent-team/` เอง ใช้คำสั่ง `answer` / `stop` เท่านั้น
- หยุดงานเมื่อผู้ใช้สั่งเท่านั้น: `agent-team stop --project "<path>" --job <jobId>`
- ห้ามเริ่มงาน headless ซ้อนในโปรเจกต์เดียวกัน
- `answer` exit 1 = คำตอบไม่ถูกส่ง อ่าน stderr แล้วแก้ตามนั้น (เช่นตัวเลือกไม่ถูก หรือ process ไม่ได้รันอยู่)
- ดู log ละเอียดเมื่อมีปัญหา: `agent-team logs "<path>"`
