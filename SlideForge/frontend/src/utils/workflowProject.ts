import type { Project } from '../components/Home';
import {
  deriveWorkflowSteps,
  type ServerWorkflow,
} from './workflowFromPipeline';
import { applyActionableWaitingToSteps } from './workflowStepDependencies';

type PipelineLite =
  | Pick<Project, 'pipeline'>['pipeline']
  | undefined;

/**
 * GET /api/projects 列表有时在写库间隔内只带回部分 workflow 字段；当 pipeline 仍表示演示已生成时，
 * 用上一快照补全缺失的母版/场景分步状态，避免 deriveWorkflowSteps 误判 hasSplitDeck 或把场景页短暂推成 waiting。
 */
export function mergeServerWorkflowForListRefresh(
  prevWf: ServerWorkflow | null | undefined,
  nextWf: ServerWorkflow | null | undefined,
  _prevPipeline: PipelineLite,
  nextPipeline: PipelineLite,
): ServerWorkflow | null | undefined {
  if (!nextWf) return prevWf ?? nextWf;
  if (!prevWf) return nextWf;
  if (!nextPipeline?.deck) return nextWf;

  let changed = false;
  const out: ServerWorkflow = { ...nextWf };
  if (out.deckMasterStatus == null && prevWf.deckMasterStatus != null) {
    out.deckMasterStatus = prevWf.deckMasterStatus;
    changed = true;
  }
  if (out.deckRenderStatus == null && prevWf.deckRenderStatus != null) {
    out.deckRenderStatus = prevWf.deckRenderStatus;
    changed = true;
  }
  return changed ? out : nextWf;
}

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
