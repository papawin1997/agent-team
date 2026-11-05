import { describe, expect, it } from 'vitest';
import { pickUi } from '../../src/tui/select';

const terminal = { stdinTTY: true, stdoutTTY: true, rawMode: true, env: {} };

describe('pickUi', () => {
  it('terminal จริง -> UI ใหม่', () => {
    expect(pickUi(terminal)).toBe('tui');
  });

  it.each([
    { stdinTTY: false },
    { stdoutTTY: false },
    { rawMode: false },
    { env: { AGENT_TEAM_UI: 'classic' } },
  ])('%j -> classic', (over) => {
    expect(pickUi({ ...terminal, ...over })).toBe('classic');
  });

  it('AGENT_TEAM_UI ค่าอื่นไม่มีผล', () => {
    expect(pickUi({ ...terminal, env: { AGENT_TEAM_UI: 'tui' } })).toBe('tui');
  });
});
