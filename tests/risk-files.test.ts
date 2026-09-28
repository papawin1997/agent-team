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
});
