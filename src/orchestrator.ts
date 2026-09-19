import type { Deps } from './deps';
import { runBuild } from './phases/build';
import { runDeliver } from './phases/deliver';
import { runDesign, runReview } from './phases/design';
import { runRequirements } from './phases/requirements';
import { newState, type State } from './state';

export async function runTeam(deps: Deps, opts: { resume: boolean }): Promise<State> {
  const existing = await deps.store.load();
  let state: State;

  if (opts.resume) {
    if (!existing) throw new Error('ไม่พบ state ให้ resume (.agent-team/state.json)');
    state = existing;
  } else {
    if (existing && existing.phase !== 'DONE' && existing.phase !== 'ABORTED') {
      throw new Error(
        'มีงานค้างอยู่ใน .agent-team/ — ใช้ --resume เพื่อทำต่อ หรือลบโฟลเดอร์นั้นเพื่อเริ่มใหม่',
      );
    }
    state = newState();
    await deps.store.save(state);
  }

  while (state.phase !== 'DONE' && state.phase !== 'ABORTED') {
    switch (state.phase) {
      case 'REQUIREMENTS':
        await runRequirements(deps, state);
        break;
      case 'DESIGN':
        await runDesign(deps, state);
        break;
      case 'REVIEW':
        await runReview(deps, state);
        break;
      case 'BUILD':
        await runBuild(deps, state);
        break;
      case 'DELIVER':
        await runDeliver(deps, state);
        break;
    }
  }
  return state;
}
