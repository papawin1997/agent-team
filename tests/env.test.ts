import { describe, expect, it } from 'vitest';
import { agentEnv, presentBillingVars } from '../src/env';

describe('agentEnv', () => {
  it('ตัด credential/route ที่ทำให้คิดเงินแบบ API ออก แต่เก็บตัวแปรอื่นไว้', () => {
    const env = agentEnv({
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      PATH: '/usr/bin',
      HOME: '/home/u',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/u');
  });

  it('ไม่แตะ OAuth token ของ subscription', () => {
    const env = agentEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth');
  });

  it('ตัดชื่อตัวแปรแบบไม่สนตัวพิมพ์ (Windows) และเพิ่ม CLAUDE_CODE_DISABLE_AUTO_MEMORY=1', () => {
    const env = agentEnv({ Anthropic_Api_Key: 'sk-ant-secret' });
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('ANTHROPIC_API_KEY');
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
  });

  it('ข้ามค่า undefined และไม่แก้ env ต้นฉบับ', () => {
    const source: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'k', KEEP: 'x', GONE: undefined };
    const env = agentEnv(source);
    expect('GONE' in env).toBe(false);
    expect(source.ANTHROPIC_API_KEY).toBe('k');
  });
});

describe('presentBillingVars', () => {
  it('คืนชื่อตัวแปรที่ถูกตัด (ไม่คืนค่า)', () => {
    expect(presentBillingVars({ ANTHROPIC_API_KEY: 'sk-ant-secret', PATH: 'x' })).toEqual([
      'ANTHROPIC_API_KEY',
    ]);
  });

  it('ไม่นับตัวแปรที่ว่างเปล่า', () => {
    expect(presentBillingVars({ ANTHROPIC_API_KEY: '', PATH: 'x' })).toEqual([]);
  });
});
