import { describe, expect, it } from 'vitest';
import { riskyFiles } from '../src/risk-files';

describe('riskyFiles', () => {
  it.each([
    ['src/auth/login.ts', 'auth'],
    ['src/middleware/session.ts', 'auth'],
    ['server/permissions.py', 'auth'],
    ['.env', 'secret'],
    ['.env.production', 'secret'],
    ['config/credentials.json', 'secret'],
    ['certs/server.pem', 'secret'],
    ['src/payment/stripe.ts', 'payment'],
    ['app/billing/invoice.rb', 'payment'],
    ['db/migrations/0003_add_users.sql', 'migration'],
    ['prisma/schema.prisma', 'migration'],
    ['queries/report.sql', 'migration'],
    ['src/routes/upload.ts', 'upload'],
    ['src/webhooks/github.ts', 'network'],
    ['src/cors.ts', 'network'],
    ['Dockerfile', 'infra'],
    ['docker-compose.prod.yml', 'infra'],
    ['.github/workflows/ci.yml', 'infra'],
    ['package.json', 'dependency'],
    ['backend/requirements.txt', 'dependency'],
    ['go.mod', 'dependency'],
  ])('%s → %s', (file, category) => {
    expect(riskyFiles([file])).toEqual([{ file, category }]);
  });

  it.each([
    'src/components/Button.tsx',
    'src/pages/about.tsx',
    'README.md',
    'src/utils/format-date.ts',
    'src/keyboard/shortcuts.ts',
    'src/author/profile.tsx',
  ])('%s → ไม่เสี่ยง', (file) => {
    expect(riskyFiles([file])).toEqual([]);
  });

  it('ไม่นับไฟล์เทสต์', () => {
    expect(riskyFiles(['tests/auth.test.ts', 'src/auth/login.spec.ts', '__tests__/payment.ts'])).toEqual([]);
  });

  it('แปลง path แบบ Windows, ไม่ซ้ำ, คงลำดับ', () => {
    expect(riskyFiles(['src\\auth\\login.ts', 'README.md', 'src/auth/login.ts', 'package.json'])).toEqual([
      { file: 'src/auth/login.ts', category: 'auth' },
      { file: 'package.json', category: 'dependency' },
    ]);
  });

  describe('M5: absolute path ทำเป็น relative กับ projectDir ก่อนตรวจ', () => {
    const projectDir = 'C:\\Users\\dev\\tests\\myproj';
    const file = 'C:\\Users\\dev\\tests\\myproj\\src\\auth\\login.ts';

    it('ไม่ส่ง projectDir: path เต็มมี "\\tests\\" จากชื่อโฟลเดอร์นอกโปรเจกต์ ถูกเข้าใจผิดว่าเป็นไฟล์เทสต์ ไม่นับเป็นเสี่ยง', () => {
      expect(riskyFiles([file])).toEqual([]);
    });

    it('ส่ง projectDir: ตัดเหลือ path relative จริงในโปรเจกต์ (src/auth/login.ts) ไม่ใช่ไฟล์เทสต์ ตรวจเจอ auth', () => {
      expect(riskyFiles([file], projectDir)).toEqual([{ file: 'src/auth/login.ts', category: 'auth' }]);
    });

    it('path ที่ไม่ absolute ไม่ถูกแตะแม้ส่ง projectDir มาด้วย', () => {
      expect(riskyFiles(['src/auth/login.ts'], projectDir)).toEqual([{ file: 'src/auth/login.ts', category: 'auth' }]);
    });
  });
});
