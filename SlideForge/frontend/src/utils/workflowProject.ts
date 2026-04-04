import type { Project } from '../components/Home';
import { deriveWorkflowSteps } from './workflowFromPipeline';
import { applyActionableWaitingToSteps } from './workflowStepDependencies';

/** 合并 patch 后按当前 pipeline / workflow 重算步骤（含 waiting 推导）。 */
export function mergeProjectWorkflowState(
  project: Project,
  patch: Partial<Project>,
): Project {
  const next: Project = { ...project, ...patch };
  return {
    ...next,
    workflowSteps: buildWorkflowStepsForProject(next),
  };
}

export function buildWorkflowStepsForProject(
  p: Pick<
    Project,
    | 'pipeline'
    | 'serverStatus'
    | 'deckStatus'
    | 'serverWorkflow'
    | 'pipelineAutoAdvance'
    | 'manualOutlineConfirmed'
  >,
) {
  const raw = deriveWorkflowSteps(
    p.pipeline,
    p.serverStatus,
    p.deckStatus,
    p.serverWorkflow ?? null,
    {
      pipelineAutoAdvance: p.pipelineAutoAdvance !== false,
    },
  );
  return applyActionableWaitingToSteps(raw, {
    pipelineAutoAdvance: p.pipelineAutoAdvance !== false,
    manualOutlineConfirmed: p.manualOutlineConfirmed !== false,
  });
}
