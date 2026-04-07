import { Clapperboard, FileText, LayoutTemplate, Mic, Palette } from 'lucide-react';
import type { StepState, WorkflowStep } from '../components/WorkflowProgressBar';

export type ServerPipeline = {
  outline: boolean;
  audio: boolean;
  deck: boolean;
  video: boolean;
};

/** 后端 GET /api/projects/:id 返回的 workflow（camelCase） */
export type ServerWorkflow = {
  textStatus?: string | null;
  audioStatus?: string | null;
  demoStatus?: string | null;
  /** projects.export_status 镜像：running / success / failed / not_started */
  exportStatus?: string | null;
  /** workflow_export_runs.status：exporting / export_success / export_failed / not_exported */
  exportWorkflowStatus?: string | null;
  /** 分步：母版 / 页面渲染（新后端） */
  deckMasterStatus?: string | null;
  deckRenderStatus?: string | null;
};

const DEFAULT_PIPELINE: ServerPipeline = {
  outline: false,
  audio: false,
  deck: false,
  video: false,
};

function mapServerStepStatus(s: string | null | undefined): StepState {
  const v = (s || 'not_started').trim().toLowerCase();
  if (v === 'running' || v === 'exporting') return 'running';
  if (v === 'succeeded' || v === 'success' || v === 'export_success') return 'success';
  if (v === 'cancelled') return 'cancelled';
  if (v === 'failed' || v === 'export_failed') return 'error';
  if (v === 'ready') return 'waiting';
  if (v === 'pending' || v === 'not_started' || v === 'not_exported') {
    return 'pending';
  }
  return 'pending';
}

/** 是否应用服务端 workflow 分步（避免仅缺 textStatus 时整段退回 pipeline 推导，导出步永远变灰） */
function shouldUseServerWorkflow(w: ServerWorkflow | null | undefined): boolean {
  if (!w) return false;
  return (
    w.textStatus != null ||
    w.audioStatus != null ||
    w.demoStatus != null ||
    w.exportStatus != null ||
    w.exportWorkflowStatus != null ||
    w.deckMasterStatus != null ||
    w.deckRenderStatus != null
  );
}

export type DeriveWorkflowOptions = {
  pipelineAutoAdvance?: boolean;
};

/** 根据后端 `compute_project_pipeline` + `projects.status` + `deck_status` 推导 UI 步骤态 */
export function deriveWorkflowSteps(
  pipeline: Partial<ServerPipeline> | undefined,
  projectStatus: string | undefined,
  deckStatus: string | undefined,
  serverWorkflow?: ServerWorkflow | null,
  options?: DeriveWorkflowOptions,
): WorkflowStep[] {
  const auto = options?.pipelineAutoAdvance !== false;

  if (shouldUseServerWorkflow(serverWorkflow)) {
    const w = serverWorkflow;
    let outline = mapServerStepStatus(w.textStatus);
    let audio = mapServerStepStatus(w.audioStatus);
    const exportRaw = w.exportStatus ?? w.exportWorkflowStatus ?? null;
    const exportStep = mapServerStepStatus(exportRaw);

    const hasSplitDeck =
      w.deckMasterStatus != null && w.deckRenderStatus != null;

    if (hasSplitDeck) {
      let master = mapServerStepStatus(w.deckMasterStatus);
      let render = mapServerStepStatus(w.deckRenderStatus);
      if (!auto && outline === 'success' && audio === 'pending') {
        audio = 'waiting';
      }
      if (
        !auto &&
        outline === 'success' &&
        master === 'success' &&
        render === 'pending'
      ) {
        render = 'waiting';
      }
      // 自动模式：文案结构化进行中时，母版与后台并行生成；服务端若仍报 pending/ready，勿显示「等待」
      if (
        auto &&
        outline === 'running' &&
        (master === 'pending' || master === 'waiting')
      ) {
        master = 'running';
      }
      return [
        { id: 'deck_master', label: '演示母版', state: master, icon: Palette },
        { id: 'text', label: '文本结构化', state: outline, icon: FileText },
        { id: 'audio', label: '音频生成', state: audio, icon: Mic },
        { id: 'deck_render', label: '场景页面', state: render, icon: LayoutTemplate },
        { id: 'export', label: '视频导出', state: exportStep, icon: Clapperboard },
      ];
    }

    let deck = mapServerStepStatus(w.demoStatus);
    if (!auto && outline === 'success' && audio === 'pending') {
      audio = 'waiting';
    }
    if (
      !auto &&
      outline === 'success' &&
      audio === 'success' &&
      deck === 'pending'
    ) {
      deck = 'waiting';
    }
    return [
      { id: 'text', label: '文本结构化', state: outline, icon: FileText },
      { id: 'audio', label: '音频生成', state: audio, icon: Mic },
      { id: 'pages', label: '场景生成', state: deck, icon: LayoutTemplate },
      { id: 'export', label: '视频导出', state: exportStep, icon: Clapperboard },
    ];
  }

  const p: ServerPipeline = { ...DEFAULT_PIPELINE, ...pipeline };
  const st = (projectStatus || 'draft').trim().toLowerCase();
  const ds = (deckStatus || 'idle').trim().toLowerCase();

  let outline: StepState;
  if (p.outline) outline = 'success';
  else if (st === 'structuring') outline = 'running';
  else outline = 'pending';

  let audio: StepState;
  if (outline !== 'success') audio = 'pending';
  else if (p.audio) audio = 'success';
  else if (st === 'synthesizing') audio = 'running';
  else audio = 'pending';

  let deck: StepState;
  if (audio !== 'success') deck = 'pending';
  else if (p.deck) deck = 'success';
  else if (ds === 'generating') deck = 'running';
  else deck = 'pending';

  if (st === 'failed') {
    if (p.outline && !p.audio) {
      outline = 'success';
      audio = 'error';
      deck = 'pending';
    } else if (p.audio && !p.deck) {
      outline = 'success';
      audio = 'success';
      deck = 'error';
    } else if (!p.outline) {
      outline = 'error';
      audio = 'pending';
      deck = 'pending';
    } else if (p.deck) {
      outline = 'success';
      audio = 'success';
      deck = 'success';
    }
  } else {
    if (ds === 'failed' && p.audio && !p.deck) {
      deck = 'error';
    }
  }

  let exportStep: StepState;
  if (!p.deck || deck !== 'success') {
    exportStep = 'pending';
  } else if (p.video) {
    exportStep = 'success';
  } else {
    exportStep = 'pending';
  }

  if (!auto && outline === 'success' && audio === 'pending') {
    audio = 'waiting';
  }
  if (
    !auto &&
    outline === 'success' &&
    audio === 'success' &&
    deck === 'pending' &&
    !p.deck &&
    ds !== 'generating'
  ) {
    deck = 'waiting';
  }

  return [
    { id: 'text', label: '文本结构化', state: outline, icon: FileText },
    { id: 'audio', label: '音频生成', state: audio, icon: Mic },
    { id: 'pages', label: '场景生成', state: deck, icon: LayoutTemplate },
    { id: 'export', label: '视频导出', state: exportStep, icon: Clapperboard },
  ];
}

/** 编辑内：点击后仅将对应步标为 running；成功态必须来自服务端轮询，不得在此写 success。 */
export function applyEditorPendingToSteps(
  steps: WorkflowStep[],
  pending: {
    audio?: boolean;
    text?: boolean;
    deck?: boolean;
    deckMaster?: boolean;
  },
): WorkflowStep[] {
  return steps.map((s) => {
    if (pending.text && s.id === 'text') {
      return { ...s, state: 'running' as const };
    }
    if (pending.audio && s.id === 'audio') {
      return { ...s, state: 'running' as const };
    }
    if (pending.deckMaster && s.id === 'deck_master') {
      return { ...s, state: 'running' as const };
    }
    if (pending.deck && (s.id === 'deck_render' || s.id === 'pages')) {
      return { ...s, state: 'running' as const };
    }
    return s;
  });
}
