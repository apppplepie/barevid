import { useEffect, useMemo } from 'react';
import { Loader2, OctagonX, RotateCcw, X } from 'lucide-react';

const CANCEL_COPY: Record<
  string,
  { title: string; description: string; confirm: string }
> = {
  text: {
    title: '取消文案生成',
    description:
      '当前结构化任务会被视为失败并停止（后台若仍在跑将尽快退出）。确定要取消吗？',
    confirm: '取消并标记失败',
  },
  audio: {
    title: '取消配音合成',
    description:
      '正在进行的整稿配音会被标记为失败；若合成仍在进行，可能稍晚才完全停止。确定要取消吗？',
    confirm: '取消并标记失败',
  },
  deck_master: {
    title: '取消母版生成',
    description: '正在进行的演示母版任务将标记为失败。确定要取消吗？',
    confirm: '取消并标记失败',
  },
  pages: {
    title: '取消场景生成',
    description:
      '进行中的场景页任务会被终止，并标记为失败（与顶栏原行为一致）。',
    confirm: '立即取消并标记失败',
  },
  deck_render: {
    title: '取消场景生成',
    description:
      '进行中的场景页任务会被终止，并标记为失败（与顶栏原行为一致）。',
    confirm: '立即取消并标记失败',
  },
  export: {
    title: '取消视频导出',
    description: '正在进行的导出将标记为失败。确定要取消吗？',
    confirm: '取消并标记失败',
  },
};

const REOPEN_COPY: Record<string, { title: string; description: string }> = {
  text: {
    title: '回退文案步骤',
    description:
      '将把文案及之后的配音、演示、导出全部恢复为「未开始」，并切换到手动流水线；可在随后弹出的表单中重新编辑并执行。',
  },
  audio: {
    title: '回退配音步骤',
    description:
      '将把配音及之后的演示、导出恢复为「未开始」，并切换到手动流水线；随后可打开口播确认表单重新跑配音。',
  },
  deck_master: {
    title: '回退母版步骤',
    description:
      '将把母版与场景页、导出恢复为「未开始」，并切换到手动流水线；随后可重新配置母版。',
  },
  deck_render: {
    title: '回退场景页步骤',
    description:
      '将把场景页与导出恢复为「未开始」，并切换到手动流水线；随后可重新触发生成场景页。',
  },
  pages: {
    title: '回退场景生成',
    description:
      '将把演示母版、场景页与导出恢复为「未开始」，并切换到手动流水线；随后可重新配置并生成场景。',
  },
  export: {
    title: '回退导出步骤',
    description:
      '将清除已记录的导出成片状态，使导出恢复为「未开始」；可稍后在顶栏重新导出。',
  },
};

type CancelRunningPipelineStepDialogProps = {
  open: boolean;
  busy: boolean;
  stepId: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function CancelRunningPipelineStepDialog({
  open,
  busy,
  stepId,
  onClose,
  onConfirm,
}: CancelRunningPipelineStepDialogProps) {
  const copy = useMemo(() => {
    const id = stepId || '';
    return CANCEL_COPY[id] ?? {
      title: '取消当前步骤',
      description: '将中止进行中的任务并标记为失败。确定要取消吗？',
      confirm: '取消并标记失败',
    };
  }, [stepId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || !stepId) return null;

  return (
    <div
      className="sf-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-pipeline-title"
        className="w-full max-w-sm rounded-xl border border-zinc-700/90 bg-zinc-900 p-4 shadow-2xl ring-1 ring-zinc-500/30 sm:p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="cancel-pipeline-title"
            className="text-sm font-semibold text-zinc-100 sf-text-primary sm:text-base"
          >
            {copy.title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400 sm:text-sm">
          {copy.description}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="order-2 rounded-lg border border-zinc-700/80 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800/80 sm:px-4 sm:text-sm"
          >
            关闭
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
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

type ReopenSuccessPipelineStepDialogProps = {
  open: boolean;
  busy: boolean;
  stepId: string | null;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ReopenSuccessPipelineStepDialog({
  open,
  busy,
  stepId,
  onClose,
  onConfirm,
}: ReopenSuccessPipelineStepDialogProps) {
  const copy = useMemo(() => {
    const id = stepId || '';
    return REOPEN_COPY[id] ?? {
      title: '回退该步骤',
      description:
        '将把该步骤及之后的流程恢复为「未开始」，并切换到手动流水线。',
    };
  }, [stepId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open || !stepId) return null;

  return (
    <div
      className="sf-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reopen-pipeline-title"
        className="w-full max-w-sm rounded-xl border border-zinc-700/90 bg-zinc-900 p-4 shadow-2xl ring-1 ring-zinc-500/30 sm:p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="reopen-pipeline-title"
            className="text-sm font-semibold text-zinc-100 sm:text-base"
          >
            {copy.title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-zinc-400 sm:text-sm">
          {copy.description}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="order-2 rounded-lg border border-zinc-700/80 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800/80 sm:px-4 sm:text-sm"
          >
            暂不
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 sm:px-4 sm:text-sm"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            确认回退
          </button>
        </div>
      </div>
    </div>
  );
}
