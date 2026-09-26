import { describe, expect, it } from 'vitest';
import { browserCommand, openInBrowser } from '../../src/logview/open-browser';

describe('browserCommand', () => {
  it('Windows ใช้ explorer.exe ส่ง path ตรงๆ ไม่ผ่าน cmd.exe (กัน %VAR% ถูกขยาย)', () => {
    expect(browserCommand('C:\\a b\\100%TEMP%\\logs.html', 'win32')).toEqual({
      cmd: 'explorer.exe',
      args: ['C:\\a b\\100%TEMP%\\logs.html'],
      verbatim: false,
    });
  });

  it('macOS ใช้ open, Linux ใช้ xdg-open', () => {
    expect(browserCommand('/x.html', 'darwin')).toEqual({ cmd: 'open', args: ['/x.html'], verbatim: false });
    expect(browserCommand('/x.html', 'linux')).toEqual({ cmd: 'xdg-open', args: ['/x.html'], verbatim: false });
  });
});

describe('openInBrowser', () => {
  it('spawn แบบ detached แล้ว unref', () => {
    const calls: unknown[] = [];
    let unref = false;
    openInBrowser('/x.html', {
      platform: 'linux',
      spawn: (cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        return { on: () => undefined, unref: () => { unref = true; } };
      },
    });
    expect(calls).toEqual([
      ['xdg-open', ['/x.html'], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: false }],
    ]);
    expect(unref).toBe(true);
  });

  it('spawn โยน error -> ไม่ทำให้ล้ม', () => {
    expect(() =>
      openInBrowser('/x.html', {
        platform: 'linux',
        spawn: () => {
          throw new Error('ENOENT');
        },
      }),
    ).not.toThrow();
  });
});
