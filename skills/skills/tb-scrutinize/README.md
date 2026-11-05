# tb-scrutinize

review plan / PR / code change จากมุมมองคนนอก — ตั้งคำถามว่า "ควรมีสิ่งนี้ไหม / มีวิธีง่ายกว่าไหม"
แล้ว trace code path จริงเพื่อยืนยันว่าทำได้ตามที่อ้าง end-to-end

> **ที่มา:** ref มาจาก **9arm**

## ทำอะไร

- มองแบบคนนอก ลืมว่าใครเขียน อ่าน artifact จากศูนย์
- ตั้งคำถาม intent + เสนอทางที่ง่าย/เล็ก/elegant กว่า ก่อน review ทีละบรรทัด
- เดิน code path จริง (ไม่ใช่แค่ diff) → ออก finding เรียงตาม severity + verdict
- บันทึก **HTML report** ไป `docs/check/` (ในโปรเจกต์) แล้วเปิดอัตโนมัติ

## Trigger เมื่อไหร่

- พิมพ์ `/tb-scrutinize`
- ขอ review / audit / sanity-check / second opinion ของ plan, PR, diff, design doc, โค้ดที่จะเปลี่ยน

## ติดตั้ง

ติดตั้งผ่าน `install.ps1` / `install.sh` ที่ root ของ repo `ai-skills` (ดู [README หลัก](../README.md)) ซึ่งติดตั้งทุก skill พร้อมกัน skill ที่อ้างถึงกันจึงหากันเจอ

## Requirements

- GitHub Copilot (VS Code)
