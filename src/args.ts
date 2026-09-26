import * as path from 'node:path';

export interface CliArgs {
  /** undefined = ให้เลือกจากเมนูโปรเจกต์ */
  projectDir: string | undefined;
  resume: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  let projectDir: string | undefined;
  let resume = false;
  const setProject = (value: string): void => {
    if (projectDir !== undefined) throw new Error('ระบุโปรเจกต์ได้ครั้งเดียว');
    projectDir = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--resume' || arg === '-r') resume = true;
    else if (arg === '--project') {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('-')) throw new Error('ต้องระบุพาธหลัง --project');
      setProject(value);
    } else if (arg.startsWith('--project=')) {
      const value = arg.slice('--project='.length);
      if (value === '') throw new Error('ต้องระบุพาธหลัง --project');
      setProject(value);
    } else if (arg.startsWith('-')) throw new Error(`อาร์กิวเมนต์ไม่รู้จัก: ${arg}`);
    else setProject(arg);
  }
  return { projectDir: projectDir === undefined ? undefined : path.resolve(projectDir), resume };
}
