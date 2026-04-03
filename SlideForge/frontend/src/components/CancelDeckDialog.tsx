import { useEffect } from 'react';
import { Loader2, OctagonX, X } from 'lucide-react';

type CancelDeckDialogProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function CancelDeckDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: CancelDeckDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 light:bg-slate-900/30 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-deck-title"
        className="w-full max-w-sm rounded-xl border border-zinc-700/90 light:border-slate-200 bg-zinc-900 light:bg-white p-4 shadow-2xl ring-1 ring-black/40 light:ring-slate-200/60 sm:p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="cancel-deck-title"
            className="text-sm font-semibold text-zinc-100 light:text-slate-900 sm:text-base"
          >
            取消场景生成
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 light:text-slate-400 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-300 light:hover:text-slate-700 disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400 light:text-slate-600 sm:text-sm">
          确认后，当前"进行中"的场景任务会被立即终止，并标记为失败（原因：用户取消）。
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="order-2 rounded-lg border border-zinc-700/80 light:border-slate-300 px-3 py-2 text-xs font-medium text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-800/80 light:hover:bg-slate-100 sm:px-4 sm:text-sm"
          >
            继续生成
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-500 sm:px-4 sm:text-sm"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <OctagonX className="h-4 w-4" aria-hidden />
            )}
            立即取消并标记失败
          </button>
        </div>
      </div>
    </div>
  );
}
