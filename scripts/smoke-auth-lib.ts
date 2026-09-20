export interface StreamMessage {
  type: string;
  subtype?: string;
  result?: string;
}

export interface CheckOutcome {
  ok: boolean;
  message: string;
}

export async function checkStream(stream: AsyncIterable<StreamMessage>): Promise<CheckOutcome> {
  for await (const msg of stream) {
    if (msg.type !== 'result') continue;
    if (msg.subtype === 'success') return { ok: true, message: `AUTH OK: ${msg.result ?? ''}` };
    return { ok: false, message: `AUTH/RUN FAILED: ${msg.subtype ?? 'unknown'}` };
  }
  return { ok: false, message: 'AUTH/RUN FAILED: no result message' };
}
