import * as path from 'node:path';

export interface CliArgs {
  projectDir: string;
  resume: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  let projectDir: string | undefined;
  let resume = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--resume') resume = true;
    else if (arg === '--project') projectDir = argv[++i];
    else if (arg.startsWith('--project=')) projectDir = arg.slice('--project='.length);
    else throw new Error(`อาร์กิวเมนต์ไม่รู้จัก: ${arg}`);
  }
  if (!projectDir) throw new Error('ต้องระบุ --project <โฟลเดอร์โปรเจกต์>');
  return { projectDir: path.resolve(projectDir), resume };
}
