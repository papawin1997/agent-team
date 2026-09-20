import type { Deps } from './deps';
import { nullLogger } from './logger';
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

  const log = deps.log ?? nullLogger;
  log.log('INFO', 'team.start', { resume: opts.resume, phase: state.phase });

  while (state.phase !== 'DONE' && state.phase !== 'ABORTED') {
    const from = state.phase;
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
      default:
        const unreachable: never = state.phase;
        throw new Error(`phase ไม่รู้จักใน state: ${String(unreachable)}`);
    }
    if (state.phase !== from) log.log('INFO', 'phase.change', { from, to: state.phase });
  }
  log.log('INFO', 'team.end', { phase: state.phase });
  return state;
}
