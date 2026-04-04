import React from 'react';
import { Mic, Loader2, Check, Undo2, Sparkles } from 'lucide-react';
import { ClipData } from '../types';

export interface NarrationAssistantModuleProps {
  clip: ClipData | null;
  baselineText: string;
  draftText: string;
  isResynthesizing: boolean;
  isApplying: boolean;
  errorText: string | null;
  onDraftChange: (next: string) => void;
  onResynthesize: () => void;
  onApply: () => void;
  onDiscard: () => void;
}

/** 编辑器右侧栏内的「口播助理」内容区（不含外壳与页签） */
export function NarrationAssistantModule({
  clip,
  baselineText,
  draftText,
  isResynthesizing,
  isApplying,
  errorText,
  onDraftChange,
  onResynthesize,
  onApply,
  onDiscard,
}: NarrationAssistantModuleProps) {
  const baselineTrim = baselineText.trim();
  const draftTrim = draftText.trim();
  const hasTextChange = draftTrim !== baselineTrim;
  const busy = isResynthesizing || isApplying;

  if (!clip || clip.type !== 'audio') {
    return (
      <div className="sf-narration-assistant-panel flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm sf-text-muted">
        <Mic className="h-8 w-8 shrink-0 text-purple-500/40" />
        <p>
          双击时间轴<strong className="sf-text-secondary">音频轨</strong>上的口播片段，即可在此编辑台词草稿。
        </p>
      </div>
    );
  }

  return (
    <div className="sf-narration-assistant-panel flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <p className="shrink-0 text-xs sf-text-muted">
          使用右侧草稿修改台词；「重新生成」仅按草稿合成新音频（库内正文仍为左侧已保存版，直至点「应用」）。
        </p>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <div className="sf-narration-baseline-card flex min-h-0 flex-col rounded-lg border border-violet-500/30 bg-violet-950/10 p-3">
            <div className="sf-narration-baseline-label mb-2 shrink-0 text-[11px] uppercase tracking-wide text-violet-300">
              已保存台词
            </div>
            <pre className="sf-code-block min-h-0 flex-1 overflow-auto rounded border p-2 font-mono text-xs leading-relaxed sf-text-secondary whitespace-pre-wrap break-words">
              {baselineTrim || '（空）'}
            </pre>
          </div>
          <div className="sf-narration-draft-card flex min-h-0 flex-col rounded-lg border border-purple-500/30 bg-purple-950/10 p-3">
            <div className="sf-narration-draft-label mb-2 shrink-0 text-[11px] uppercase tracking-wide text-purple-300">
              草稿台词
            </div>
            <textarea
              value={draftText}
              onChange={(e) => onDraftChange(e.target.value)}
              placeholder="在此编辑口播草稿…"
              className="sf-code-block min-h-0 flex-1 resize-none overflow-auto rounded border p-2 font-mono text-xs leading-relaxed sf-text-primary focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            />
          </div>
        </div>
        {errorText ? (
          <div className="sf-narration-error-box shrink-0 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1.5 text-xs text-rose-200">
            {errorText}
          </div>
        ) : null}
        {isResynthesizing ? (
          <div className="shrink-0 text-xs sf-text-secondary">正在按草稿重新合成音频…</div>
        ) : null}
        {isApplying ? (
          <div className="shrink-0 text-xs sf-text-secondary">正在保存口播文案…</div>
        ) : null}
      </div>

      <div className="border-t sf-border-base sf-bg-panel p-4">
        <div className="flex flex-wrap items-end justify-end gap-2">
          <button
            type="button"
            onClick={() => onResynthesize()}
            disabled={!draftTrim || busy}
            className="box-border flex h-11 min-w-[132px] flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 px-3 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:opacity-50 sm:flex-initial sm:min-w-[140px]"
          >
            {isResynthesizing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            重新生成
          </button>
          <button
            type="button"
            onClick={() => onApply()}
            disabled={!hasTextChange || busy}
            className="box-border flex h-11 min-w-[100px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 sm:flex-initial sm:min-w-[110px]"
          >
            {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            应用
          </button>
          <button
            type="button"
            onClick={() => onDiscard()}
            disabled={busy}
            className="sf-narration-discard-btn box-border flex h-11 min-w-[100px] flex-1 items-center justify-center gap-2 rounded-lg border sf-border-base px-3 text-sm sf-text-primary transition-colors disabled:opacity-50 sm:flex-initial sm:min-w-[110px]"
          >
            <Undo2 className="h-4 w-4" />
            丢弃
          </button>
        </div>
      </div>
    </div>
  );
}
