import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatResult, resolveSource, type SyncConfig, syncSkills } from './sync-skills-lib';

// sync skill จาก skill-ai-naja เข้า plugin team (skills/skills/) — ใช้: npm run sync-skills [-- --from <path>]
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_DIR = path.join(ROOT, 'skills');

function argFrom(argv: string[]): string | undefined {
  const i = argv.indexOf('--from');
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(): void {
  const config = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'sync.json'), 'utf8')) as SyncConfig;
  let source = resolveSource({ from: argFrom(process.argv), env: process.env, home: os.homedir() });
  let tmp: string | undefined;
  if (!source) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-ai-naja-'));
    console.log(`ไม่พบต้นทางในเครื่อง กำลัง clone ${config.repo}`);
    execFileSync('git', ['clone', '--depth', '1', config.repo, tmp], { stdio: 'inherit' });
    source = tmp;
  }
  try {
    console.log(`ต้นทาง: ${source}`);
    const result = syncSkills({
      sourceDir: source,
      targetDir: path.join(PLUGIN_DIR, 'skills'),
      manifestFile: path.join(PLUGIN_DIR, 'synced.json'),
      licensesDir: path.join(PLUGIN_DIR, 'licenses'),
      deny: config.deny,
    });
    console.log(formatResult(result));
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (e) {
  console.error('sync-skills ล้มเหลว:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
