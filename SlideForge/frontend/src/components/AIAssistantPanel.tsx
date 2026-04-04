import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles } from 'lucide-react';
import { DeckAssistantModule } from './DeckAssistantModule';
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
  defaultOpenWidthRatio?: number;
  maxWidthRatio?: number;
}

const MIN_MAIN_WORKSPACE_PX = 200;

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

  return (
    <AnimatePresence>
      {isOpen && clip && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          style={{ width }}
          className="relative z-40 flex h-full shrink-0 flex-col border-l sf-border-base sf-bg-panel shadow-xl"
        >
          <div
            className="absolute bottom-0 left-0 top-0 z-50 w-1 cursor-col-resize transition-colors hover:bg-blue-500/45"
            onMouseDown={handleResizeStart}
          />

          <div className="flex min-w-0 items-center justify-between gap-2 border-b sf-border-base sf-bg-card p-4">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-blue-400 light:text-blue-600" />
              <h3 className="truncate text-sm font-medium sf-text-primary">AI 草稿面板</h3>
            </div>
            <div className="flex min-w-0 max-w-[55%] shrink items-center gap-2">
              <div className="truncate text-right text-sm font-medium sf-text-secondary">
                {clip.label}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-md p-1.5 sf-text-muted transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <DeckAssistantModule
            clip={clip}
            contextHtmlText={contextHtmlText}
            draftHtmlText={draftHtmlText}
            isGenerating={isGenerating}
            errorText={errorText}
            onGenerate={onGenerate}
            onApplyChanges={onApplyChanges}
            onDiscardDraft={onDiscardDraft}
            onDraftChange={onDraftChange}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
