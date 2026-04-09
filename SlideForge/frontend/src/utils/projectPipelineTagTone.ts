import type { SfTagTone } from '../components/ui/SfTag';

export type ProjectPipelineTagInput = {
  serverStatus?: string;
  deckStatus?: string;
  pipeline?: { outline?: boolean; audio?: boolean; deck?: boolean; video?: boolean };
};

/** 项目卡片四态：与 `workflowSteps` + pipeline 对齐 */
export type ProjectPipelineCardPhase = 'idle' | 'running' | 'ready' | 'complete';

export type ProjectPipelineCardInput = ProjectPipelineTagInput & {
  workflowSteps?: ReadonlyArray<{ state: string }>;
  videoExportJob?: { status: string } | null;
};

/** 列表未带 workflow 时，用 status / deck_status 粗判是否在跑 */
function implicitPipelineRunning(project: ProjectPipelineTagInput): boolean {
  const st = (project.serverStatus || '').toLowerCase();
  if (['queued', 'pending_text', 'structuring', 'synthesizing'].includes(st)) return true;
  const ds = (project.deckStatus || 'idle').toLowerCase();
  if (ds === 'generating') return true;
  return false;
}

function exportJobBusy(project: ProjectPipelineCardInput): boolean {
  const j = project.videoExportJob;
  if (j == null) return false;
  return j.status === 'queued' || j.status === 'running';
}

export function projectPipelineCardPhase(
  project: ProjectPipelineCardInput | null | undefined,
): ProjectPipelineCardPhase {
  if (project == null) return 'idle';
  const pl = project.pipeline;
  if (pl?.video) return 'complete';

  const steps = project.workflowSteps;
  const hasSteps = steps != null && steps.length > 0;
  const stepsRunning = hasSteps ? steps.some((s) => s.state === 'running') : false;
  const running = stepsRunning || (!hasSteps && implicitPipelineRunning(project)) || exportJobBusy(project);
  if (running) return 'running';

  if (pl?.audio && pl?.deck) return 'ready';
  return 'idle';
}

export function projectPipelineCardLabel(
  project: ProjectPipelineCardInput | null | undefined,
): string {
  switch (projectPipelineCardPhase(project)) {
    case 'complete':
      return '完成';
    case 'running':
      return '进行中';
    case 'ready':
      return '就绪';
    default:
      return '待操作';
  }
}

export function projectPipelineTagTone(
  project: ProjectPipelineCardInput | null | undefined,
): SfTagTone {
  switch (projectPipelineCardPhase(project)) {
    case 'complete':
      return 'emerald';
    case 'running':
      return 'blue';
    case 'ready':
      return 'violet';
    default:
      return 'amber';
  }
}
