import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { runLogsCommand } from '../../src/logview/command';
import type { ViewData } from '../../src/logview/view-data';

const LOG = '2026-01-10T09:00:00.000Z INFO  run.start {"projectDir":"/work/app","resume":false,"pid":1}\n';
let project: string;
let said: string[];
let opened: string[];

const deps = () => ({
  say: (t: string) => {
    said.push(t);
  },
  open: (t: string) => {
    opened.push(t);
  },
  env: { CLAUDE_CONFIG_DIR: path.join(project, 'cfg') },
  home: project,
});
const logFile = () => path.join(project, '.agent-team', 'agent-team.log');
const writeLog = async () => {
  await fs.mkdir(path.join(project, '.agent-team'), { recursive: true });
  await fs.writeFile(logFile(), LOG);
};

beforeEach(async () => {
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-logs-'));
  said = [];
  opened = [];
});

describe('runLogsCommand', () => {
  it('ยังไม่มี log -> error ที่บอก path', async () => {
    await expect(runLogsCommand(project, false, deps())).rejects.toThrow('ไม่พบ log');
  });

  it('แบบไฟล์: เขียน .agent-team/logs.html แล้วเปิดเบราว์เซอร์', async () => {
    await writeLog();
    expect(await runLogsCommand(project, false, deps())).toBeUndefined();
    const out = path.join(project, '.agent-team', 'logs.html');
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf8')).toContain('window.__LIVE__ = false');
    expect(opened).toEqual([out]);
    expect(said.join('\n')).toContain(out);
  });

  it('แบบ live: เปิด server และเปิด url, /data อ่าน log ล่าสุดทุกครั้ง', async () => {
    await writeLog();
    const server = await runLogsCommand(project, true, deps());
    try {
      expect(opened).toEqual([server!.url]);
      expect(said.join('\n')).toContain(server!.url);
      const first = (await (await fetch(`${server!.url}data`)).json()) as ViewData;
      expect(first.runs).toHaveLength(1);
      await fs.appendFile(logFile(), LOG);
      const second = (await (await fetch(`${server!.url}data`)).json()) as ViewData;
      expect(second.runs).toHaveLength(2);
    } finally {
      await server!.close();
    }
  });
});
