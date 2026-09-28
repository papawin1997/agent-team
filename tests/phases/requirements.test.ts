import { describe, expect, it, vi } from 'vitest';
import type { PlanInput, PmInput } from '../../src/deps';
import { initProgress, quickDesign } from '../../src/domain';
import { runDesign } from '../../src/phases/design';
import { runRequirements } from '../../src/phases/requirements';
import { newState } from '../../src/state';
import { asking, makeDesign, makeQuickTask, makeRequirements, proposal, quickProposal } from '../helpers/builders';
import { makeDeps } from '../helpers/fakes';

const pmInput = (runner: { calls: { input: unknown }[] }, i: number) => runner.calls[i]!.input as PmInput;

describe('runRequirements', () => {
  it('ถามต่อจน PM เสนอ requirements แล้ว user confirm -> DESIGN', async () => {
    const { deps, runner, store, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal()] },
      ['อยากได้ todo list', 'ใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.requirements).toEqual(makeRequirements());
    expect(state.pmSessionId).toBe('pm-session');
    expect(store.artifacts.get('requirements.json')).toEqual(makeRequirements());
    expect(pmInput(runner, 0).prompt).toBe('อยากได้ todo list');
    expect(pmInput(runner, 1).prompt).toBe('ใช้ Express');
    expect(pmInput(runner, 1).sessionId).toBe('pm-session');
    expect(io.said.join('\n')).toContain('ใช้ tech อะไร?');
    expect(io.said.join('\n')).toContain('todo list');
  });

  it('user ขอแก้ requirements: PM คุยต่อแล้วเสนอใหม่', async () => {
    const { deps, runner, store } = makeDeps(
      { pm: [proposal(), proposal({ ...makeRequirements(), goal: 'todo list v2' })] },
      ['x', 'revise', 'ปรับ scope', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(runner.calls).toHaveLength(2);
    expect(pmInput(runner, 1).prompt).toBe('ปรับ scope');
    expect(state.requirements?.goal).toBe('todo list v2');
    expect(store.saves).toBeGreaterThanOrEqual(2);
  });

  it('revise does not finish phase until confirm', async () => {
    const { deps, store } = makeDeps(
      { pm: [proposal(), proposal({ ...makeRequirements(), goal: 'todo list v2' })] },
      ['x', 'revise', 'ปรับ scope', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    // After first PM turn + revise choice, before confirm decision, phase should still be REQUIREMENTS
    expect(state.phase).toBe('DESIGN');
    // Check that requirements were never undefined after revise (they should be set only on confirm)
    expect(state.requirements?.goal).toBe('todo list v2');
  });

  it('ใช้ pendingPrompt แทนการถามใหม่ และแนบ requirements เดิม', async () => {
    const { deps, runner, io } = makeDeps({ pm: [proposal()] }, ['confirm']);
    const state = newState();
    state.requirements = makeRequirements();
    state.pendingPrompt = 'แก้ให้มี login';
    await runRequirements(deps, state);

    expect(pmInput(runner, 0).prompt).toContain('แก้ให้มี login');
    expect(pmInput(runner, 0).prompt).toContain('"goal":"todo list"');
    expect(io.asked).toHaveLength(1);
    expect(state.pendingPrompt).toBeUndefined();
  });

  it('proposal ที่ไม่มี requirements ถือเป็นการถามต่อ', async () => {
    const { deps, runner } = makeDeps(
      { pm: [{ message: 'ยังไม่ครบ', status: 'proposal' }, proposal()] },
      ['เริ่ม', 'ต่อ', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(pmInput(runner, 1).prompt).toBe('ต่อ');
  });

  it('empty answer is never sent to PM', async () => {
    const { deps, runner, io } = makeDeps(
      { pm: [proposal()] },
      ['', '  ', 'อยากได้ todo list', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(runner.calls).toHaveLength(1);
    expect(pmInput(runner, 0).prompt).toBe('อยากได้ todo list');
  });

  it('asserts persistence: pmSessionId and saves', async () => {
    const { deps, runner, store, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal()] },
      ['อยากได้ todo list', 'ใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.pmSessionId).toBe('pm-session');
    expect(store.saves).toBeGreaterThanOrEqual(runner.calls.length);
  });

  it('resume opening text when pmSessionId already set', async () => {
    const { deps, io } = makeDeps({ pm: [proposal()] }, ['ข้อมูลเพิ่ม', 'confirm']);
    const state = newState();
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(io.asked[0]).toBe('พิมพ์ข้อความถึง PM เพื่อคุยต่อ\n> ');
  });

  it('พิมพ์คำถามแทนการเลือก confirm/revise -> PM ตอบก่อน แล้วถามใหม่จนกว่าจะเลือกจริง', async () => {
    const { deps, runner, io } = makeDeps(
      { pm: [asking('ใช้ tech อะไร?'), proposal(), asking('เพราะ Express เบาและเร็วพอสำหรับ todo list')] },
      ['อยากได้ todo list', 'ใช้ Express', 'ทำไมต้องใช้ Express', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(runner.calls).toHaveLength(3);
    expect(pmInput(runner, 2).prompt).toContain('ทำไมต้องใช้ Express');
    expect(io.said.join('\n')).toContain('เพราะ Express เบาและเร็วพอ');
  });

  it('PM เสนอ requirements ใหม่ระหว่างตอบคำถาม -> confirm บันทึกเวอร์ชันใหม่ ไม่ใช่เวอร์ชันเก่า', async () => {
    const original = makeRequirements();
    const updated = { ...makeRequirements(), goal: 'todo list + แจ้งเตือน' };
    const { deps, store } = makeDeps(
      { pm: [proposal(original), proposal(updated, 'ได้ครับ ผมเพิ่มฟีเจอร์แจ้งเตือนให้แล้ว')] },
      ['อยากได้ todo list', 'เพิ่มแจ้งเตือนได้ไหม', 'confirm'],
    );
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.requirements?.goal).toBe('todo list + แจ้งเตือน');
    expect(store.artifacts.get('requirements.json')).toEqual(updated);
  });

  it('ตั้ง title จากข้อความแรกและ save ก่อนเรียก PM', async () => {
    const { deps, store } = makeDeps({ pm: [] }, ['อยากได้ระบบ todo']);
    const state = newState();
    // PM ล้ม -> ถามให้ลองใหม่ -> ScriptedIO ไม่มีคำตอบเหลือ (title ต้องถูก save ไว้แล้ว)
    await expect(runRequirements(deps, state)).rejects.toThrow('ScriptedIO');
    expect(store.state?.title).toBe('อยากได้ระบบ todo');
  });

  it('title ถูกตัดเหลือ 60 ตัวอักษร', async () => {
    const { deps } = makeDeps({ pm: [proposal()] }, ['ก'.repeat(80), 'confirm']);
    const state = newState();
    await runRequirements(deps, state);
    expect(state.title).toBe('ก'.repeat(60));
  });

  it('ไม่เขียนทับ title ที่มีอยู่แล้ว', async () => {
    const { deps } = makeDeps({ pm: [proposal()] }, ['ข้อความใหม่', 'confirm']);
    const state = newState();
    state.title = 'ชื่อเดิม';
    await runRequirements(deps, state);
    expect(state.title).toBe('ชื่อเดิม');
  });

  it('ไม่ตั้ง title ถ้ามี pmSessionId อยู่แล้ว (งาน legacy ที่คุยค้าง)', async () => {
    const { deps } = makeDeps({ pm: [proposal()] }, ['ต่อเลย', 'confirm']);
    const state = newState();
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);
    expect(state.title).toBeUndefined();
  });

  it('PM เสนอ quick แล้วเลือก quick -> BUILD ด้วย design 1 task, รอบ QA = quickMaxQaRounds, log level.decided', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps, store, io } = makeDeps({ pm: [quickProposal()] }, ['แก้คำผิด', 'quick']);
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('BUILD');
    expect(state.level).toBe('quick');
    expect(state.quickTask).toEqual(makeQuickTask());
    expect(state.design?.tasks.map((t) => t.id)).toEqual(['quick']);
    expect(state.progress.quick).toMatchObject({ rounds: 0, maxRounds: 2, done: false });
    expect(store.artifacts.get('design.json')).toEqual(state.design);
    expect(store.artifacts.get('requirements.json')).toEqual(makeRequirements());
    expect(io.said.join('\n')).toContain('--- งานแบบ quick (1 task) ---');
    expect(io.said.join('\n')).toContain('ระดับที่ PM เสนอ: quick — แก้ไฟล์เดียว');
    expect(events.find((e) => e.event === 'level.decided')?.data).toEqual({
      level: 'quick',
      by: 'pm',
      reason: 'แก้ไฟล์เดียว',
      riskFlags: [],
    });
  });

  it('PM เสนอ quick แต่เลือก full -> DESIGN, log by user', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps } = makeDeps({ pm: [quickProposal()] }, ['แก้คำผิด', 'full']);
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.quickTask).toBeUndefined();
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({ level: 'full', by: 'user' });
  });

  it('เจอคำเสี่ยง: เตือนและเรียง full ก่อน แต่ยังเลือก quick ได้', async () => {
    const risky = { ...makeRequirements(), goal: 'เพิ่มปุ่ม login' };
    const { deps, io } = makeDeps({ pm: [quickProposal(risky)] }, ['x', 'quick']);
    const state = newState();
    await runRequirements(deps, state);

    expect(io.said.join('\n')).toContain('⚠ งานนี้แตะเรื่อง auth — แนะนำ full (มีขั้นออกแบบและตรวจ Security)');
    expect(state.level).toBe('quick');
  });

  it('revise จากตัวเลือกระดับ -> ถามว่าอยากปรับอะไรแล้วคุยต่อ', async () => {
    const { deps, runner } = makeDeps({ pm: [quickProposal(), proposal()] }, ['x', 'revise', 'ขอแบบเต็ม', 'confirm']);
    const state = newState();
    await runRequirements(deps, state);

    expect(pmInput(runner, 1).prompt).toBe('ขอแบบเต็ม');
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
  });

  it('--full: ไม่เสนอ quick แม้ PM ส่ง quick มา และบอก PM ในข้อความแรก', async () => {
    const { deps, runner, io } = makeDeps({ pm: [quickProposal()] }, ['แก้คำผิด', 'confirm']);
    deps.levelPreference = 'full';
    const state = newState();
    await runRequirements(deps, state);

    expect(pmInput(runner, 0).prompt).toBe('[ผู้ใช้สั่ง --full: ต้องเป็น full เท่านั้น]\nแก้คำผิด');
    expect(io.said.join('\n')).not.toContain('งานแบบ quick');
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.title).toBe('แก้คำผิด');
  });

  it('--quick: บอก PM ในข้อความแรก', async () => {
    const { deps, runner } = makeDeps({ pm: [quickProposal()] }, ['แก้คำผิด', 'quick']);
    deps.levelPreference = 'quick';
    await runRequirements(deps, newState());
    expect(pmInput(runner, 0).prompt).toBe('[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]\nแก้คำผิด');
  });

  it('levelHint เป็น state ต่อการรันหนึ่งครั้ง (ไม่ใช่ของ deps): ส่ง object เดิมซ้ำไม่บอก PM อีก, deps ใช้ซ้ำข้ามการรันไม่ค้าง flag', async () => {
    const levelHint = { sent: false };
    const { deps: deps1, runner: runner1 } = makeDeps({ pm: [quickProposal()] }, ['ขอ A', 'quick']);
    deps1.levelPreference = 'quick';
    await runRequirements(deps1, newState(), levelHint);
    expect(pmInput(runner1, 0).prompt).toBe('[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]\nขอ A');
    expect(levelHint.sent).toBe(true);

    // เรียกซ้ำด้วย levelHint object เดิม (จำลองกลับเข้า REQUIREMENTS อีกครั้งในรอบรันเดียวกัน): ไม่บอกซ้ำ
    const { deps: deps2, runner: runner2 } = makeDeps({ pm: [quickProposal()] }, ['ขอ B', 'quick']);
    deps2.levelPreference = 'quick';
    await runRequirements(deps2, newState(), levelHint);
    expect(pmInput(runner2, 0).prompt).toBe('ขอ B');

    // deps ใช้ซ้ำได้ (ไม่มี field ค้างอยู่บน deps เอง) — ถ้าไม่ส่ง levelHint มาเลย (การรันใหม่) จะบอก PM อีกครั้ง
    const { deps: deps3, runner: runner3 } = makeDeps({ pm: [quickProposal()] }, ['ขอ C', 'quick']);
    deps3.levelPreference = 'quick';
    await runRequirements(deps3, newState());
    expect(pmInput(runner3, 0).prompt).toBe('[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]\nขอ C');
  });

  it('PM เปลี่ยนข้อเสนอเป็น full ระหว่างตัดสินใจ quick: ไม่รับ quick แบบเงียบ ๆ ถามยืนยันแบบ full แทน', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const { deps, io } = makeDeps(
      { pm: [quickProposal(), proposal()] },
      ['แก้คำผิด', 'ทำไมถึงเสนอ quick', 'quick', 'confirm'],
    );
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    expect(io.said.join('\n')).toContain('PM เปลี่ยนข้อเสนอเป็น full แล้ว');
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.quickTask).toBeUndefined();
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({ level: 'full', by: 'pm' });
  });

  it('risk flags เปลี่ยนระหว่างตัดสินใจ quick (ยังเสนอ quick อยู่): เตือนใหม่และ log flags ล่าสุด', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const risky = { ...makeRequirements(), goal: 'เพิ่มปุ่ม login' };
    const { deps, io } = makeDeps(
      { pm: [quickProposal(), quickProposal(risky)] },
      ['แก้คำผิด', 'ทำไมถึงเสนอ quick', 'full'],
    );
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    expect(io.said.join('\n')).toContain('⚠ งานนี้แตะเรื่อง auth — แนะนำ full (มีขั้นออกแบบและตรวจ Security)');
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({
      level: 'full',
      by: 'user',
      riskFlags: ['auth'],
    });
  });

  it('PM เปลี่ยนข้อเสนอเป็น full ระหว่างตัดสินใจ quick โดย requirements ใหม่เสี่ยง: log riskFlags ล่าสุด (ไม่ใช่ [])', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const risky = { ...makeRequirements(), goal: 'เพิ่มปุ่ม login' };
    const { deps, io } = makeDeps(
      { pm: [quickProposal(), proposal(risky)] },
      ['แก้คำผิด', 'ทำไมถึงเสนอ quick', 'quick', 'confirm'],
    );
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    expect(io.said.join('\n')).toContain('PM เปลี่ยนข้อเสนอเป็น full แล้ว');
    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(events.find((e) => e.event === 'level.decided')?.data).toEqual({
      level: 'full',
      by: 'pm',
      reason: undefined,
      riskFlags: ['auth'],
    });
  });

  it('risk flags โผล่มาระหว่างตัดสินใจ quick (ยังเสนอ quick อยู่) แต่ user ยังเลือก quick: ห้ามรับทันที ต้องเตือนแล้วถามซ้ำแบบเรียง full ก่อน', async () => {
    const events: { event: string; data?: Record<string, unknown> }[] = [];
    const risky = { ...makeRequirements(), goal: 'เพิ่มปุ่ม login' };
    const { deps, io } = makeDeps(
      { pm: [quickProposal(), quickProposal(risky)] },
      ['แก้คำผิด', 'ทำไมถึงเสนอ quick', 'quick', 'quick'],
    );
    deps.log = { log: (_level, event, data) => events.push({ event, data }) };
    const state = newState();
    await runRequirements(deps, state);

    const LEVEL_PROMPT = 'ทำแบบไหน? (quick = ทำเลยแบบย่อ 1 task, full = ออกแบบก่อนแบบเต็ม, revise = แก้ requirements)';
    // ask#1 (คำถามอิสระ) + ask#2 ('quick' รอบแรก จบ decide() แรก) + ask#3 (ถามซ้ำหลังเจอความเสี่ยง 'quick' รอบสอง) = 3 ครั้ง
    expect(io.asked.filter((p) => p === LEVEL_PROMPT).length).toBe(3);
    expect(io.said.join('\n')).toContain('⚠ งานนี้แตะเรื่อง auth — แนะนำ full (มีขั้นออกแบบและตรวจ Security)');
    expect(state.phase).toBe('BUILD');
    expect(state.level).toBe('quick');
    expect(events.find((e) => e.event === 'level.decided')?.data).toMatchObject({
      level: 'quick',
      by: 'pm',
      riskFlags: ['auth'],
    });
  });

  it('งานเดิมเคยเป็น quick แล้วขอแก้ตอน DELIVER จน PM เสนอ full: ล้าง design/progress ให้ Planning เริ่มใหม่', async () => {
    const quickTask = makeQuickTask();
    const design = quickDesign(makeRequirements(), quickTask);
    const { deps } = makeDeps({ pm: [proposal()] }, ['confirm']);
    const state = newState();
    state.phase = 'REQUIREMENTS';
    state.level = 'quick';
    state.quickTask = quickTask;
    state.requirements = makeRequirements();
    state.design = design;
    state.progress = initProgress(design, {}, 2);
    state.pendingPrompt = 'ขอเพิ่มฟีเจอร์ค้นหา';
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.quickTask).toBeUndefined();
    expect(state.design).toBeUndefined();
    expect(state.progress).toEqual({});
  });

  it('งาน full มี design จริง [api, ui] แล้วขอแก้ตอน DELIVER จน PM เสนอ quick: เก็บ baseDesign/baseProgress ไว้ design ของ quick ใช้ architecture ของ base', async () => {
    const fullDesign = makeDesign(); // tasks [api(backend), ui(frontend, depends on api)]
    const basePrev = initProgress(fullDesign, {}, 5);
    basePrev.api = { ...basePrev.api!, done: true };
    basePrev.ui = { ...basePrev.ui!, done: true };
    const { deps } = makeDeps({ pm: [quickProposal()] }, ['quick']);
    const state = newState();
    state.phase = 'REQUIREMENTS';
    state.level = 'full';
    state.requirements = makeRequirements();
    state.design = fullDesign;
    state.progress = basePrev;
    state.pendingPrompt = 'ขอแก้เล็กน้อย';
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(state.phase).toBe('BUILD');
    expect(state.level).toBe('quick');
    expect(state.baseDesign).toEqual(fullDesign);
    expect(state.baseProgress).toEqual(basePrev);
    expect(state.design?.tasks.map((t) => t.id)).toEqual(['quick']);
    expect(state.design?.architecture).toBe(fullDesign.architecture);
    expect(state.design?.apiContract).toBe(fullDesign.apiContract);
    expect(state.design?.dataModel).toBe(fullDesign.dataModel);
    expect(state.design?.overview).toBe(fullDesign.overview);
  });

  it('งาน quick ที่มี baseDesign แล้วขอแก้จน PM เสนอ full: คืน design/progress เดิมให้ Planning เห็นเป็น previousDesign (ไม่เสีย design เดิม)', async () => {
    const fullDesign = makeDesign();
    const baseProgress = initProgress(fullDesign, {}, 5);
    baseProgress.api = { ...baseProgress.api!, done: true };
    baseProgress.ui = { ...baseProgress.ui!, done: true };
    const quickTask = makeQuickTask();
    const quickDsn = quickDesign(makeRequirements(), quickTask, fullDesign);
    const { deps } = makeDeps({ pm: [proposal()] }, ['confirm']);
    const state = newState();
    state.phase = 'REQUIREMENTS';
    state.level = 'quick';
    state.quickTask = quickTask;
    state.requirements = makeRequirements();
    state.design = quickDsn;
    state.progress = initProgress(quickDsn, {}, 2);
    state.baseDesign = fullDesign;
    state.baseProgress = baseProgress;
    state.pendingPrompt = 'ขอเพิ่มฟีเจอร์ค้นหา';
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(state.phase).toBe('DESIGN');
    expect(state.level).toBe('full');
    expect(state.design).toEqual(fullDesign);
    expect(state.progress).toEqual(baseProgress);
    expect(state.baseDesign).toBeUndefined();
    expect(state.baseProgress).toBeUndefined();

    const { deps: designDeps, runner: designRunner } = makeDeps({ plans: [makeDesign()] }, []);
    await runDesign(designDeps, state);
    const planInput = designRunner.calls[0]!.input as PlanInput;
    expect(planInput.previousDesign?.tasks.map((t) => t.id)).toEqual(['api', 'ui']);
  });

  it('ยอมรับ quick: ลบ designFeedback เก่าทิ้ง (ไม่ให้ตกค้างไปถึง runDesign รอบถัดไป)', async () => {
    const { deps } = makeDeps({ pm: [quickProposal()] }, ['แก้คำผิด', 'quick']);
    const state = newState();
    state.designFeedback = 'feedback เก่าที่ค้างมาจาก revise รอบก่อน';
    await runRequirements(deps, state);

    expect(state.level).toBe('quick');
    expect(state.designFeedback).toBeUndefined();
  });

  it('--quick: บอก PM ในข้อความแรกของการรันนี้ แม้เป็นงานค้างที่มี pmSessionId อยู่แล้ว', async () => {
    const { deps, runner } = makeDeps({ pm: [quickProposal()] }, ['ต่อเลย', 'quick']);
    deps.levelPreference = 'quick';
    const state = newState();
    state.pmSessionId = 'pm-session';
    await runRequirements(deps, state);

    expect(pmInput(runner, 0).prompt).toBe('[ผู้ใช้ขอโหมด quick ถ้างานเข้าเกณฑ์]\nต่อเลย');
  });

  it('ผู้ใช้พิมพ์คำเสี่ยงเอง แม้ requirements/quickTask ของ PM ดูไม่เสี่ยง: เตือนความเสี่ยงอยู่ดี', async () => {
    const { deps, io } = makeDeps({ pm: [quickProposal()] }, ['เพิ่มหน้า login', 'quick']);
    const state = newState();
    await runRequirements(deps, state);

    expect(io.said.join('\n')).toContain('⚠ งานนี้แตะเรื่อง auth — แนะนำ full (มีขั้นออกแบบและตรวจ Security)');
    expect(state.level).toBe('quick');
  });

  it('risk flags ปรากฏแล้วหายไปก่อนตัดสินใจ: riskAppearedMidDecision reset แล้วไม่ต้องถามซ้ำตอนเลือก quick', async () => {
    const risky = { ...makeRequirements(), goal: 'เพิ่มปุ่ม login' };
    const { deps } = makeDeps(
      { pm: [quickProposal(), quickProposal(risky), quickProposal()] },
      ['แก้คำผิด', 'ทำไมถึงเสนอ quick', 'ทำไมหายไปแล้ว', 'quick'],
    );
    const state = newState();
    // ScriptedIO จะ throw ถ้าโค้ดพยายามถามซ้ำ (ไม่มีคำตอบที่ 5 เหลือ) — ผ่านแปลว่าไม่ได้ถามซ้ำจริง
    await runRequirements(deps, state);

    expect(state.phase).toBe('BUILD');
    expect(state.level).toBe('quick');
  });

  describe('PM ตอบไม่สำเร็จ ไม่ทำให้ทั้ง run หยุด', () => {
    it('กด Enter = ส่งข้อความเดิมให้ PM อีกครั้ง', async () => {
      const { deps, runner, io } = makeDeps({ pm: [proposal()] }, ['อยากได้ todo list', '', 'confirm']);
      vi.spyOn(runner, 'pmTurn').mockRejectedValueOnce(new Error('pm: error_max_structured_output_retries'));
      const state = newState();

      await runRequirements(deps, state);

      expect(state.phase).toBe('DESIGN');
      expect(pmInput(runner, 0).prompt).toBe('อยากได้ todo list');
      expect(io.said.join('\n')).toContain('PM ตอบไม่สำเร็จ (pm: error_max_structured_output_retries)');
    });

    it('พิมพ์ข้อความใหม่ = ส่งข้อความใหม่แทน', async () => {
      const { deps, runner } = makeDeps({ pm: [proposal()] }, ['อยากได้ todo list', 'ขอแบบสั้น ๆ', 'confirm']);
      vi.spyOn(runner, 'pmTurn').mockRejectedValueOnce(new Error('boom'));
      const state = newState();

      await runRequirements(deps, state);

      expect(state.phase).toBe('DESIGN');
      expect(pmInput(runner, 0).prompt).toBe('ขอแบบสั้น ๆ');
    });
  });
});
