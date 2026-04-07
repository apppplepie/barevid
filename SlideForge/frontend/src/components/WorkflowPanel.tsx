import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitBranch,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  X,
  XCircle,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowStep } from './WorkflowProgressBar';
import {
  dependencyIdsForActionableStep,
  workflowStepDependenciesSatisfied,
  WORKFLOW_STEP_DEPENDENCIES,
} from '../utils/workflowStepDependencies';

type WorkflowPanelProps = {
  steps: WorkflowStep[];
  /** 判断「回退准备态」是否应取消：须以服务端推导的 steps 为准，勿用含乐观 running 的 `steps` */
  revertGuardSteps?: WorkflowStep[] | null;
  pipelineAutoAdvance?: boolean;
  manualOutlineConfirmed?: boolean;
  deckMasterSourceProjectId?: number | null;
  videoReady?: boolean;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  onCancelRunningStep?: (stepId: string) => void;
  cancellingStepId?: string | null;
  /** 面板内第二步：直接执行回退 API 并交由 ManualWorkflowDialogs（不调起顶栏确认弹窗） */
  onCommitReopenSuccessStep?: (stepId: string) => void;
  reopeningStepId?: string | null;
  onClose?: () => void;
};

/**
 * 仅用于画布连线（与 `WORKFLOW_STEP_DEPENDENCIES` / `dependencyIdsForActionableStep` 一致）。
 * 导出步在图上只承接「音频 + 场景页面」，不直连文本。
 */
function dependencyIdsForPanel(step: WorkflowStep, steps: WorkflowStep[]): string[] {
  if (step.id === 'pages' && !steps.some((candidate) => candidate.id === 'deck_master')) {
    return ['text', 'audio'];
  }
  if (step.id === 'export') {
    if (steps.some((s) => s.id === 'deck_render')) {
      return ['audio', 'deck_render'];
    }
    if (steps.some((s) => s.id === 'pages')) {
      return ['audio', 'pages'];
    }
  }
  return WORKFLOW_STEP_DEPENDENCIES[step.id] ?? [];
}

function buildPanelConnections(steps: WorkflowStep[]): { from: string; to: string }[] {
  const ids = new Set(steps.map((s) => s.id));
  const seen = new Set<string>();
  const out: { from: string; to: string }[] = [];
  const add = (from: string, to: string) => {
    if (!ids.has(from) || !ids.has(to)) return;
    const key = `${from}->${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to });
  };
  for (const step of steps) {
    for (const depId of dependencyIdsForPanel(step, steps)) {
      add(depId, step.id);
    }
  }
  return out;
}

/** 从该步起沿面板依赖边向下游遍历（与画布连线一致），包含起点。 */
function collectRevertImpactIds(startId: string, steps: WorkflowStep[]): Set<string> {
  const ids = new Set(steps.map((s) => s.id));
  if (!ids.has(startId)) return new Set();
  const connections = buildPanelConnections(steps);
  const adj = new Map<string, string[]>();
  for (const { from, to } of connections) {
    if (!ids.has(from) || !ids.has(to)) continue;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }
  const out = new Set<string>();
  const queue: string[] = [startId];
  out.add(startId);
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++]!;
    for (const next of adj.get(cur) ?? []) {
      if (!out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
  }
  return out;
}

/** 流程图网格：左列与中列水平距一致，保证「文本→音频」与「母版→场景」两段横线长度相同 */
const WF_PANEL_GRID = {
  colLeft: 15,
  colMid: 50,
  rowTop: 25,
  rowBottom: 75,
  exportX: 85,
  exportY: 50,
} as const;

const GRAPH_LAYOUT: Record<string, { x: number; y: number }> = {
  text: { x: WF_PANEL_GRID.colLeft, y: WF_PANEL_GRID.rowTop },
  deck_master: { x: WF_PANEL_GRID.colLeft, y: WF_PANEL_GRID.rowBottom },
  audio: { x: WF_PANEL_GRID.colMid, y: WF_PANEL_GRID.rowTop },
  deck_render: { x: WF_PANEL_GRID.colMid, y: WF_PANEL_GRID.rowBottom },
  pages: { x: WF_PANEL_GRID.colMid, y: WF_PANEL_GRID.rowBottom },
  export: { x: WF_PANEL_GRID.exportX, y: WF_PANEL_GRID.exportY },
};

function drawPath(x1: number, y1: number, x2: number, y2: number) {
  const px1 = x1 * 2.1;
  const py1 = y1 * 0.9;
  const px2 = x2 * 2.1;
  const py2 = y2 * 0.9;
  const cx1 = px1 + (px2 - px1) * 0.4;
  const cx2 = px1 + (px2 - px1) * 0.6;
  return `M ${px1} ${py1} C ${cx1} ${py1}, ${cx2} ${py2}, ${px2} ${py2}`;
}

/** 左列→中列两条水平依赖边共用同一水平跨度，避免贝塞尔与视觉错位导致上下长度不一致 */
function drawLeftToMidHorizontalRail(rowY: number) {
  const px1 = WF_PANEL_GRID.colLeft * 2.1;
  const px2 = WF_PANEL_GRID.colMid * 2.1;
  const py = rowY * 0.9;
  return `M ${px1} ${py} L ${px2} ${py}`;
}

function isLeftColumnToMidHorizontalEdge(from: string, to: string): boolean {
  if (from === 'text' && to === 'audio') return true;
  if (from === 'deck_master' && (to === 'deck_render' || to === 'pages')) return true;
  return false;
}

function stateAriaLabel(state: WorkflowStep['state']): string {
  if (state === 'success') return '成功';
  if (state === 'running') return '进行中';
  if (state === 'error') return '失败';
  if (state === 'cancelled') return '已取消';
  if (state === 'waiting') return '等待中';
  return '待前置';
}

function stepDescription(stepId: string, reusedMaster: boolean, manualBlocked: boolean): string {
  if (stepId === 'text') return '把主题原文整理成结构化口播分段，作为后续全部生成的基础。';
  if (stepId === 'audio') {
    return manualBlocked
      ? '确认口播分段后，再生成整稿配音。'
      : '根据结构化后的口播文本生成整稿音频。';
  }
  if (stepId === 'deck_master') {
    if (reusedMaster) return '当前复用已有母版；如果要换风格，也可以重新生成新的母版。';
    return '生成所有页面共用的演示母版和整体风格基底。';
  }
  if (stepId === 'deck_render') return '基于结构化内容和当前母版生成场景页面。';
  if (stepId === 'pages') return '生成或刷新当前演示的全部场景页面。';
  if (stepId === 'export') return '把音频与场景页面合成为最终成片并导出。';
  return '工作流步骤。';
}

function dependencyIds(step: WorkflowStep, steps: WorkflowStep[]): string[] {
  return dependencyIdsForActionableStep(step.id, steps);
}

function dependenciesSatisfied(
  step: WorkflowStep,
  steps: WorkflowStep[],
  manualBlocked: boolean,
): boolean {
  return workflowStepDependenciesSatisfied(step.id, steps, manualBlocked);
}

function recommendedActionText(
  steps: WorkflowStep[],
  pipelineAutoAdvance: boolean,
  manualOutlineConfirmed: boolean,
  deckMasterSourceProjectId?: number | null,
  videoReady?: boolean,
): string {
  const byId = (id: string) => steps.find((step) => step.id === id);
  const text = byId('text');
  const audio = byId('audio');
  const master = byId('deck_master');
  const render = byId('deck_render') ?? byId('pages');
  const exportStep = byId('export');
  const manualBlocked = pipelineAutoAdvance === false && !manualOutlineConfirmed;
  const failed = steps.find((step) => step.state === 'error');
  const cancelled = steps.find((step) => step.state === 'cancelled');

  if (videoReady && exportStep?.state === 'success') {
    return '当前成片已可用，可在顶栏下载或按需重新导出。';
  }
  if (failed) {
    return `建议优先处理失败步骤：${failed.label}。`;
  }
  if (cancelled) {
    return `步骤「${cancelled.label}」已取消，可直接重试继续。`;
  }
  if (manualBlocked && text?.state === 'success') {
    return '演示母版可与文案并行；确认口播分段后再继续音频与场景页面等步骤。';
  }
  if (steps.some((step) => step.state === 'running')) {
    return '当前有任务正在执行，可等待完成，或在必要时取消后重试。';
  }
  if (text?.state === 'pending' && master?.state === 'pending') {
    return '建议开始文本结构化与演示母版（两者可并行）。';
  }
  if (text?.state === 'pending') return '建议先开始文本结构化。';
  if (text?.state === 'success' && audio?.state === 'pending' && master?.state === 'pending') {
    return deckMasterSourceProjectId != null
      ? '建议下一步开始音频生成与场景页面生成。'
      : '建议下一步开始音频生成与母版生成。';
  }
  const renderNeedScene =
    render?.state === 'pending' || render?.state === 'waiting';
  if (master?.state === 'success' && renderNeedScene && audio?.state === 'pending') {
    return '建议开始音频生成与场景页面生成。';
  }
  if (master?.state === 'success' && renderNeedScene) {
    return '建议开始生成场景页面。';
  }
  if (audio?.state === 'pending' && text?.state === 'success') {
    return '建议开始音频生成。';
  }
  if (master?.state === 'pending') {
    return '建议开始演示母版生成。';
  }
  if (exportStep?.state === 'pending') {
    return '前置步骤已满足，建议导出最终视频（顶栏或本节点）。';
  }
  return '当前工作流状态正常。';
}

type PipelineNodeCardProps = {
  step: WorkflowStep;
  steps: WorkflowStep[];
  manualBlocked: boolean;
  deckMasterSourceProjectId?: number | null;
  locked?: boolean;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
  onCancelRunningStep?: (stepId: string) => void;
  cancellingStepId?: string | null;
  onCommitReopenSuccessStep?: (stepId: string) => void;
  reopeningStepId?: string | null;
  onClose?: () => void;
  /** 当前处于「回退准备」的步骤 id；为 null 表示未进入准备态 */
  revertPrepStepId?: string | null;
  /** 准备回退时，与画布依赖一致的影响范围（含起点） */
  revertImpactIds?: Set<string> | null;
  onRevertPrepBegin?: (stepId: string) => void;
  onRevertPrepCancel?: () => void;
};

function PipelineNodeCard({
  step,
  steps,
  manualBlocked,
  deckMasterSourceProjectId = null,
  locked = false,
  onRetryStep,
  retryingStepId = null,
  onCancelRunningStep,
  cancellingStepId = null,
  onCommitReopenSuccessStep,
  reopeningStepId = null,
  onClose,
  revertPrepStepId = null,
  revertImpactIds = null,
  onRevertPrepBegin,
  onRevertPrepCancel,
}: PipelineNodeCardProps) {
  const Icon = step.icon;
  const layout = GRAPH_LAYOUT[step.id] ?? { x: 50, y: 50 };
  const isSuccess = step.state === 'success';
  const isRunning = step.state === 'running';
  const isWaiting = step.state === 'waiting';
  const isPendingOnly = step.state === 'pending';
  const isError = step.state === 'error';
  const isCancelled = step.state === 'cancelled';
  const depsOk = dependenciesSatisfied(step, steps, manualBlocked);
  const canTryStart =
    (isPendingOnly || isWaiting) && depsOk;
  const isRetrying = retryingStepId === step.id;
  const isCancelling = cancellingStepId === step.id;
  const isReopening = reopeningStepId === step.id;
  const description = stepDescription(step.id, deckMasterSourceProjectId != null, manualBlocked);

  const inRevertImpactZone = !!(revertPrepStepId && revertImpactIds?.has(step.id));
  /** 复用母版时 locked 仅用于禁用「开始」按钮，外观与其它成功节点一致。 */
  const showRevertControls =
    isSuccess &&
    onCommitReopenSuccessStep &&
    (revertPrepStepId === null || revertPrepStepId === step.id);
  /** 仅「前置已齐、待导出」（pending/waiting + 依赖满足）显示「导出视频」；进行中/失败仍保留取消与重试 */
  const showExportActionsFooter =
    step.id === 'export' &&
    (canTryStart ||
      step.state === 'error' ||
      step.state === 'cancelled' ||
      step.state === 'running');
  const showNonExportActionsFooter =
    step.id !== 'export' &&
    (isRunning || isError || isCancelled || canTryStart);
  const showActionsFooter = showExportActionsFooter || showNonExportActionsFooter;
  const handleCardPointerUp = (e: MouseEvent) => {
    if (locked) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    if (canTryStart) {
      onClose?.();
      onRetryStep?.(step.id);
      return;
    }
    if (isError || isCancelled) {
      onClose?.();
      onRetryStep?.(step.id);
    }
  };

  const showWaitingVisual = isWaiting || (isPendingOnly && depsOk);

  const leftAccentBarClass =
    inRevertImpactZone && !isReopening
      ? 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.55)]'
      : isSuccess
        ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.55)]'
        : isRunning
          ? 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.55)]'
          : showWaitingVisual
            ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
            : isError
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.5)]'
              : isCancelled
                ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.45)]'
                : 'bg-zinc-500 light:bg-slate-400';

  const shellClass =
    inRevertImpactZone && !isReopening
      ? 'border border-red-500/55 bg-red-950/45 shadow-[0_0_32px_rgba(239,68,68,0.22)] light:border-red-300/80 light:bg-red-50/95 light:shadow-[0_0_28px_rgba(239,68,68,0.12)]'
      : isSuccess
        ? 'bg-emerald-950/35 shadow-[0_0_28px_rgba(16,185,129,0.18)] light:border-emerald-200/70 light:bg-emerald-50/90 light:shadow-[0_0_24px_rgba(16,185,129,0.1)]'
        : isRunning
          ? 'bg-blue-950/35 shadow-[0_0_28px_rgba(59,130,246,0.2)] light:border-blue-200/70 light:bg-blue-50/90 light:shadow-[0_0_24px_rgba(59,130,246,0.1)]'
          : showWaitingVisual
            ? 'bg-cyan-950/30 shadow-[0_0_26px_rgba(34,211,238,0.14)] light:border-cyan-200/70 light:bg-cyan-50/85 light:shadow-[0_0_22px_rgba(34,211,238,0.08)]'
            : isError
              ? 'bg-rose-950/32 shadow-[0_0_24px_rgba(244,63,94,0.14)] light:border-rose-200/70 light:bg-rose-50/90 light:shadow-[0_0_22px_rgba(244,63,94,0.08)]'
              : isCancelled
                ? 'bg-amber-950/28 shadow-[0_0_24px_rgba(245,158,11,0.12)] light:border-amber-200/70 light:bg-amber-50/90 light:shadow-[0_0_22px_rgba(245,158,11,0.08)]'
                : 'bg-zinc-900/50 hover:bg-zinc-900/65 light:border-slate-200/90 light:bg-slate-100/85 light:hover:bg-slate-200/80';

  const statusIcon = showWaitingVisual ? (
    <Clock className="h-[18px] w-[18px] text-cyan-400" strokeWidth={2} aria-hidden />
  ) : isPendingOnly ? (
    <CircleDashed className="h-[18px] w-[18px] text-zinc-400 light:text-slate-500" strokeWidth={2} aria-hidden />
  ) : isRunning ? (
    <Loader2 className="h-[18px] w-[18px] animate-spin text-blue-400" strokeWidth={2} aria-hidden />
  ) : isSuccess ? (
    <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" strokeWidth={2} aria-hidden />
  ) : isError ? (
    <XCircle className="h-[18px] w-[18px] text-rose-400" strokeWidth={2} aria-hidden />
  ) : isCancelled ? (
    <Ban className="h-[18px] w-[18px] text-amber-400" strokeWidth={2} aria-hidden />
  ) : null;

  return (
    <div
      data-workflow-node-card
      className={`absolute w-60 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-transparent backdrop-blur-xl transition-all duration-300 group light:border-transparent ${shellClass} ${
        canTryStart || isError || isCancelled ? 'cursor-pointer' : 'cursor-default'
      }`}
      style={{ left: `${layout.x}%`, top: `${layout.y}%` }}
      onMouseUp={handleCardPointerUp}
      role="group"
      aria-label={`${step.label}，${stateAriaLabel(step.state)}`}
    >
      <div
        className={`pointer-events-none absolute bottom-3 left-1.5 top-3 w-1 rounded-full ${leftAccentBarClass}`}
        aria-hidden
      />

      <div
        className={`pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-xl ${
          inRevertImpactZone && !isReopening
            ? 'sf-workflow-revert-corner bg-red-950/50 light:bg-red-100/90'
            : 'sf-workflow-node-dim'
        }`}
        aria-hidden
      >
        {inRevertImpactZone && !isReopening ? (
          <AlertTriangle className="h-[18px] w-[18px] text-red-400 light:text-red-600" strokeWidth={2} aria-hidden />
        ) : (
          statusIcon
        )}
      </div>

      <div className="flex items-start gap-3 pl-5 pr-14 pb-2 pt-4">
        <div
          className={`shrink-0 rounded-2xl p-3 transition-colors duration-500 ${
            inRevertImpactZone && !isReopening
              ? 'bg-red-500/15 text-red-300 light:bg-red-100/90 light:text-red-800'
              : isSuccess
                ? 'bg-emerald-500/20 text-emerald-400'
                : isRunning
                  ? 'bg-blue-500/20 text-blue-400'
                  : showWaitingVisual
                    ? 'bg-cyan-500/15 text-cyan-400'
                    : isError
                      ? 'bg-rose-500/20 text-rose-400'
                      : isCancelled
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-white/5 text-zinc-400 group-hover:text-zinc-300 light:bg-slate-900/[0.06] light:text-slate-500 light:group-hover:text-slate-700'
          }`}
        >
          <Icon className={`h-[22px] w-[22px] ${isRunning ? 'animate-pulse' : ''}`} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold leading-snug tracking-wide sf-text-primary">{step.label}</div>
          <p className="mt-2 text-[11px] leading-relaxed sf-text-secondary">{description}</p>
        </div>
      </div>

      {showActionsFooter ? (
        <div className="flex flex-col gap-2 border-t sf-border-base px-4 py-3 pl-5">
          {step.id === 'export' ? (
            <>
              {canTryStart ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onRetryStep?.(step.id);
                  }}
                  disabled={!onRetryStep}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-violet-600/90 px-3 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRetrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  导出视频
                </button>
              ) : null}
              {step.state === 'error' || step.state === 'cancelled' ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onRetryStep?.(step.id);
                  }}
                  disabled={!onRetryStep}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-violet-600/90 px-3 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRetrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  重新导出
                </button>
              ) : null}
              {step.state === 'running' ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onCancelRunningStep?.(step.id);
                  }}
                  disabled={!onCancelRunningStep}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-rose-500/45 bg-rose-600/85 px-3 text-[11px] font-medium text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  取消导出
                </button>
              ) : null}
            </>
          ) : (
            <>
              {canTryStart ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onRetryStep?.(step.id);
                  }}
                  disabled={!onRetryStep || locked}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-violet-600/90 px-3 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRetrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  开始
                </button>
              ) : null}
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onCancelRunningStep?.(step.id);
                  }}
                  disabled={!onCancelRunningStep}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-rose-500/45 bg-rose-600/85 px-3 text-[11px] font-medium text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  取消
                </button>
              ) : null}
              {isError || isCancelled ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onRetryStep?.(step.id);
                  }}
                  disabled={!onRetryStep}
                  className="inline-flex w-full min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-violet-600/90 px-3 text-[11px] font-medium text-white transition-colors hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRetrying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  {isCancelled ? '重新开始' : '重试'}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showRevertControls ? (
        <div className="border-t sf-border-base px-4 py-3 pl-5">
          {isReopening ? (
            <div className="flex items-center gap-2 text-sky-200/95 light:text-sky-800">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2} />
              <span className="text-[11px] font-semibold tracking-wide">正在回退…</span>
            </div>
          ) : revertPrepStepId === step.id ? (
            <div className="flex flex-wrap items-stretch gap-2">
              <button
                type="button"
                onClick={() => onRevertPrepCancel?.()}
                className="min-h-[34px] flex-1 rounded-lg bg-zinc-800/95 px-3 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700 light:bg-slate-200 light:text-slate-800 light:hover:bg-slate-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  onRevertPrepCancel?.();
                  onClose?.();
                  void onCommitReopenSuccessStep?.(step.id);
                }}
                className="inline-flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600/90 px-3 text-[11px] font-medium text-white transition-colors hover:bg-red-600"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                确认回退
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRevertPrepBegin?.(step.id)}
              className="w-full rounded-lg border border-zinc-600/80 bg-zinc-800/60 px-3 py-2 text-[11px] font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 light:border-slate-300 light:bg-slate-100 light:text-slate-800 light:hover:border-slate-400 light:hover:bg-slate-200"
            >
              回退
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowPanel({
  steps,
  revertGuardSteps = null,
  pipelineAutoAdvance = true,
  manualOutlineConfirmed = true,
  deckMasterSourceProjectId = null,
  videoReady = false,
  onRetryStep,
  retryingStepId = null,
  onCancelRunningStep,
  cancellingStepId = null,
  onCommitReopenSuccessStep,
  reopeningStepId = null,
  onClose,
}: WorkflowPanelProps) {
  const manualBlocked = pipelineAutoAdvance === false && !manualOutlineConfirmed;
  const [revertPrepStepId, setRevertPrepStepId] = useState<string | null>(null);
  const revertImpactIds = useMemo(
    () => (revertPrepStepId ? collectRevertImpactIds(revertPrepStepId, steps) : null),
    [revertPrepStepId, steps],
  );

  useEffect(() => {
    if (!revertPrepStepId) return;
    const guard = revertGuardSteps ?? steps;
    const src = guard.find((s) => s.id === revertPrepStepId);
    if (!src || src.state !== 'success') setRevertPrepStepId(null);
  }, [steps, revertGuardSteps, revertPrepStepId]);

  useEffect(() => {
    if (!revertPrepStepId) return;
    const onDoc = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-workflow-node-card]')) return;
      setRevertPrepStepId(null);
    };
    document.addEventListener('mousedown', onDoc, true);
    return () => document.removeEventListener('mousedown', onDoc, true);
  }, [revertPrepStepId]);

  const modeLabel = pipelineAutoAdvance === false ? '手动模式' : '自动模式';
  const recommendation = recommendedActionText(
    steps,
    pipelineAutoAdvance,
    manualOutlineConfirmed,
    deckMasterSourceProjectId,
    videoReady,
  );
  const connections = buildPanelConnections(steps);

  const content = (
    <div
      data-workflow-panel-root
      className="sf-workflow-panel sf-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-4 backdrop-blur-[3px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-panel-title"
        className="sf-dialog-shell sf-dialog-shell-ring flex max-h-[min(92vh,900px)] w-[min(1024px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] border"
      >
        <div className="sf-workflow-dialog-header-fill border-b px-5 py-4 sm:px-6 sm:py-5 sf-border-base">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 sf-text-primary">
                <GitBranch className="h-4.5 w-4.5 text-violet-300 light:text-violet-600" />
                <h3 id="workflow-panel-title" className="text-base font-semibold tracking-wide">
                  工作流面板
                </h3>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed sf-text-secondary">{recommendation}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="sf-deck-master-badge sf-deck-master-reused rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em]">
                {modeLabel}
              </span>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onClose?.();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.();
                }}
                aria-label="关闭工作流面板"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900/75 text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 light:border-slate-300 light:bg-white light:text-slate-500 light:hover:border-slate-400 light:hover:bg-slate-100 light:hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="sf-scrollbar-visible min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="sf-workflow-canvas sf-workflow-canvas-fill relative aspect-[21/9] w-full overflow-hidden rounded-3xl shadow-xl light:shadow-slate-300/40">
            <div
              className="sf-workflow-canvas-dots absolute inset-0 opacity-30"
              style={{
                backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiLz48L3N2Zz4=")`,
              }}
            />

            <div className="sf-workflow-canvas-glow pointer-events-none absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-blue-500/10 blur-[100px]" />
            <div className="sf-workflow-canvas-glow pointer-events-none absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-[100px]" />

            <svg viewBox="0 0 210 90" className="pointer-events-none absolute inset-0 h-full w-full">
              {connections.map(({ from, to }) => {
                const layoutFrom = GRAPH_LAYOUT[from] ?? { x: 50, y: 50 };
                const layoutTo = GRAPH_LAYOUT[to] ?? { x: 50, y: 50 };
                const nodeFrom = steps.find((s) => s.id === from);
                const nodeTo = steps.find((s) => s.id === to);
                if (!nodeFrom || !nodeTo) return null;
                const fromDone = nodeFrom.state === 'success';
                const toState = nodeTo.state;
                const toDepsReady = workflowStepDependenciesSatisfied(
                  nodeTo.id,
                  steps,
                  manualBlocked,
                );
                /** 指向「制作前沿」：进行中 / 等待操作 / 前置已齐的 pending（与卡片可点开始一致） */
                const toIsPipelineFrontier =
                  toState === 'running' ||
                  toState === 'waiting' ||
                  (toState === 'pending' && toDepsReady);
                const isCompletedEdge = fromDone && toState === 'success';
                const isProgressEdge =
                  fromDone &&
                  toState !== 'success' &&
                  toState !== 'error' &&
                  toState !== 'cancelled' &&
                  toIsPipelineFrontier;
                const edgeInRevertImpact =
                  revertImpactIds != null &&
                  revertImpactIds.has(from) &&
                  revertImpactIds.has(to);
                const pathD = isLeftColumnToMidHorizontalEdge(from, to)
                  ? drawLeftToMidHorizontalRail(layoutFrom.y)
                  : drawPath(layoutFrom.x, layoutFrom.y, layoutTo.x, layoutTo.y);

                return (
                  <g key={`${from}-${to}`}>
                    <path
                      d={pathD}
                      fill="none"
                      className="sf-workflow-edge-base"
                      strokeWidth="0.45"
                    />
                    {edgeInRevertImpact ? (
                      <path
                        d={pathD}
                        fill="none"
                        className="stroke-red-400 drop-shadow-[0_0_4px_rgba(248,113,113,0.55)] light:stroke-red-600"
                        strokeWidth="0.85"
                        strokeLinecap="round"
                        opacity={0.95}
                      />
                    ) : (
                      <>
                        {isProgressEdge ? (
                          <path
                            d={pathD}
                            className="sf-workflow-edge-progress"
                            strokeWidth="0.62"
                          />
                        ) : null}
                        {isCompletedEdge ? (
                          <path
                            d={pathD}
                            className="sf-workflow-edge-done"
                            strokeWidth="0.55"
                          />
                        ) : null}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>

            {steps.map((step) => (
              <Fragment key={step.id}>
                <PipelineNodeCard
                  step={step}
                  steps={steps}
                  manualBlocked={manualBlocked}
                  deckMasterSourceProjectId={deckMasterSourceProjectId}
                  locked={
                    step.id === 'deck_master' &&
                    deckMasterSourceProjectId != null &&
                    step.state === 'success'
                  }
                  onRetryStep={onRetryStep}
                  retryingStepId={retryingStepId}
                  onCancelRunningStep={onCancelRunningStep}
                  cancellingStepId={cancellingStepId}
                  onCommitReopenSuccessStep={onCommitReopenSuccessStep}
                  reopeningStepId={reopeningStepId}
                  onClose={onClose}
                  revertPrepStepId={revertPrepStepId}
                  revertImpactIds={revertImpactIds}
                  onRevertPrepBegin={(id) => setRevertPrepStepId(id)}
                  onRevertPrepCancel={() => setRevertPrepStepId(null)}
                />
              </Fragment>
            ))}
          </div>
        </div>

        <div className="sf-workflow-panel-footer border-t px-5 py-3 sm:px-6">
          <div className="flex items-start gap-2 text-xs leading-relaxed sf-text-muted">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 sf-text-secondary" />
            <p>
              节点连线表示依赖关系。点「回退」后，当前步骤及依赖链上的下游步骤会一并标红，表示将被同步重置；确认后关闭面板并执行回退，点「取消」或节点外区域可放弃。
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return content;
  }
  return createPortal(content, document.body);
}
