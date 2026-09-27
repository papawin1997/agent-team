import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startLiveServer, type LiveServer } from '../../src/logview/serve';
import type { ViewData } from '../../src/logview/view-data';

let server: LiveServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const data = (n: number): ViewData => ({
  projectDir: '/work/app',
  logFile: 'x',
  generatedAt: '2026-01-10T00:00:00.000Z',
  defaultRun: n - 1,
  runs: Array.from({ length: n }, (_, i) => ({
    index: i,
    start: '',
    status: 'done' as const,
    events: [],
    calls: [],
    totalCostUsd: 0,
    findings: [],
    transcripts: {},
  })),
});

describe('startLiveServer', () => {
  it('GET /data สร้างข้อมูลใหม่ทุกครั้ง', async () => {
    let n = 0;
    server = await startLiveServer({ load: () => data(++n) });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const a = (await (await fetch(`${server.url}data`)).json()) as ViewData;
    const b = (await (await fetch(`${server.url}data`)).json()) as ViewData;
    expect([a.runs.length, b.runs.length]).toEqual([1, 2]);
  });

  it('GET / ส่งหน้า HTML แบบ live', async () => {
    server = await startLiveServer({ load: () => data(1) });
    const res = await fetch(server.url);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('window.__LIVE__ = true');
  });

  it('path อื่น -> 404, load พัง -> 500 พร้อมข้อความ', async () => {
    server = await startLiveServer({
      load: () => {
        throw new Error('boom');
      },
    });
    expect((await fetch(`${server.url}nope`)).status).toBe(404);
    const res = await fetch(`${server.url}data`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('boom');
  });

  it('Host header ไม่ใช่ 127.0.0.1/localhost -> 403 (กัน DNS rebinding)', async () => {
    server = await startLiveServer({ load: () => data(1) });
    const port = Number(new URL(server.url).port);
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/data', headers: { host: 'evil.example' } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('Host header ตัวพิมพ์ใหญ่ (เช่น LOCALHOST) ก็ยังผ่าน (case-insensitive)', async () => {
    server = await startLiveServer({ load: () => data(1) });
    const port = Number(new URL(server.url).port);
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/data', headers: { host: `LOCALHOST:${port}` } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
        .on('error', reject);
    });
    expect(status).toBe(200);
  });
});
