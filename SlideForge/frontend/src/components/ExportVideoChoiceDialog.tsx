import { useEffect } from 'react';
import { Clapperboard, Download, Loader2, X } from 'lucide-react';

type ExportVideoChoiceDialogProps = {
  open: boolean;
  /** 服务端已有成片（与 pipeline.video 一致），才显示「仅下载 / 重新导出」二选一 */
  serverHasVideo: boolean;
  busy: boolean;
  onClose: () => void;
  /** 复用已有 mp4（或未成片时的首次导出） */
  onDownloadOnly: () => void | Promise<void>;
  /** 忽略已有成片，强制重新跑导出 */
  onForceReexport: () => void | Promise<void>;
};

export function ExportVideoChoiceDialog({
  open,
  serverHasVideo,
  busy,
  onClose,
  onDownloadOnly,
  onForceReexport,
}: ExportVideoChoiceDialogProps) {
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
        aria-labelledby="export-choice-title"
        className="w-full max-w-sm rounded-xl border border-zinc-700/90 light:border-slate-200 bg-zinc-900 light:bg-white p-4 shadow-2xl ring-1 ring-black/40 light:ring-slate-200/60 sm:p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="export-choice-title"
            className="text-sm font-semibold text-zinc-100 light:text-slate-900 sm:text-base"
          >
            {serverHasVideo ? '导出成片' : '导出视频'}
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
          {serverHasVideo
            ? '可选择直接下载当前已生成的文件，或重新录制合成（耗时较长）。'
            : '将打开放映页录制并合成视频，可能需要数分钟，请保持页面不要关闭。'}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="order-3 rounded-lg border border-zinc-700/80 light:border-slate-300 px-3 py-2 text-xs font-medium text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-800/80 light:hover:bg-slate-100 sm:order-1 sm:px-4 sm:text-sm"
          >
            取消
          </button>
          {serverHasVideo ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDownloadOnly()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/35 bg-violet-500/10 light:bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-100 light:text-violet-700 transition-colors hover:border-violet-400/45 hover:bg-violet-500/16 light:hover:bg-violet-100 sm:px-4 sm:text-sm"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Download className="h-4 w-4" aria-hidden />
                )}
                仅下载
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onForceReexport()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 sm:px-4 sm:text-sm"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Clapperboard className="h-4 w-4" aria-hidden />
                )}
                重新导出
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDownloadOnly()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 sm:order-2 sm:px-4 sm:text-sm"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Clapperboard className="h-4 w-4" aria-hidden />
              )}
              开始导出
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
