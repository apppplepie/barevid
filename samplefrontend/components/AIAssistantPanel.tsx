import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, Check, Undo2 } from 'lucide-react';
import { format } from 'prettier/standalone';
import * as parserHtml from 'prettier/plugins/html';
import * as parserPostcss from 'prettier/plugins/postcss';
import * as parserBabel from 'prettier/plugins/babel';
import * as parserEstree from 'prettier/plugins/estree';
import { ClipData } from '../types';

export interface DeckAssistantModuleProps {
  clip: ClipData | null;
  contextHtmlText: string;
  draftHtmlText: string | null;
  isGenerating: boolean;
  errorText: string | null;
  onGenerate: (instruction: string) => void;
  onApplyChanges: () => void;
  onDiscardDraft: () => void;
  onDraftChange: (nextHtml: string) => void;
}

async function prettyHtml(html?: string | null) {
  if (!html) return '';
  try {
    return await format(html, {
      parser: 'html',
      plugins: [parserHtml, parserPostcss, parserBabel, parserEstree],
      embeddedLanguageFormatting: 'auto',
    });
  } catch {
    return html;
  }
}

/** 编辑器右侧栏内的「AI Deck 草稿」内容区（不含外壳与页签） */
export function DeckAssistantModule({
  clip,
  contextHtmlText,
  draftHtmlText,
  isGenerating,
  errorText,
  onGenerate,
  onApplyChanges,
  onDiscardDraft,
  onDraftChange,
}: DeckAssistantModuleProps) {
  const [input, setInput] = useState('');
  const [prettyContextHtmlText, setPrettyContextHtmlText] = useState(contextHtmlText);
  const [draftInputText, setDraftInputText] = useState(draftHtmlText ?? '');
  const [isFormattingDraft, setIsFormattingDraft] = useState(false);
  const hasDraft = Boolean(draftHtmlText);

  useEffect(() => {
    let cancelled = false;
    const updatePrettyContext = async () => {
      const formatted = await prettyHtml(contextHtmlText);
      if (!cancelled) {
        setPrettyContextHtmlText(formatted);
      }
    };
    void updatePrettyContext();
    return () => {
      cancelled = true;
    };
  }, [contextHtmlText]);

  useEffect(() => {
    setDraftInputText(draftHtmlText ?? '');
  }, [draftHtmlText]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const instruction = input.trim();
    if (!instruction || !clip || isGenerating) return;
    onGenerate(instruction);
  };

  const handleFormatDraft = async () => {
    if (!draftInputText.trim() || isFormattingDraft) return;
    setIsFormattingDraft(true);
    try {
      const formatted = await prettyHtml(draftInputText);
      setDraftInputText(formatted);
      onDraftChange(formatted);
    } finally {
      setIsFormattingDraft(false);
    }
  };

  if (!clip || clip.type !== 'video') {
    return (
      <div className="sf-ai-assistant-panel flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm sf-text-muted">
        <Sparkles className="h-8 w-8 shrink-0 text-blue-500/40" />
        <p>
          双击时间轴<strong className="sf-text-secondary">视频轨</strong>上的演示大页，即可在此编辑该页的 HTML 草稿。
        </p>
      </div>
    );
  }

  return (
    <div className="sf-ai-assistant-panel flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
          <div className="sf-ai-baseline-card flex min-h-0 flex-col rounded-lg border border-blue-500/30 bg-blue-950/10 p-3">
            <div className="sf-ai-baseline-label mb-2 shrink-0 text-[11px] uppercase tracking-wide text-blue-300">
              已保存 HTML（Baseline）
            </div>
            <pre className="sf-code-block min-h-0 flex-1 overflow-auto rounded border p-2 font-mono text-xs leading-relaxed sf-text-secondary whitespace-pre-wrap break-all">
              {prettyContextHtmlText || '暂无 HTML'}
            </pre>
          </div>
          <div className="sf-ai-draft-card flex min-h-0 flex-col rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-3">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div className="sf-ai-draft-label text-[11px] uppercase tracking-wide text-emerald-300">
                可编辑草稿 HTML（Draft）
              </div>
              <button
                type="button"
                onClick={() => void handleFormatDraft()}
                disabled={!draftInputText.trim() || isFormattingDraft}
                className="sf-ai-format-btn inline-flex h-6 items-center justify-center rounded border border-emerald-400/30 px-2 text-[11px] text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {isFormattingDraft ? '格式化中…' : '格式化'}
              </button>
            </div>
            <textarea
              value={draftInputText}
              onChange={(e) => {
                const next = e.target.value;
                setDraftInputText(next);
                onDraftChange(next);
              }}
              placeholder="可在此手动编辑草稿 HTML"
              className="sf-code-block min-h-0 flex-1 resize-none overflow-auto rounded border p-2 font-mono text-xs leading-relaxed sf-text-primary focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
            />
          </div>
        </div>
        {errorText ? (
          <div className="sf-ai-error-box shrink-0 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1.5 text-xs text-rose-200">
            {errorText}
          </div>
        ) : null}
        {isGenerating ? (
          <div className="shrink-0 text-xs sf-text-secondary">AI 正在生成草稿…</div>
        ) : null}
      </div>

      <div className="border-t sf-border-base sf-bg-panel p-4">
        <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
          <form
            onSubmit={handleSubmit}
            className="box-border flex min-h-11 min-w-0 flex-[2_1_280px] flex-col justify-end"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
              }}
              placeholder="描述你希望如何修改当前片段（只针对当前 deck）"
              rows={1}
              className="sf-ai-instruction-input box-border min-h-11 max-h-[220px] w-full resize-none overflow-y-auto rounded-lg border sf-border-base sf-bg-card px-3 py-2.5 text-sm leading-snug sf-text-primary transition-all focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
            />
          </form>
          <div className="flex min-h-11 shrink-0 flex-wrap items-end justify-end gap-2 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isGenerating}
              className="box-border flex h-11 min-w-[132px] flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50 sm:flex-initial sm:min-w-[140px]"
            >
              {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              重新生成
            </button>
            <button
              type="button"
              onClick={onApplyChanges}
              disabled={!hasDraft || isGenerating}
              className="box-border flex h-11 min-w-[100px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 sm:flex-initial sm:min-w-[110px]"
            >
              <Check className="h-4 w-4" />
              应用
            </button>
            <button
              type="button"
              onClick={onDiscardDraft}
              disabled={!hasDraft || isGenerating}
              className="sf-ai-discard-btn box-border flex h-11 min-w-[100px] flex-1 items-center justify-center gap-2 rounded-lg border sf-border-base px-3 text-sm sf-text-primary transition-colors disabled:opacity-50 sm:flex-initial sm:min-w-[110px]"
            >
              <Undo2 className="h-4 w-4" />
              丢弃
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
