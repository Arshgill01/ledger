import OpenAI, { toFile } from 'openai';

export async function transcribeChunk(client: OpenAI, model: string, audio: Buffer, mime: string, prompt?: string): Promise<string> {
  if (audio.length < 2000) return '';
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'mp4' : mime.includes('wav') ? 'wav' : 'webm';
  const file = await toFile(audio, `chunk.${ext}`, { type: mime });
  const res = await client.audio.transcriptions.create({
    model,
    file,
    language: 'en',
    prompt: prompt?.slice(-500),
    response_format: 'json',
  });
  return (res.text ?? '').trim();
}

export class TranscriptWindow {
  private lines: { at: string; text: string }[] = [];
  constructor(private readonly maxMs = 45_000, private readonly maxLines = 40) {}

  push(text: string, at = new Date().toISOString()): void {
    if (!text.trim()) return;
    this.lines.push({ at, text: text.trim() });
    const cutoff = Date.now() - this.maxMs * 4;
    this.lines = this.lines.filter((l) => new Date(l.at).getTime() >= cutoff).slice(-this.maxLines);
  }

  recent(ms = this.maxMs): string {
    const cutoff = Date.now() - ms;
    return this.lines.filter((l) => new Date(l.at).getTime() >= cutoff).map((l) => l.text).join(' ');
  }

  all(): { at: string; text: string }[] {
    return [...this.lines];
  }
}
