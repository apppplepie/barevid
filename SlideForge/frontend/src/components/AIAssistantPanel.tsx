import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Loader2, Check, Undo2 } from 'lucide-react';
import { format } from 'prettier/standalone';
import * as parserHtml from 'prettier/plugins/html';
import * as parserPostcss from 'prettier/plugins/postcss';
import * as parserBabel from 'prettier/plugins/babel';
import * as parserEstree from 'prettier/plugins/estree';
import { ClipData } from '../types';

interface AIAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  clip: ClipData | null;
  leftSafeOffsetPx?: number;
  contextHtmlText: string;
  draftHtmlText: string | null;
  isGenerating: boolean;
  errorText: string | null;
  onGenerate: (instruction: string) => void;
  onApplyChanges: () => void;
  onDiscardDraft: () => void;
  onDraftChange: (nextHtml: string) => void;
  /** 打开面板时的默认宽度占 .ai-panel-host 宽度的比例 */
  defaultOpenWidthRatio?: number;
  maxWidthRatio?: number;
}

const MIN_MAIN_WORKSPACE_PX = 200;

async function prettyHtml(html?: string | null) {
  if (!html) return '';
  try {
    return await format(html, {
      parser: 'html',
      // 内嵌 <style>/<script> 需要对应插件，否则内容可能保持一整行
      plugins: [parserHtml, parserPostcss, parserBabel, parserEstree],
      embeddedLanguageFormatting: 'auto',
    });
  } catch {
    return html;
  }
}

export function AIAssistantPanel({
  isOpen,
  onClose,
  clip,
  leftSafeOffsetPx = 326,
  contextHtmlText,
  draftHtmlText,
  isGenerating,
  errorText,
  onGenerate,
  onApplyChanges,
  onDiscardDraft,
  onDraftChange,
  defaultOpenWidthRatio = 0.4,
  maxWidthRatio = 0.6,
}: AIAssistantPanelProps) {
  const [width, setWidth] = useState(350);
  const panelOpenedOnceRef = useRef(false);
  const [input, setInput] = useState('');
  const [prettyContextHtmlText, setPrettyContextHtmlText] = useState(contextHtmlText);
  const [draftInputText, setDraftInputText] = useState(draftHtmlText ?? '');
  const [isFormattingDraft, setIsFormattingDraft] = useState(false);
  const hasDraft = Boolean(draftHtmlText);

  useEffect(() => {
    if (!isOpen) {
      panelOpenedOnceRef.current = false;
      return;
    }
    if (!clip) return;
    if (!panelOpenedOnceRef.current) {
      panelOpenedOnceRef.current = true;
      const applyOpenWidth = () => {
        const host = document.querySelector('.ai-panel-host') as HTMLElement | null;
        const parentWidth = host?.getBoundingClientRect().width ?? window.innerWidth;
        const maxByRatio = parentWidth * maxWidthRatio;
        const maxByLeftSafe =
          parentWidth - leftSafeOffsetPx - MIN_MAIN_WORKSPACE_PX;
        const maxWidth = Math.max(320, Math.min(maxByRatio, maxByLeftSafe));
        const target = Math.round(parentWidth * defaultOpenWidthRatio);
        setWidth(Math.max(320, Math.min(maxWidth, target)));
      };
      applyOpenWidth();
      const raf = requestAnimationFrame(applyOpenWidth);
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen, clip, leftSafeOffsetPx, maxWidthRatio, defaultOpenWidthRatio]);

  useEffect(() => {
    if (!isOpen) return;
    const clampWidth = () => {
      const host = document.querySelector('.ai-panel-host') as HTMLElement | null;
      const parentWidth = host?.getBoundingClientRect().width ?? window.innerWidth;
      const maxByRatio = parentWidth * maxWidthRatio;
      const maxByLeftSafe =
        parentWidth - leftSafeOffsetPx - MIN_MAIN_WORKSPACE_PX;
      const maxWidth = Math.max(320, Math.min(maxByRatio, maxByLeftSafe));
      setWidth((prev) => Math.min(prev, maxWidth));
    };
    clampWidth();
    window.addEventListener('resize', clampWidth);
    return () => window.removeEventListener('resize', clampWidth);
  }, [isOpen, leftSafeOffsetPx, maxWidthRatio]);

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

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const parentEl = (moveEvent.target as HTMLElement | null)?.closest(
        '.ai-panel-host',
      ) as HTMLElement | null;
      const parentWidth =
        parentEl?.getBoundingClientRect().width ?? window.innerWidth;
      const maxByRatio = parentWidth * maxWidthRatio;
      const maxByLeftSafe =
        parentWidth - leftSafeOffsetPx - MIN_MAIN_WORKSPACE_PX;
      const maxWidth = Math.max(320, Math.min(maxByRatio, maxByLeftSafe));
      const newWidth = Math.max(320, Math.min(maxWidth, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

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

  return (
    <AnimatePresence>
      {isOpen && clip && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          style={{ width }}
          className="relative h-full shrink-0 bg-[#1e1e1e] border-l border-white/10 shadow-2xl z-40 flex flex-col"
        >
          {/* Resize Handle */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-50"
            onMouseDown={handleResizeStart}
          />

          {/* Header */}
          <div className="flex min-w-0 items-center justify-between gap-2 border-b border-white/10 bg-[#252525] p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-blue-400" />
              <h3 className="truncate text-sm font-medium">AI 草稿面板</h3>
            </div>
            <div className="flex min-w-0 max-w-[55%] shrink items-center gap-2">
              <div className="truncate text-right text-sm font-medium text-zinc-300">
                {clip.label}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>


          {/* Conversation / Structure Area：占满中间高度，左右 HTML 对照 */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <div className="flex min-h-0 flex-col rounded-lg border border-blue-500/30 bg-blue-950/10 p-3">
                <div className="mb-2 shrink-0 text-[11px] uppercase tracking-wide text-blue-300">
                  已保存 HTML（Baseline）
                </div>
                <pre className="min-h-0 flex-1 overflow-auto rounded border border-white/10 bg-black/20 p-2 font-mono text-xs leading-relaxed text-gray-300 whitespace-pre-wrap break-all">
                  {prettyContextHtmlText || '暂无 HTML'}
                </pre>
              </div>
              <div className="flex min-h-0 flex-col rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-3">
                <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wide text-emerald-300">
                    可编辑草稿 HTML（Draft）
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleFormatDraft()}
                    disabled={!draftInputText.trim() || isFormattingDraft}
                    className="inline-flex h-6 items-center justify-center rounded border border-emerald-400/30 px-2 text-[11px] text-emerald-200 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
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
                  className="min-h-0 flex-1 resize-none overflow-auto rounded border border-white/10 bg-black/20 p-2 font-mono text-xs leading-relaxed text-gray-200 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
            </div>
            {errorText ? (
              <div className="shrink-0 rounded border border-rose-500/30 bg-rose-950/20 px-2 py-1.5 text-xs text-rose-200">
                {errorText}
              </div>
            ) : null}
            {isGenerating ? (
              <div className="shrink-0 text-xs text-zinc-400">AI 正在生成草稿…</div>
            ) : null}
          </div>

          {/* Input Area：输入框与按钮组底对齐；宽度不足时整块换行 */}
          <div className="border-t border-white/10 bg-[#252525] p-4">
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
                  className="box-border min-h-11 max-h-[220px] w-full resize-none overflow-y-auto rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2.5 text-sm leading-snug text-zinc-100 transition-all placeholder:text-gray-500 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
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
                  className="box-border flex h-11 min-w-[100px] flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 px-3 text-sm text-zinc-200 transition-colors hover:bg-white/5 disabled:opacity-50 sm:flex-initial sm:min-w-[110px]"
                >
                  <Undo2 className="h-4 w-4" />
                  丢弃
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
