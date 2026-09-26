#!/usr/bin/env node
// entry ของคำสั่ง global `agent-team`: รันซอร์ส TypeScript ผ่าน tsx โดยไม่ต้อง build
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
