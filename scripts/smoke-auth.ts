import { query } from '@anthropic-ai/claude-agent-sdk';
import { checkStream } from './smoke-auth-lib';

async function main(): Promise<void> {
  const outcome = await checkStream(
    query({
      prompt: 'ตอบสั้น ๆ ว่า OK',
      options: {
        model: 'claude-sonnet-5',
        maxTurns: 1,
        tools: [],
        settingSources: [],
        env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      },
    }),
  );
  if (outcome.ok) {
    console.log(outcome.message);
  } else {
    console.error(outcome.message);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('AUTH/RUN FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
