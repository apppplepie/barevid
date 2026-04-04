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

export function stepStateLabelZh(state: StepState): string {
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
  /** 已成功步骤点击回退（下游清空为未开始，并打开手动表单） */
  onReopenSuccessStep?: (stepId: string) => void;
  /** 正在请求回退接口的步骤 id */
  reopeningSuccessStepId?: string | null;
  /** 与 derive 手动闸门一致；用于判断「前置已满足、待用户操作」 */
  pipelineAutoAdvance?: boolean;
  manualOutlineConfirmed?: boolean;
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
  onReopenSuccessStep,
  reopeningSuccessStepId = null,
  pipelineAutoAdvance = true,
  manualOutlineConfirmed = true,
}: WorkflowProgressBarProps) {
  const manualBlocked =
    pipelineAutoAdvance === false && !manualOutlineConfirmed;
  const exportIdx = steps.findIndex((s) => s.id === 'export');
  const exportStep = exportIdx >= 0 ? steps[exportIdx] : null;

  return (
    <div
      className="sf-topbar-progress flex min-w-0 w-full max-w-full items-center justify-end gap-1 sm:gap-1.5"
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
        const isPending = !isSuccess && !isRunning && !isError;
        const canStartFromGraph =
          Boolean(onRetryStep) &&
          step.id !== 'export' &&
          isPending &&
          workflowStepDependenciesSatisfied(step.id, steps, manualBlocked);
        const canCancelRunning = isRunning && Boolean(onCancelRunningStep);
        const canReopenSuccess = isSuccess && Boolean(onReopenSuccessStep);

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
                    'sf-topbar-step-dot relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 sm:h-7 sm:w-7',
                    isSuccess && 'sf-topbar-step-dot-success',
                    isRunning && 'sf-topbar-step-dot-running',
                    isError && 'sf-topbar-step-dot-error',
                    (isWaiting || canStartFromGraph) &&
                      'sf-topbar-step-dot-waiting',
                    !isSuccess &&
                      !isRunning &&
                      !isError &&
                      !isWaiting &&
                      !canStartFromGraph &&
                      'sf-topbar-step-dot-pending',
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
                    canReopenSuccess ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (reopeningSuccessStepId === step.id) return;
                          onReopenSuccessStep?.(step.id);
                        }}
                        disabled={reopeningSuccessStepId === step.id}
                        title={`${step.label} 已完成，点击回退并重新编辑（手动表单）`}
                        className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-emerald-500/20 focus-visible:ring-2 focus-visible:ring-emerald-400/50 disabled:opacity-50"
                      >
                        {reopeningSuccessStepId === step.id ? (
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
                      className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-cyan-500/15 focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50"
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
                      className="flex h-full w-full items-center justify-center rounded-full outline-none transition-colors hover:bg-cyan-500/15 focus-visible:ring-2 focus-visible:ring-cyan-400/50 disabled:opacity-50"
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
                    'sf-topbar-step-label inline max-w-[2.25rem] truncate text-[9px] font-medium tracking-wide sm:max-w-[5.5rem] sm:text-[11px]',
                    isSuccess && 'sf-topbar-step-label-success',
                    isRunning && 'sf-topbar-step-label-running',
                    isError && 'sf-topbar-step-label-error',
                    (isWaiting || canStartFromGraph) &&
                      'sf-topbar-step-label-waiting',
                    !isSuccess &&
                      !isRunning &&
                      !isError &&
                      !isWaiting &&
                      !canStartFromGraph &&
                      'sf-topbar-step-label-pending',
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
            disabled={!downloadEnabled || downloadLoading}
            title={
              downloadLoading
                ? videoReady
                  ? '正在准备下载…'
                  : '正在导出视频，请稍候…'
                : !downloadEnabled
                  ? '需先完成文本、音频与场景生成'
                  : videoReady
                    ? '下载已导出的成片'
                    : '导出视频（完成后可下载）'
            }
            className={[
              'sf-topbar-export-btn inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-all duration-200 sm:gap-2.5 sm:px-4 sm:py-1.5 sm:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
              downloadEnabled &&
                !downloadLoading &&
                'border hover:brightness-95',
              downloadLoading &&
                downloadEnabled &&
                'cursor-wait border opacity-80',
              !downloadEnabled &&
                !downloadLoading &&
                'cursor-not-allowed border border-transparent text-zinc-600',
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
