import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Mic } from 'lucide-react';
import { DeckAssistantModule, type DeckAssistantModuleProps } from './DeckAssistantModule';
import {
  NarrationAssistantModule,
  type NarrationAssistantModuleProps,
} from './NarrationAssistantPanel';

export type EditorRightSidebarModule = 'deck' | 'narration';

const MIN_MAIN_WORKSPACE_PX = 200;

export interface EditorRightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  /** 仅由时间轴双击视频/音频切换，不在侧栏内提供页签 */
  activeModule: EditorRightSidebarModule;
  leftSafeOffsetPx?: number;
  defaultOpenWidthRatio?: number;
  maxWidthRatio?: number;
  deck: DeckAssistantModuleProps;
  narration: NarrationAssistantModuleProps;
}

export function EditorRightSidebar({
  isOpen,
  onClose,
  activeModule,
  leftSafeOffsetPx = 326,
  defaultOpenWidthRatio = 0.4,
  maxWidthRatio = 0.6,
  deck,
  narration,
}: EditorRightSidebarProps) {
  const [width, setWidth] = useState(350);
  const panelOpenedOnceRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      panelOpenedOnceRef.current = false;
      return;
    }
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
  }, [isOpen, leftSafeOffsetPx, maxWidthRatio, defaultOpenWidthRatio]);

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

  const deckClipLabel =
    deck.clip?.type === 'video' ? deck.clip.label : null;
  const narrationClipLabel =
    narration.clip?.type === 'audio' ? narration.clip.label : null;
  const contextSubtitle =
    activeModule === 'deck'
      ? deckClipLabel || '未选择演示页'
      : narrationClipLabel || '未选择口播段';

  const layerClass = (visible: boolean) =>
    `absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden ${
      visible ? '' : 'invisible pointer-events-none'
    }`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 260 }}
          style={{ width }}
          className="relative z-40 flex h-full shrink-0 flex-col border-l sf-border-base sf-bg-panel shadow-2xl"
        >
          <div
            className="absolute bottom-0 left-0 top-0 z-50 w-1 cursor-col-resize transition-colors hover:bg-purple-500/40"
            onMouseDown={handleResizeStart}
          />

          <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b sf-border-base sf-bg-card p-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {activeModule === 'deck' ? (
                <Sparkles className="h-4 w-4 shrink-0 text-blue-400" />
              ) : (
                <Mic className="h-4 w-4 shrink-0 text-purple-400" />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium sf-text-primary">
                  {activeModule === 'deck' ? 'AI Deck 草稿' : '口播助理'}
                </h3>
                <p className="truncate text-xs sf-text-muted">{contextSubtitle}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-1.5 sf-text-muted transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
              aria-label="关闭右侧面板"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            <div className={layerClass(activeModule === 'deck')}>
              <React.Fragment key={deck.clip?.id ?? 'deck-none'}>
                <DeckAssistantModule {...deck} />
              </React.Fragment>
            </div>
            <div className={layerClass(activeModule === 'narration')}>
              <React.Fragment key={narration.clip?.id ?? 'narration-none'}>
                <NarrationAssistantModule {...narration} />
              </React.Fragment>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
