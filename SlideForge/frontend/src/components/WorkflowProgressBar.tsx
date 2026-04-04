import type { ElementType } from 'react';
import {
  Check,
  AlertTriangle,
  Clock,
  Loader2,
  Download,
  RotateCw,
} from 'lucide-react';
import { motion } from 'motion/react';
import { workflowStepDependenciesSatisfied } from '../utils/workflowStepDependencies';

export type StepState = 'pending' | 'waiting' | 'running' | 'success' | 'error';

const STEP_STATE_LABEL_ZH: Record<StepState, string> = {
  pending: '待处理',
  waiting: '等待中',
  running: '进行中',
  success: '已完成',
  error: '失败',
};

function stepStateLabelZh(state: StepState): string {
  return STEP_STATE_LABEL_ZH[state] ?? state;
}

export interface WorkflowStep {
  id: string;
  label: string;
  state: StepState;
  icon: ElementType;
}

interface WorkflowProgressBarProps {
  steps: WorkflowStep[];
  /** 前置步骤均成功且当前无进行中的导出时可点（未完成导出时为「导出」，已有成片时为「下载」） */
  downloadEnabled: boolean;
  /** 后端 pipeline.video 为 true 时表示已有成片，按钮文案为「下载」；否则为「导出」 */
  videoReady: boolean;
  /** 正在请求导出/下载接口，或服务端 export 步骤为进行中 */
  downloadLoading?: boolean;
  onDownloadClick: () => void;
  /** 失败步骤点击重试（由父组件映射到具体 API） */
  onRetryStep?: (stepId: string) => void;
  /** 正在重试的步骤 id，显示 loading */
  retryingStepId?: string | null;
  /** 运行中步骤点击取消（例如场景生成） */
  onCancelRunningStep?: (stepId: string) => void;
  /** 正在取消的步骤 id */
  cancellingStepId?: string | null;
  /** 与 derive 手动闸门一致；用于判断「前置已满足、待用户操作」 */
  pipelineAutoAdvance?: boolean;
  manualOutlineConfirmed?: boolean;
  /** 已完成步骤点击后打开回退确认（由父组件接 `openConfirmDialog('reopen', id)`） */
  onRequestReopenSuccessStep?: (stepId: string) => void;
  /** 回退 API 执行中，对应步骤圆标显示加载 */
  reopeningWorkflowStepId?: string | null;
}

export function WorkflowProgressBar({
  steps,
  downloadEnabled,
  videoReady,
  downloadLoading = false,
  onDownloadClick,
  onRetryStep,
  retryingStepId = null,
  onCancelRunningStep,
  cancellingStepId = null,
  pipelineAutoAdvance = true,
  manualOutlineConfirmed = true,
  onRequestReopenSuccessStep,
  reopeningWorkflowStepId = null,
}: WorkflowProgressBarProps) {
  const manualBlocked =
    pipelineAutoAdvance === false && !manualOutlineConfirmed;
  const exportIdx = steps.findIndex((s) => s.id === 'export');
  const exportStep = exportIdx >= 0 ? steps[exportIdx] : null;

  return (
    <div
      className="flex min-w-0 w-full max-w-full items-center justify-end gap-1 sm:gap-1.5"
      role="list"
      aria-label="制作进度"
    >
      <div className="min-w-0 flex-1 overflow-x-auto overflow-y-visible py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="ml-auto flex w-max items-center gap-1 sm:gap-1.5">
          {steps.map((step) => {
            const isSuccess = step.state === 'success';
            const isRunning = step.state === 'running';
            const isError = step.state === 'error';
            const isWaiting = step.state === 'waiting';
            const Icon = step.icon;
            const canCancelRunning = isRunning && Boolean(onCancelRunningStep);
            const isPending =
              !isSuccess && !isRunning && !isError;
            const canStartFromGraph =
              Boolean(onRetryStep) &&
              step.id !== 'export' &&
              isPending &&
              workflowStepDependenciesSatisfied(step.id, steps, manualBlocked);

            return (
              <div key={step.id} className="flex items-center">
                <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                  <div
                    role="listitem"
                    className="flex min-w-0 items-center gap-1.5 rounded-full px-1.5 py-0.5 sm:gap-2 sm:px-2 sm:py-1"
                    title={`${step.label} · ${stepStateLabelZh(step.state)}`}
                  >
                    <div
                      className={[
                        'relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 sm:h-7 sm:w-7',
                        isSuccess && 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
                        isRunning && 'border-sky-500/40 bg-sky-500/10 text-sky-200',
                        isError && 'border-red-500/35 bg-red-500/10 text-red-300',
                        (isWaiting || canStartFromGraph) &&
                          'border-cyan-500/35 bg-cyan-500/10 text-cyan-200 light:border-cyan-600/40 light:bg-cyan-100/80 light:text-cyan-900',
                        !isSuccess &&
                          !isRunning &&
                          !isError &&
                          !isWaiting &&
                          !canStartFromGraph &&
                          'border-zinc-700/80 light:border-slate-300 bg-zinc-900/80 light:bg-slate-100 text-sf-muted',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {isRunning ? (
                        <>
                          <motion.span
                            className="absolute inset-0 rounded-full border border-sky-400/25"
                            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                            transition={{
                              duration: 1.8,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                          />
                          {canCancelRunning ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (cancellingStepId === step.id) return;
                                onCancelRunningStep?.(step.id);
                              }}
                              disabled={cancellingStepId === step.id}
                              title={`${step.label} 进行中，点击取消`}
                              className="relative flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-sky-500/20 focus-visible:ring-2 focus-visible:ring-sky-400/50 disabled:opacity-50"
                            >
                              <Loader2
                                className="h-3 w-3 animate-spin opacity-90 sm:h-3.5 sm:w-3.5"
                                aria-hidden
                              />
                            </button>
                          ) : (
                            <Loader2
                              className="relative h-3 w-3 animate-spin opacity-90 sm:h-3.5 sm:w-3.5"
                              aria-hidden
                            />
                          )}
                        </>
                      ) : isSuccess ? (
                        onRequestReopenSuccessStep ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (reopeningWorkflowStepId === step.id) return;
                              onRequestReopenSuccessStep(step.id);
                            }}
                            disabled={reopeningWorkflowStepId === step.id}
                            title={`${step.label} 已完成，点击回退（需确认）`}
                            aria-label={`${step.label} 已完成，点击回退`}
                            className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-400/50 disabled:opacity-50"
                          >
                            {reopeningWorkflowStepId === step.id ? (
                              <Loader2
                                className="h-3 w-3 animate-spin sm:h-3.5 sm:w-3.5"
                                aria-hidden
                              />
                            ) : (
                              <Check
                                className="h-3 w-3 stroke-[2.5] sm:h-3.5 sm:w-3.5"
                                strokeLinecap="round"
                                aria-hidden
                              />
                            )}
                          </button>
                        ) : (
                          <Check
                            className="h-3 w-3 stroke-[2.5] sm:h-3.5 sm:w-3.5"
                            strokeLinecap="round"
                            aria-hidden
                          />
                        )
                      ) : isError ? (
                        onRetryStep ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (retryingStepId === step.id) return;
                              onRetryStep(step.id);
                            }}
                            disabled={retryingStepId === step.id}
                            title={`${step.label} 失败，点击重试`}
                            className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-red-400/50 disabled:opacity-50"
                          >
                            {retryingStepId === step.id ? (
                              <Loader2
                                className="h-3 w-3 animate-spin sm:h-3.5 sm:w-3.5"
                                aria-hidden
                              />
                            ) : (
                              <RotateCw
                                className="h-3 w-3 sm:h-3.5 sm:w-3.5"
                                aria-hidden
                              />
                            )}
                          </button>
                        ) : (
                          <AlertTriangle className="h-3 w-3 sm:h-3.5 sm:w-3.5" aria-hidden />
                        )
                      ) : canStartFromGraph ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (retryingStepId === step.id) return;
                            onRetryStep?.(step.id);
                          }}
                          disabled={retryingStepId === step.id}
                          title={`等待操作，点击开始：${step.label}`}
                          className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-cyan-500/20 focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50"
                        >
                          {retryingStepId === step.id ? (
                            <Loader2
                              className="h-3 w-3 animate-spin sm:h-3.5 sm:w-3.5"
                              aria-hidden
                            />
                          ) : (
                            <Clock
                              className="h-3 w-3 opacity-90 sm:h-3.5 sm:w-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                          )}
                        </button>
                      ) : isWaiting &&
                        Boolean(onRetryStep) &&
                        step.id !== 'export' &&
                        (step.id === 'audio' ||
                          workflowStepDependenciesSatisfied(
                            step.id,
                            steps,
                            manualBlocked,
                          )) ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (retryingStepId === step.id) return;
                            onRetryStep?.(step.id);
                          }}
                          disabled={retryingStepId === step.id}
                          title={`等待操作，点击打开：${step.label}`}
                          className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-cyan-500/20 focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50"
                        >
                          {retryingStepId === step.id ? (
                            <Loader2
                              className="h-3 w-3 animate-spin sm:h-3.5 sm:h-3.5"
                              aria-hidden
                            />
                          ) : (
                            <Clock
                              className="h-3 w-3 opacity-90 sm:h-3.5 sm:w-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                          )}
                        </button>
                      ) : isWaiting ? (
                        <Clock
                          className="h-3 w-3 opacity-90 sm:h-3.5 sm:w-3.5"
                          strokeWidth={2}
                          aria-hidden
                        />
                      ) : (
                        <Icon className="h-3 w-3 opacity-70 sm:h-3.5 sm:w-3.5" aria-hidden />
                      )}
                    </div>
                    <span
                      className={[
                        'inline max-w-[2.25rem] truncate text-[9px] font-medium tracking-wide sm:max-w-[5.5rem] sm:text-[11px]',
                        isSuccess && 'text-zinc-200 light:text-slate-700',
                        isRunning && 'text-zinc-100 light:text-slate-800',
                        isError && 'text-red-200/90 light:text-red-600',
                        (isWaiting || canStartFromGraph) &&
                          'text-cyan-200/95 light:text-cyan-800',
                        !isSuccess &&
                          !isRunning &&
                          !isError &&
                          !isWaiting &&
                          !canStartFromGraph &&
                          'text-sf-muted',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {step.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {exportStep ? (
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={onDownloadClick}
            disabled={!downloadEnabled || (downloadLoading && videoReady)}
            title={
              downloadLoading
                ? videoReady
                  ? '正在准备下载…'
                  : '导出中，点击查看队列与处理状态'
                : !downloadEnabled
                  ? '需先完成文本、音频与场景生成'
                  : videoReady
                    ? '下载已导出的成片'
                    : '导出视频（完成后可下载）'
            }
            className={[
              'inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 sm:gap-2.5 sm:px-4 sm:py-1.5 sm:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 light:focus-visible:ring-offset-white',
              downloadEnabled &&
                (!downloadLoading || !videoReady) &&
                'border border-violet-500/35 bg-violet-500/10 text-violet-100 hover:border-violet-400/50 hover:bg-violet-500/18 hover:text-white light:border-violet-400/55 light:bg-violet-100/95 light:text-violet-900 light:hover:border-violet-500/50 light:hover:bg-violet-200/90 light:hover:text-violet-950',
              downloadLoading &&
                downloadEnabled &&
                !videoReady &&
                'cursor-pointer border border-sky-500/35 bg-sky-500/10 text-sky-100 hover:border-sky-400/45 hover:bg-sky-500/16 light:border-sky-400/50 light:bg-sky-100/95 light:text-sky-900 light:hover:border-sky-500/45 light:hover:bg-sky-200/85',
              downloadLoading &&
                downloadEnabled &&
                videoReady &&
                'cursor-wait border border-zinc-600/50 light:border-slate-300 bg-zinc-900/90 light:bg-slate-100 text-zinc-300 light:text-slate-600',
              !downloadEnabled &&
                !downloadLoading &&
                'cursor-not-allowed border border-transparent text-sf-muted',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {downloadLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                <span>{videoReady ? '处理中' : '导出中'}</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" aria-hidden />
                <span>{videoReady ? '下载' : '导出'}</span>
              </>
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
