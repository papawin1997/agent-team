#!/usr/bin/env node
// entry ของคำสั่ง global `agent-team`: รันซอร์ส TypeScript ผ่าน tsx โดยไม่ต้อง build
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

// ปักหมุด tsconfig ของแพ็กเกจนี้เอง กัน tsx หยิบ tsconfig.json ของโปรเจกต์ผู้ใช้ใน cwd ไปใช้ผิด ๆ
register({ tsconfig: fileURLToPath(new URL('../tsconfig.json', import.meta.url)) });
await import('../src/index.ts');
