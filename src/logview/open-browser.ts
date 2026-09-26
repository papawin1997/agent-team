import { spawn, type SpawnOptions } from 'node:child_process';

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => { on(event: 'error', listener: (e: Error) => void): unknown; unref(): void };

const defaultSpawn: SpawnFn = (cmd, args, opts) => spawn(cmd, args, opts);

export function browserCommand(
  target: string,
  platform: NodeJS.Platform = process.platform,
): { cmd: string; args: string[]; verbatim: boolean } {
  // start ของ cmd ถือ argument แรกที่มี quote เป็นชื่อหน้าต่าง จึงต้องใส่ "" ก่อน และ quote path เอง (verbatim)
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', `"${target}"`], verbatim: true };
  if (platform === 'darwin') return { cmd: 'open', args: [target], verbatim: false };
  return { cmd: 'xdg-open', args: [target], verbatim: false };
}

/** เปิดไฟล์/URL ด้วยเบราว์เซอร์ของระบบ เปิดไม่ได้ก็ไม่เป็นไร (ผู้ใช้เปิดเองจาก path ที่พิมพ์ไว้) */
export function openInBrowser(target: string, deps: { platform?: NodeJS.Platform; spawn?: SpawnFn } = {}): void {
  const { cmd, args, verbatim } = browserCommand(target, deps.platform);
  try {
    const child = (deps.spawn ?? defaultSpawn)(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // ignore
  }
}
