// ตัวแปรที่ทำให้ Claude Code คิดเงินนอก subscription (API key / proxy / cloud provider)
// ตัดออกจาก env ที่ส่งให้ agent เพื่อให้ใช้ได้แค่โควตาของ subscription ที่ login ไว้
const BILLING_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
];

// Windows ไม่สนตัวพิมพ์ของชื่อตัวแปร
const isBilling = (name: string): boolean => BILLING_ENV_VARS.includes(name.toUpperCase());

export function agentEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isBilling(name)) continue;
    env[name] = value;
  }
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return env;
}

export function presentBillingVars(source: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(source)
    .filter(([name, value]) => isBilling(name) && value !== undefined && value !== '')
    .map(([name]) => name.toUpperCase());
}
