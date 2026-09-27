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
  // ห้ามผ่าน cmd.exe: cmd จะขยาย %VAR% แม้อยู่ในเครื่องหมายคำพูด ทำให้ path ที่มี % เปิดผิดเป้าหมายแบบเงียบๆ
  // explorer.exe เปิดได้ทั้งไฟล์ .html และ http URL ด้วยเบราว์เซอร์ default (exit code 1 แม้สำเร็จ ซึ่งเราไม่สนอยู่แล้ว)
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [target], verbatim: false };
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
