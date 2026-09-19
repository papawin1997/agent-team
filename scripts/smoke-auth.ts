import { query } from '@anthropic-ai/claude-agent-sdk';

async function main(): Promise<void> {
  for await (const msg of query({
    prompt: 'ตอบสั้น ๆ ว่า OK',
    options: {
      model: 'claude-sonnet-5',
      maxTurns: 1,
      tools: [],
      settingSources: [],
      env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
    },
  })) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        console.log('AUTH OK:', msg.result);
        return;
      }
      console.error('AUTH/RUN FAILED:', msg.subtype);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error('AUTH/RUN FAILED:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
