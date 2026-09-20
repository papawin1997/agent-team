import { query } from '@anthropic-ai/claude-agent-sdk';
import { agentEnv } from '../src/env';
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
        env: agentEnv(),
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
