import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { downloadAttachment, fetchIssue, findIssueKeys, formatIssue, htmlToText, type HttpFetch, parseIssue } from '../src/jira';
import { httpRes, issueJson } from './helpers/jira';

const settings = DEFAULT_CONFIG.jira;

describe('findIssueKeys', () => {
  it('จับ key ที่ prefix อยู่ใน projects แม้ติดภาษาไทย', () => {
    expect(findIssueKeys('แก้การ์ดRTRPMS-2612 ด่วน', settings)).toEqual(['RTRPMS-2612']);
  });

  it('จับจาก URL ของ site เฉพาะ project ที่อยู่ใน projects', () => {
    expect(findIssueKeys('ดู https://digital-and-technology.atlassian.net/browse/RTRPMS-7 หน่อย', settings)).toEqual(['RTRPMS-7']);
    expect(findIssueKeys('https://digital-and-technology.atlassian.net/browse/RTRED-2612', settings)).toEqual([]);
  });

  it('ไม่จับ project ที่ไม่อยู่ใน projects (รวม RTRED), เลขเปล่า, และ key ที่ติดตัวอักษรอังกฤษ', () => {
    expect(findIssueKeys('ABC-7', settings)).toEqual([]);
    expect(findIssueKeys('ดู RTRED-2612', settings)).toEqual([]);
    expect(findIssueKeys('แก้ 3 ไฟล์ของ 2612', settings)).toEqual([]);
    expect(findIssueKeys('xRTRPMS-1', settings)).toEqual([]);
  });

  it('ไม่ซ้ำ และสูงสุด 3 ใบตามลำดับที่พบ', () => {
    expect(findIssueKeys('RTRPMS-1 RTRPMS-2 RTRPMS-1 RTRPMS-3 RTRPMS-4', settings)).toEqual(['RTRPMS-1', 'RTRPMS-2', 'RTRPMS-3']);
  });
});

describe('htmlToText', () => {
  it('แปลง list, ย่อหน้า, ตาราง และ entity', () => {
    const text = htmlToText(
      '<p>Hi &amp; bye&#39;s</p><ul><li>a</li><li>b</li></ul><table><tr><td>x</td><td>y</td></tr></table>',
    );
    expect(text).toContain("Hi & bye's");
    expect(text).toContain('  - a\n  - b');
    expect(text).toContain('  | x');
    expect(text).not.toContain('<');
  });

  it('ช่องว่าง/tab ที่ขึ้นบรรทัดใหม่ระหว่าง tag (HTML จริงของ Jira) ไม่กลายเป็นบรรทัดขยะ แต่ช่องว่างในบรรทัดยังอยู่', () => {
    const text = htmlToText('<p>Background:</p>\n\t<ul>\n\t<li>a</li>\n\t<li>b</li>\n</ul><p><b>x</b> <i>y</i></p>');
    expect(text).toContain('Background:\n\n  - a\n  - b');
    expect(text).toContain('x y');
    expect(text).not.toMatch(/^[ \t]+$/m);
  });

  it('ค่าว่างคืนข้อความว่าง', () => {
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('parseIssue', () => {
  it('ดึง metadata, Key details และเฉพาะรูปแนบ', () => {
    const issue = parseIssue('RTRPMS-1', issueJson(), settings);
    expect(issue.summary).toBe('สร้างหน้า login');
    expect(issue.type).toBe('Story');
    expect(issue.assignee).toBe('-');
    expect(issue.link).toBe('https://digital-and-technology.atlassian.net/browse/RTRPMS-1');
    expect(issue.details).toContain('Background story');
    expect(issue.details).toContain('  - AC1');
    expect(issue.fromDescription).toBe(false);
    expect(issue.images).toEqual([{ filename: 'ui.png', mimeType: 'image/png', size: 3, url: 'https://x.test/att/1' }]);
  });

  it('Key details ว่างทั้งหมด -> ใช้ description และบอกว่ามาจาก description', () => {
    const issue = parseIssue('RTRPMS-1', issueJson({ renderedFields: { description: '<p>desc</p>' } }), settings);
    expect(issue.details).toBe('desc');
    expect(issue.fromDescription).toBe(true);
  });

  it('JSON ไม่ครบไม่ล้ม', () => {
    const issue = parseIssue('RTRPMS-9', {}, settings);
    expect(issue.key).toBe('RTRPMS-9');
    expect(issue.status).toBe('-');
    expect(issue.images).toEqual([]);
  });
});

describe('formatIssue', () => {
  it('มีหัวการ์ด metadata เนื้อหา และ path รูป', () => {
    const text = formatIssue(parseIssue('RTRPMS-1', issueJson(), settings), ['.agent-team/jobs/j/jira/RTRPMS-1-1.png']);
    expect(text).toContain('# RTRPMS-1 — สร้างหน้า login');
    expect(text).toContain('- Status: To Do');
    expect(text).toContain('## Key details');
    expect(text).toContain('open them with Read');
    expect(text).toContain('- .agent-team/jobs/j/jira/RTRPMS-1-1.png');
  });

  it('มาจาก description -> หัวข้อบอกว่า Key details ว่าง ; ไม่มีรูป -> ไม่มีหัวข้อรูป', () => {
    const issue = parseIssue('RTRPMS-1', issueJson({ renderedFields: { description: '<p>d</p>' } }), settings);
    const text = formatIssue(issue, []);
    expect(text).toContain('## Description (Key details is empty)');
    expect(text).not.toContain('open them with Read');
  });
});

const env = { JIRA_EMAIL: 'me@x.test', JIRA_TOKEN: 'tok' };

describe('fetchIssue', () => {
  it('เรียก REST v3 พร้อม renderedFields, field Key details และ Basic auth', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch: HttpFetch = async (url, init) => {
      seen.push({ url, headers: init.headers });
      return httpRes(200, issueJson());
    };
    const issue = await fetchIssue('RTRPMS-1', { settings, env, fetch });
    expect(issue.summary).toBe('สร้างหน้า login');
    expect(seen[0]!.url).toContain('https://digital-and-technology.atlassian.net/rest/api/3/issue/RTRPMS-1?expand=renderedFields');
    expect(seen[0]!.url).toContain('customfield_10119');
    expect(seen[0]!.url).toContain('attachment');
    expect(seen[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('me@x.test:tok').toString('base64')}`);
  });

  it('ไม่มี env -> error บอกวิธีตั้ง และไม่เรียก fetch', async () => {
    let called = false;
    const fetch: HttpFetch = async () => {
      called = true;
      return httpRes(200, {});
    };
    await expect(fetchIssue('RTRPMS-1', { settings, env: {}, fetch })).rejects.toThrow(/JIRA_EMAIL/);
    expect(called).toBe(false);
  });

  it.each([
    [401, /HTTP 401.*JIRA_TOKEN/],
    [403, /HTTP 403/],
    [404, /HTTP 404/],
    [500, /HTTP 500/],
  ])('HTTP %i -> error ที่อ่านได้', async (status, message) => {
    const fetch: HttpFetch = async () => httpRes(status, { errorMessages: ['x'] });
    await expect(fetchIssue('RTRPMS-1', { settings, env, fetch })).rejects.toThrow(message);
  });

  it('หมดเวลา -> error บอกว่าหมดเวลา', async () => {
    const fetch: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(fetchIssue('RTRPMS-1', { settings, env, fetch, timeoutMs: 20 })).rejects.toThrow(/หมดเวลา/);
  });

  it('network ล้ม -> error บอกว่าเชื่อมต่อไม่ได้ และไม่มี token ในข้อความ', async () => {
    const fetch: HttpFetch = async () => {
      throw new Error('ENOTFOUND');
    };
    const err = await fetchIssue('RTRPMS-1', { settings, env, fetch }).catch((e: Error) => e);
    expect(String(err)).toMatch(/เชื่อมต่อ Jira ไม่ได้.*ENOTFOUND/);
    expect(String(err)).not.toContain('tok');
  });
});

describe('downloadAttachment', () => {
  it('คืน bytes ของไฟล์แนบ', async () => {
    const fetch: HttpFetch = async () => httpRes(200, undefined, new Uint8Array([1, 2, 3]));
    const data = await downloadAttachment('https://x.test/att/1', { settings, env, fetch });
    expect([...data]).toEqual([1, 2, 3]);
  });
});
