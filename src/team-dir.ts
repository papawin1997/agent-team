import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * สร้าง <project>/.agent-team พร้อม .gitignore (`*`) ให้ git ของโปรเจกต์มองไม่เห็น log/state
 * ไม่ต้องแก้ .gitignore ของผู้ใช้ และไม่เขียนทับถ้ามีไฟล์อยู่แล้ว (ผู้ใช้อาจแก้เอง)
 */
export function ensureTeamDir(projectDir: string): string {
  const dir = path.join(projectDir, '.agent-team');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return dir;
}
