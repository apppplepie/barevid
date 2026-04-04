import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export function TtsVoiceSelect({
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuIdRef = useRef(
    `tts-voice-menu-${Math.random().toString(36).slice(2, 9)}`,
  );
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setMenuRect(null);
      return;
    }
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 6;
      const maxH = Math.min(
        520,
        Math.max(160, window.innerHeight - r.bottom - gap - 16),
      );
      setMenuRect({
        top: r.bottom + gap,
        left: r.left,
        width: r.width,
        maxHeight: maxH,
      });
    };
    measure();
    const onScroll = (ev: Event) => {
      const panel = document.getElementById(menuIdRef.current);
      const t = ev.target;
      if (
        panel &&
        t instanceof Node &&
        (panel === t || panel.contains(t))
      ) {
        return;
      }
      setOpen(false);
    };
    const onResize = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      const menuEl = document.getElementById(menuIdRef.current);
      if (menuEl?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const emptyOrLoading = loading || options.length === 0;
  const selectedLabel = emptyOrLoading
    ? '加载音色列表…'
    : options.find((o) => o.value === value)?.label ?? '—';

  const triggerDisabled = disabled || emptyOrLoading;

  const menu =
    open && !emptyOrLoading && menuRect
      ? createPortal(
          <div
            id={menuIdRef.current}
            role="listbox"
            className="sf-dialog-shell sf-scrollbar-visible fixed z-[200] overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border py-1 ring-1 ring-purple-500/10 backdrop-blur-md light:ring-purple-500/20"
            onWheel={(e) => e.stopPropagation()}
            style={{
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              maxHeight: menuRect.maxHeight,
            }}
          >
            <ul className="py-0.5">
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <li key={opt.value || '__default__'} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
                        selected
                          ? 'bg-purple-500/25 text-purple-100 light:bg-violet-100 light:text-violet-900'
                          : 'sf-text-primary hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]'
                      }`}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {selected ? (
                        <Check
                          className="h-4 w-4 shrink-0 text-purple-300 light:text-violet-700"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                      ) : (
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <button
        ref={triggerRef}
        type="button"
        disabled={triggerDisabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (triggerDisabled) return;
          setOpen((o) => !o);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-[border-color,box-shadow,background-color] sf-text-primary ${
          open
            ? 'border-purple-500/50 bg-[var(--sf-input-bg)] shadow-[0_0_0_1px_rgba(168,85,247,0.2)] ring-2 ring-purple-500/25 light:ring-purple-400/35'
            : 'border-[var(--sf-input-border)] bg-[var(--sf-input-bg)] shadow-inner hover:border-[var(--sf-chip-neutral-hover-border)]'
        } ${triggerDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        <span className="min-w-0 truncate font-medium">{selectedLabel}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 sf-text-muted transition-transform duration-200 ${
            open ? 'rotate-180 text-purple-400/90 light:text-purple-600' : ''
          }`}
          aria-hidden
        />
      </button>
      {menu}
    </div>
  );
}
