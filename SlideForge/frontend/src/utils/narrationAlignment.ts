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

/** 与 play `narrationAlignment.ts`、export_video 断句一致 */
const SENTENCE_END_RE = /[,，。！？；：.!?:]$/;

function wordEndsSentence(word: string): boolean {
  const t = word.trimEnd();
  if (!t) return false;
  return SENTENCE_END_RE.test(t);
}

export function wordsToSentenceCues(words: DoubaoWordCue[]): NarrationSentenceCue[] {
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

/** 从 words 数组解析字级轴；支持 startTime/endTime 驼峰。 */
function parseWordArrayToCues(words: unknown[]): DoubaoWordCue[] | null {
  const parsed: DoubaoWordCue[] = [];
  for (const item of words) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const st = Number(o.start_time ?? o.startTime);
    const en = Number(o.end_time ?? o.endTime);
    const word = String(o.word ?? '');
    if (!Number.isFinite(st) || !Number.isFinite(en)) continue;
    parsed.push({ start_time: Math.round(st), end_time: Math.round(en), word });
  }
  return parsed.length > 0 ? parsed : null;
}

function parseWordsFromInner(inner: Record<string, unknown>): DoubaoWordCue[] | null {
  const words = inner.words;
  if (!Array.isArray(words) || words.length === 0) return null;
  return parseWordArrayToCues(words);
}

function parseWordsFromAddition(addition: Record<string, unknown>): DoubaoWordCue[] | null {
  const frontendRaw = addition.frontend;
  let inner: unknown;
  if (typeof frontendRaw === 'string' && frontendRaw.trim()) {
    try {
      inner = JSON.parse(frontendRaw);
    } catch {
      return null;
    }
  } else if (frontendRaw && typeof frontendRaw === 'object') {
    inner = frontendRaw;
  } else {
    return null;
  }
  if (!inner || typeof inner !== 'object') return null;
  return parseWordsFromInner(inner as Record<string, unknown>);
}

function sentenceCuesFromAlignmentRoot(root: Record<string, unknown>): NarrationSentenceCue[] | null {
  let addition: unknown = root.addition;
  if (typeof addition === 'string' && addition.trim()) {
    try {
      addition = JSON.parse(addition);
    } catch {
      addition = null;
    }
  }
  if (addition && typeof addition === 'object') {
    const w = parseWordsFromAddition(addition as Record<string, unknown>);
    if (w) return wordsToSentenceCues(w);
  }
  const topWords = root.words;
  if (Array.isArray(topWords) && topWords.length > 0) {
    const w = parseWordArrayToCues(topWords);
    if (w) return wordsToSentenceCues(w);
  }
  return null;
}

export function parseDoubaoSentenceCues(
  alignment: unknown
): NarrationSentenceCue[] | null {
  if (!alignment || typeof alignment !== 'object') return null;
  const root = alignment as Record<string, unknown>;
  const direct = sentenceCuesFromAlignmentRoot(root);
  if (direct) return direct;
  const cacheRaw = root.ingest_json_cache;
  if (typeof cacheRaw === 'string' && cacheRaw.trim()) {
    try {
      const cached = JSON.parse(cacheRaw) as unknown;
      if (cached && typeof cached === 'object') {
        const fromCache = sentenceCuesFromAlignmentRoot(cached as Record<string, unknown>);
        if (fromCache) return fromCache;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function activeSentenceIndex(
  sentences: NarrationSentenceCue[],
  clipElapsedMs: number
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
