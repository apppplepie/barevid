import { Loader2, ListVideo, Server, CheckCircle2, AlertTriangle } from 'lucide-react';

export type VideoExportJobInfo = {
  job_id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  worker_id?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  output_url?: string;
  error_message?: string | null;
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/** 入队即视为「进行中」（排队等 worker 亦为进行中） */
function phaseLabel(
  job: VideoExportJobInfo | null,
  workflowExporting: boolean,
  localDesktopWorker: boolean,
): string {
  if (job?.status === 'succeeded') return '已完成';
  if (job?.status === 'failed') return '失败';
  if (job?.status === 'running') {
    return localDesktopWorker ? '进行中（本机导出）' : '进行中（worker 处理）';
  }
  if (job?.status === 'queued') {
    return localDesktopWorker ? '进行中（本机排队）' : '进行中（排队）';
  }
  if (workflowExporting) return '已提交';
  return '—';
}

function phaseDetail(
  job: VideoExportJobInfo | null,
  workflowExporting: boolean,
  localDesktopWorker: boolean,
): string {
  if (job?.status === 'succeeded') {
    return localDesktopWorker
      ? '本机导出已完成，视频已写入「视频/Barevid」目录。流水线状态稍后会与服务器同步。'
      : 'worker 已成功上传成片，流水线已更新。可使用顶栏下载或下方链接。';
  }
  if (job?.status === 'failed') {
    return (job.error_message || '').trim() || '导出失败，请查看错误信息或重试。';
  }
  if (job?.status === 'running') {
    return localDesktopWorker
      ? '应用内置导出进程正在用浏览器录制画面并调用 ffmpeg 合成，请保持 Barevid 运行（可最小化）。'
      : '远程 worker 已领取任务，正在浏览器中录制与合成。请保持 worker 进程运行。';
  }
  if (job?.status === 'queued') {
    return localDesktopWorker
      ? '任务已进入本机导出队列，即将开始处理。'
      : '任务在服务器队列中，等待 worker 领取；领取后即开始处理。请保持 worker 运行。';
  }
  if (workflowExporting) {
    return localDesktopWorker
      ? '正在拉取本机导出任务状态…'
      : '导出请求已发送，正在与服务器同步任务状态…';
  }
  return '';
}

interface ExportVideoStatusDialogProps {
  open: boolean;
  onClose: () => void;
  job: VideoExportJobInfo | null;
  /** workflow 已标为 exporting 但尚未拿到 job 摘要时 */
  workflowExporting: boolean;
  /** Electron 桌面版：导出由本机子进程完成，非服务器 worker 队列 */
  localDesktopWorker?: boolean;
}

export function ExportVideoStatusDialog({
  open,
  onClose,
  job,
  workflowExporting,
  localDesktopWorker = false,
}: ExportVideoStatusDialogProps) {
  if (!open) return null;

  const title = phaseLabel(job, workflowExporting, localDesktopWorker);
  const detail = phaseDetail(job, workflowExporting, localDesktopWorker);
  const inProgress =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    (workflowExporting && !job);

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 light:bg-slate-900/30 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-status-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-700/90 light:border-slate-200 bg-zinc-950 light:bg-white p-5 shadow-2xl ring-1 ring-black/50 light:ring-slate-200/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={
              job?.status === 'succeeded'
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 light:bg-emerald-100/80 text-emerald-300 light:text-emerald-600'
                : job?.status === 'failed'
                  ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/35 bg-red-500/10 light:bg-red-100/80 text-red-300 light:text-red-600'
                  : inProgress || workflowExporting
                    ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 light:bg-sky-100/80 text-sky-300 light:text-sky-600'
                    : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-600 light:border-slate-300 bg-zinc-800/80 light:bg-slate-100 text-zinc-400 light:text-slate-500'
            }
          >
            {job?.status === 'succeeded' ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            ) : job?.status === 'failed' ? (
              <AlertTriangle className="h-5 w-5" aria-hidden />
            ) : inProgress || workflowExporting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <ListVideo className="h-5 w-5 opacity-60" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="export-status-title" className="text-base font-semibold text-zinc-100 light:text-slate-900">
              视频导出 · {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400 light:text-slate-600">{detail}</p>
          </div>
        </div>

        <dl className="mt-4 space-y-2 rounded-lg border border-zinc-800 light:border-slate-200 bg-zinc-900/50 light:bg-slate-50 px-3 py-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="flex items-center gap-1.5 text-zinc-500 light:text-slate-500">
              <ListVideo className="h-3.5 w-3.5 shrink-0" aria-hidden />
              任务 ID
            </dt>
            <dd className="font-mono text-zinc-200 light:text-slate-800 tabular-nums">
              {job?.job_id != null ? String(job.job_id) : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-500 light:text-slate-500">队列状态</dt>
            <dd className="text-zinc-200 light:text-slate-800">
              {job?.status === 'queued'
                ? localDesktopWorker
                  ? '进行中 · 本机队列'
                  : '进行中 · 等待 worker'
                : job?.status === 'running'
                  ? localDesktopWorker
                    ? '进行中 · 本机导出'
                    : '进行中 · worker 执行'
                  : job?.status === 'succeeded'
                    ? '已完成'
                    : job?.status === 'failed'
                      ? '失败'
                      : workflowExporting
                        ? '同步中'
                        : '—'}
            </dd>
          </div>
          {job?.worker_id ? (
            <div className="flex justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-zinc-500 light:text-slate-500">
                <Server className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Worker
              </dt>
              <dd className="truncate text-right text-zinc-200 light:text-slate-800" title={job.worker_id}>
                {job.worker_id}
              </dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-2">
            <dt className="text-zinc-500 light:text-slate-500">入队时间</dt>
            <dd className="text-right text-zinc-300 light:text-slate-700">{fmtTime(job?.created_at)}</dd>
          </div>
          {job?.status === 'running' || job?.status === 'succeeded' ? (
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 light:text-slate-500">开始处理</dt>
              <dd className="text-right text-zinc-300 light:text-slate-700">{fmtTime(job?.started_at)}</dd>
            </div>
          ) : null}
          {job?.status === 'succeeded' || job?.status === 'failed' ? (
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-500 light:text-slate-500">结束时间</dt>
              <dd className="text-right text-zinc-300 light:text-slate-700">{fmtTime(job?.finished_at)}</dd>
            </div>
          ) : null}
        </dl>

        {localDesktopWorker ? (
          <p className="mt-3 text-xs text-zinc-500 light:text-slate-500">
            桌面版由应用内嵌的导出进程处理（Python/worker.exe + Playwright），无需单独启动远程 worker，也无需配置{' '}
            <code className="rounded bg-zinc-800 light:bg-slate-100 px-1 py-0.5 text-[10px] text-zinc-400 light:text-slate-600">
              EXPORT_WORKER_TOKEN
            </code>
            。
          </p>
        ) : (
          <p className="mt-3 text-xs text-zinc-500 light:text-slate-500">
            若长时间停在排队，请检查 worker 与服务器{' '}
            <code className="rounded bg-zinc-800 light:bg-slate-100 px-1 py-0.5 text-[10px] text-zinc-400 light:text-slate-600">
              EXPORT_WORKER_TOKEN
            </code>{' '}
            是否一致。
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-600 light:border-slate-300 bg-zinc-800 light:bg-slate-100 px-4 py-2 text-sm font-medium text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-700 light:hover:bg-slate-200 hover:text-white light:hover:text-slate-900"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
