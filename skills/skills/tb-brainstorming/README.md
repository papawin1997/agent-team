# tb-brainstorming

แปลงไอเดียให้กลายเป็น design/spec ที่สมบูรณ์ผ่านบทสนทนาแบบ collaborative — ก่อนเริ่มเขียนโค้ด

> **ที่มา:** custom / ดัดแปลงมาจาก official **superpowers** brainstorming skill

## ทำอะไร

- เข้าใจ context ของ project ก่อน แล้วถามทีละคำถามเพื่อรีไฟน์ไอเดีย
- เสนอ design และ **ขอ approval ก่อนลงมือ implement เสมอ** (HARD-GATE)
- มี visual companion (เปิด local server แสดงภาพประกอบ) ผ่าน `scripts/`

## Trigger เมื่อไหร่

ก่อนงาน creative ใด ๆ — สร้าง feature / component / เพิ่ม functionality / แก้พฤติกรรมระบบ
หรือเมื่อผู้ใช้พูดว่า "อยากทำ X", "ช่วยออกแบบหน่อย", "brainstorm"

## ติดตั้ง

ติดตั้งผ่าน `install.ps1` / `install.sh` ที่ root ของ repo `ai-skills` (ดู [README หลัก](../README.md)) ซึ่งติดตั้งทุก skill พร้อมกัน skill ที่อ้างถึงกันจึงหากันเจอ

## Requirements

- GitHub Copilot (VS Code)
- Node.js (สำหรับ visual companion server — optional)
