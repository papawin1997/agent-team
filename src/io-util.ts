import type { UserIO } from './deps';

export async function askNonEmpty(io: UserIO, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await io.ask(prompt)).trim();
    if (answer !== '') return answer;
    io.say('กรุณาพิมพ์ข้อความ (ห้ามเว้นว่าง)');
  }
}
