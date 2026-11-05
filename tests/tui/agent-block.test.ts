import { describe, expect, it } from 'vitest';
import { styler } from '../../src/style';
import { type AgentRun, blockTitle, finishedBlock, runningBlock } from '../../src/tui/agent-block';

const tools = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const run = (n: number, label = '[QA] api: กำลังตรวจ'): AgentRun => ({ label, startedAt: 0, tools: tools(n) });
const plain = styler(false);

describe('blockTitle', () => {
  it.each([
    ['[QA] api: กำลังตรวจ', '[QA] api'],
    ['[PM] กำลังคิด', '[PM]'],
    ['[Security] กำลังตรวจ design', '[Security]'],
    ['[backend] api: กำลังทำงาน', '[backend] api'],
    ['อื่น ๆ', 'อื่น ๆ'],
  ])('%s -> %s', (label, title) => {
    expect(blockTitle(label)).toBe(title);
  });
});

describe('runningBlock', () => {
  it('ไม่มี tool: มีแต่หัว', () => {
    expect(runningBlock(run(0), '⠋', '0m03s')).toEqual(['⠋ [QA] api: กำลังตรวจ (0m03s)']);
  });

  it('เกิน 5 tool: บอกจำนวนก่อนหน้า แล้วแสดง 5 รายการล่าสุด', () => {
    expect(runningBlock(run(7), '⠋', '1m12s')).toEqual([
      '⠋ [QA] api: กำลังตรวจ (1m12s)',
      '  … +2 ก่อนหน้า',
      '  ⎿ t3',
      '  ⎿ t4',
      '  ⎿ t5',
      '  ⎿ t6',
      '  ⎿ t7',
    ]);
  });
});

describe('finishedBlock', () => {
  it('สำเร็จ: หัวสรุป + tool ทั้งหมดเมื่อไม่เกิน 8', () => {
    expect(finishedBlock(run(3), true, '2m05s', plain)).toBe(
      '⏺ [QA] api  เสร็จใน 2m05s · 3 tools\n  ⎿ t1\n  ⎿ t2\n  ⎿ t3',
    );
  });

  it('เกิน 8 tool: ยุบส่วนต้นเป็นบรรทัดเดียว แล้วแสดง 8 รายการล่าสุด', () => {
    const lines = finishedBlock(run(10), true, '2m05s', plain)!.split('\n');
    expect(lines[0]).toBe('⏺ [QA] api  เสร็จใน 2m05s · 10 tools');
    expect(lines[1]).toBe('  ⎿ … +2 (ดูทั้งหมด: agent-team logs)');
    expect(lines.slice(2)).toEqual(tools(10).slice(2).map((t) => `  ⎿ ${t}`));
  });

  it('ล้ม: ใช้ ✗ แม้ไม่มี tool ; สำเร็จโดยไม่มี tool = ไม่พิมพ์', () => {
    expect(finishedBlock(run(0, '[PM] กำลังคิด'), false, '0m03s', plain)).toBe('✗ [PM]  ล้มใน 0m03s · 0 tools');
    expect(finishedBlock(run(0, '[PM] กำลังคิด'), true, '0m03s', plain)).toBeUndefined();
  });
});
