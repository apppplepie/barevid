/**
 * 豆包 TTS HTTP V1：addition.frontend 内嵌 JSON，含 words[].start_time/end_time/word（毫秒，相对本段音频）。
 */

export type DoubaoWordCue = {
  start_time: number;
  end_time: number;
  word: string;
};

export type NarrationSentenceCue = {
  text: string;
  start_ms: number;
  end_ms: number;
};

const SENTENCE_END_RE = /[,，。！？；：.!?:]$/;

function wordEndsSentence(word: string): boolean {
  const t = word.trimEnd();
  if (!t) return false;
  return SENTENCE_END_RE.test(t);
}

export function wordsToSentenceCues(
  words: DoubaoWordCue[],
): NarrationSentenceCue[] {
  const out: NarrationSentenceCue[] = [];
  let buf: DoubaoWordCue[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      text: buf.map((w) => w.word).join(''),
      start_ms: buf[0].start_time,
      end_ms: buf[buf.length - 1].end_time,
    });
    buf = [];
  };

  for (const w of words) {
    buf.push(w);
    if (wordEndsSentence(w.word)) flush();
  }
  flush();
  return out;
}

function parseWordsFromAddition(
  addition: Record<string, unknown>,
): DoubaoWordCue[] | null {
  const frontendRaw = addition.frontend;
  if (typeof frontendRaw !== 'string' || !frontendRaw.trim()) return null;
  let inner: unknown;
  try {
    inner = JSON.parse(frontendRaw);
  } catch {
    return null;
  }
  if (!inner || typeof inner !== 'object') return null;
  const words = (inner as Record<string, unknown>).words;
  if (!Array.isArray(words) || words.length === 0) return null;

  const parsed: DoubaoWordCue[] = [];
  for (const item of words) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const st = Number(o.start_time);
    const en = Number(o.end_time);
    const word = String(o.word ?? '');
    if (!Number.isFinite(st) || !Number.isFinite(en)) continue;
    parsed.push({ start_time: st, end_time: en, word });
  }
  return parsed.length > 0 ? parsed : null;
}

/**
 * 从 play-manifest 下发的 narration_alignment 对象解析句级时间轴；失败返回 null。
 */
export function parseDoubaoSentenceCues(
  alignment: unknown,
): NarrationSentenceCue[] | null {
  if (!alignment || typeof alignment !== 'object') return null;
  const root = alignment as Record<string, unknown>;
  const addition = root.addition;
  if (!addition || typeof addition !== 'object') return null;
  const words = parseWordsFromAddition(addition as Record<string, unknown>);
  if (!words) return null;
  return wordsToSentenceCues(words);
}

/**
 * 根据本段内已播放毫秒数，返回当前应高亮的句子下标。
 */
export function activeSentenceIndex(
  sentences: NarrationSentenceCue[],
  clipElapsedMs: number,
): number {
  if (sentences.length === 0) return -1;
  const t = clipElapsedMs;
  if (t < sentences[0].start_ms) return 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (t >= s.start_ms && t <= s.end_ms) return i;
  }
  for (let i = 0; i < sentences.length - 1; i++) {
    if (t > sentences[i].end_ms && t < sentences[i + 1].start_ms) return i;
  }
  return sentences.length - 1;
}
