import type { WorkflowStep } from '../components/WorkflowProgressBar';

/** 顶栏/流程面板/可点判断共用；`deck_render` 与带母版的 `pages` 均为 text + deck_master。 */
export const WORKFLOW_STEP_DEPENDENCIES: Record<string, string[]> = {
  text: [],
  audio: ['text'],
  deck_master: [],
  deck_render: ['text', 'deck_master'],
  pages: ['text', 'deck_master'],
  export: ['text', 'audio', 'deck_render'],
};

/**
 * 与 WorkflowPanel 业务依赖一致（含 export 在仅有 pages 时的边）。
 * 用于「前置已满足、待用户点开始」→ 显示等待中（闹钟）。
 */
export function dependencyIdsForActionableStep(
  stepId: string,
  steps: Pick<WorkflowStep, 'id'>[],
): string[] {
  if (stepId === 'pages' && !steps.some((c) => c.id === 'deck_master')) {
    return ['text', 'audio'];
  }
  if (stepId === 'export') {
    if (steps.some((s) => s.id === 'deck_render')) {
      return ['text', 'audio', 'deck_render'];
    }
    if (steps.some((s) => s.id === 'pages')) {
      return ['text', 'audio', 'pages'];
    }
    return ['text', 'audio'];
  }
  return WORKFLOW_STEP_DEPENDENCIES[stepId] ?? [];
}

export function workflowStepDependenciesSatisfied(
  stepId: string,
  steps: WorkflowStep[],
  manualBlocked: boolean,
): boolean {
  // 口播分段闸门只约束「文案之后的配音与依赖配音的链路」；演示母版与文案结构化并行，不受此限制
  if (
    stepId !== 'text' &&
    stepId !== 'deck_master' &&
    manualBlocked
  ) {
    return false;
  }
  const deps = dependencyIdsForActionableStep(stepId, steps);
  return deps.every((d) => steps.find((s) => s.id === d)?.state === 'success');
}

/**
 * 仅前端展示：前置已满足且仍为 pending 的步骤标为 waiting（与面板「下游待操作」一致）。
 */
export function applyActionableWaitingToSteps(
  steps: WorkflowStep[],
  opts: { pipelineAutoAdvance: boolean; manualOutlineConfirmed: boolean },
): WorkflowStep[] {
  const manualBlocked =
    opts.pipelineAutoAdvance === false && !opts.manualOutlineConfirmed;
  // deriveWorkflowSteps 等路径可能先把场景步标成 waiting；若文案/母版等前置未齐，应退回 pending，避免「等待中」误导
  const demoted = steps.map((s) => {
    if (
      (s.id === 'deck_render' || s.id === 'pages') &&
      s.state === 'waiting' &&
      !workflowStepDependenciesSatisfied(s.id, steps, manualBlocked)
    ) {
      return { ...s, state: 'pending' as const };
    }
    return s;
  });
  return demoted.map((s) => {
    if (s.state !== 'pending') return s;
    if (!workflowStepDependenciesSatisfied(s.id, demoted, manualBlocked)) {
      return s;
    }
    return { ...s, state: 'waiting' as const };
  });
}
