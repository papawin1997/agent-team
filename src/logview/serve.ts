import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { renderHtml } from './render';
import type { ViewData } from './view-data';

export interface LiveServer {
  url: string;
  close(): Promise<void>;
}

/** server ของ agent-team logs --live: bind 127.0.0.1 เท่านั้น สร้างข้อมูลใหม่จาก log ทุก request */
export function startLiveServer(opts: { load: () => ViewData; port?: number }): Promise<LiveServer> {
  let allowedHosts: string[] = [];
  const server = http.createServer((req, res) => {
    // กัน DNS rebinding: เว็บอื่นที่ชี้ชื่อโดเมนมาที่ 127.0.0.1 จะส่ง Host เป็นชื่อโดเมนนั้น
    if (!allowedHosts.includes(req.headers.host ?? '')) {
      send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
      return;
    }
    const url = (req.url ?? '/').split('?')[0];
    try {
      if (req.method === 'GET' && url === '/') {
        send(res, 200, 'text/html; charset=utf-8', renderHtml(opts.load(), { live: true }));
      } else if (req.method === 'GET' && url === '/data') {
        send(res, 200, 'application/json; charset=utf-8', JSON.stringify(opts.load()));
      } else {
        send(res, 404, 'text/plain; charset=utf-8', 'not found');
      }
    } catch (e) {
      send(res, 500, 'text/plain; charset=utf-8', e instanceof Error ? e.message : String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function send(res: http.ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}
