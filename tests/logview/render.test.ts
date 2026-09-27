import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_JS } from '../../src/logview/page-assets';
import { embedJson, renderHtml } from '../../src/logview/render';
import { buildViewData, defaultRunIndex, type ViewData } from '../../src/logview/view-data';

const LOG = [
  '2026-01-10T09:00:00.000Z INFO  run.start {"projectDir":"/work/app","resume":false,"pid":1}',
  '2026-01-10T09:01:00.000Z INFO  agent.start {"role":"qa","model":"claude-sonnet-5","resumed":false,"promptChars":5}',
  '2026-01-10T09:06:00.000Z WARN  agent.result {"role":"qa","subtype":"success","durationMs":300000,"turns":1,"costUsd":0.5,"sessionId":"s-qa"}',
  '2026-01-10T09:06:01.000Z ERROR run.error {"message":"qa: </script><script>alert(1)</script>"}',
].join('\n');

const readData = (html: string): ViewData => {
  const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m![1]!) as ViewData;
};

describe('buildViewData', () => {
  it('รวม runs + transcripts + findings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-team-view-'));
    await fs.writeFile(
      path.join(dir, 's-qa.jsonl'),
      `${JSON.stringify({
        type: 'system',
        subtype: 'api_error',
        timestamp: '2026-01-10T09:03:00.000Z',
        error: { status: 529, formatted: '529 Overloaded' },
      })}\n`,
    );
    const data = buildViewData({
      projectDir: '/work/app',
      logFile: '/work/app/.agent-team/agent-team.log',
      logText: LOG,
      transcriptsDir: dir,
      now: () => new Date('2026-01-10T10:00:00.000Z'),
    });
    expect(data).toMatchObject({ projectDir: '/work/app', generatedAt: '2026-01-10T10:00:00.000Z' });
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0]!.transcripts['0']!.steps).toHaveLength(1);
    expect(data.runs[0]!.findings[0]!.title).toContain('529');
  });
});

describe('renderHtml', () => {
  const data = buildViewData({
    projectDir: '/work/app',
    logFile: 'x',
    logText: LOG,
    transcriptsDir: path.join(os.tmpdir(), 'agent-team-no-such-dir'),
    now: () => new Date(0),
  });

  it('ฝังข้อมูลเป็น JSON ที่อ่านกลับได้ครบ', () => {
    expect(readData(renderHtml(data))).toEqual(data);
  });

  it('ข้อความใน log ที่มี </script> ไม่หลุดออกจากแท็ก', () => {
    const html = renderHtml(data);
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(html).not.toContain('<script>alert(1)');
  });

  it('มี defaultRun ในข้อมูลที่ฝัง ตาม defaultRunIndex', () => {
    expect(data.defaultRun).toBe(defaultRunIndex(data.runs));
    expect(readData(renderHtml(data)).defaultRun).toBe(data.defaultRun);
  });

  it('ตั้งค่า live ตามตัวเลือก และมี lang/title', () => {
    expect(renderHtml(data)).toContain('window.__LIVE__ = false');
    expect(renderHtml(data, { live: true })).toContain('window.__LIVE__ = true');
    expect(renderHtml(data)).toContain('<html lang="th">');
    expect(renderHtml(data)).toContain('<title>agent-team logs — app</title>');
  });

  it('defaultRun ในข้อมูล (ผ่าน buildViewData) ตาม defaultRunIndex (รอบล่าสุดที่เรียก agent/มีปัญหา ไม่ใช่รอบสุดท้ายเสมอไป)', () => {
    const twoRuns = buildViewData({
      projectDir: '/work/app',
      logFile: 'x',
      // รอบ 0: เรียก agent qa แล้ว error (มีปัญหา) / รอบ 1: PM คุยต่อ ยังไม่ได้เรียก agent เลย
      logText: `${LOG}\n2026-01-10T09:07:00.000Z INFO  run.start {}\n2026-01-10T09:07:01.000Z INFO  say {"text":"hi"}`,
      transcriptsDir: path.join(os.tmpdir(), 'agent-team-no-such-dir'),
      now: () => new Date(0),
    });
    expect(twoRuns.runs).toHaveLength(2);
    expect(twoRuns.runs[1]!.calls).toHaveLength(0);
    const idx = defaultRunIndex(twoRuns.runs);
    expect(idx).toBe(0);
    expect(twoRuns.defaultRun).toBe(0);
    const html = renderHtml(twoRuns);
    expect(readData(html).defaultRun).toBe(0);
    expect(html.match(/<\/script>/g)).toHaveLength(3);
  });

  it('embedJson escape <, U+2028, U+2029', () => {
    expect(embedJson({ a: '</script>\u2028\u2029' })).toBe('{"a":"\\u003c/script>\\u2028\\u2029"}');
  });

  it('โค้ดฝั่งเบราว์เซอร์ไม่มี syntax error และไม่มี </script>', () => {
    expect(() => new Function(PAGE_JS)).not.toThrow();
    expect(PAGE_JS).not.toContain('</script');
  });

  it('ใช้ data.defaultRun เป็นค่าเริ่มต้นของรอบที่แสดง (ไม่คำนวณเองซ้ำกับ view-data.ts)', () => {
    expect(PAGE_JS).toContain('data.defaultRun');
    expect(PAGE_JS).not.toContain('computeDefaultRun');
    expect(PAGE_JS).not.toContain('__DEFAULT_RUN__');
  });

  it('บอกรอบที่ไม่ได้เรียก agent ใน dropdown', () => {
    expect(PAGE_JS).toContain('(ไม่ได้เรียก agent)');
  });

  it('live: หยุด poll เมื่อแท็บถูกซ่อน (document.hidden)', () => {
    expect(PAGE_JS).toContain('document.hidden');
  });

  it('live: เลื่อนไปรอบล่าสุดอัตโนมัติเฉพาะตอนอยู่ที่ default เดิมและ default ใหม่เปลี่ยน (ใช้ next.defaultRun จาก server)', () => {
    expect(PAGE_JS).toContain('next.defaultRun');
  });
});
