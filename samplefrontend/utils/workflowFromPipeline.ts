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
  /** 存在 workflow_runs 行时必有分步母版/渲染状态（即使某次响应里漏字段也可用 run id 判定） */
  workflowRunId?: number | null;
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
  if (v === 'success' || v === 'export_success') return 'success';
  if (v === 'failed' || v === 'export_failed') return 'error';
  if (v === 'pending' || v === 'not_started' || v === 'not_exported') {
    return 'pending';
  }
  return 'pending';
}

/**
 * 分步 workflow 下 pipeline（大纲/页面是否已有实物）可能与 step 行不同步，例如回退文案后仍有大纲节点。
 * 此时以 serverWorkflow 映射结果为准，不把 pending/running 提成 success。
 */
function serverStepBlocksPipelineSuccess(mapped: StepState): boolean {
  return mapped === 'pending' || mapped === 'running';
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
    w.deckRenderStatus != null ||
    w.workflowRunId != null
  );
}

export type DeriveWorkflowOptions = {
  /** 为 false 时场景页未跑可显示「等待中」（与顶栏一致） */
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
  if (shouldUseServerWorkflow(serverWorkflow)) {
    const w = serverWorkflow;
    const pMergedRoot: ServerPipeline = { ...DEFAULT_PIPELINE, ...pipeline };
    const stProj = (projectStatus || 'draft').trim().toLowerCase();

    let outline = mapServerStepStatus(w.textStatus);
    if (outline !== 'error') {
      if (
        pMergedRoot.outline &&
        !serverStepBlocksPipelineSuccess(outline)
      ) {
        outline = 'success';
      } else if (
        outline === 'pending' &&
        (stProj === 'structuring' || stProj === 'queued')
      ) {
        outline = 'running';
      }
    }

    let audio = mapServerStepStatus(w.audioStatus);
    if (audio !== 'error') {
      if (pMergedRoot.audio && !serverStepBlocksPipelineSuccess(audio)) {
        audio = 'success';
      } else if (audio === 'pending' && stProj === 'synthesizing') {
        audio = 'running';
      }
    }

    const exportRaw = w.exportStatus ?? w.exportWorkflowStatus ?? null;

    // 任一分步字段或 workflowRunId 即走「母版 + 场景页」五步；缺省的一侧按 pending（避免只带回部分 key 时误退回单步 pages）
    const useSplitDeckSteps =
      w.workflowRunId != null ||
      w.deckMasterStatus != null ||
      w.deckRenderStatus != null;

    if (useSplitDeckSteps) {
      const pMerged: ServerPipeline = pMergedRoot;
      const dmRaw = w.deckMasterStatus ?? 'pending';
      const drRaw = w.deckRenderStatus ?? 'pending';
      let master = mapServerStepStatus(dmRaw);
      let render = mapServerStepStatus(drRaw);
      const ds = (deckStatus || 'idle').trim().toLowerCase();
      if (render === 'running' && ds !== 'generating') {
        render = 'pending';
      }
      // 与 pipeline / projects.deck_status 对齐，避免界面「等待中」而后端已在生成或已全部就绪
      if (render !== 'error') {
        if (pMerged.deck && !serverStepBlocksPipelineSuccess(render)) {
          render = 'success';
        } else if (ds === 'generating') {
          render = 'running';
        }
      }
      // 演示母版：后端 workflow_step_runs.deck_master 为单独状态；与文案并行生成时轮询间隙可能仍为 pending
      const auto = options?.pipelineAutoAdvance !== false;
      if (master !== 'error') {
        if (
          master === 'pending' &&
          auto &&
          !pMergedRoot.outline &&
          (stProj === 'structuring' || stProj === 'queued')
        ) {
          master = 'running';
        }
      }
      // 场景页依赖文案 + 母版：仅文案已 success 时才显示「等待中」；文案未开始/未成功须保持 pending
      if (!auto && outline === 'success' && master === 'success' && render === 'pending') {
        render = 'waiting';
      }
      // 手动模式：文案已齐、音频未跑时与「场景页」一致显示「等待中」，避免仅依赖 applyActionableWaiting（口播闸门会挡住 audio）
      if (!auto && outline === 'success' && audio === 'pending') {
        audio = 'waiting';
      }

      let exportStep = mapServerStepStatus(exportRaw);
      if (outline !== 'success' || audio !== 'success' || render !== 'success') {
        if (exportStep !== 'error' && exportStep !== 'running') {
          exportStep = 'pending';
        }
      } else if (pMerged.video) {
        exportStep = 'success';
      } else {
        exportStep = mapServerStepStatus(exportRaw);
        if (exportStep === 'success') {
          exportStep = 'pending';
        } else if (exportStep !== 'error' && exportStep !== 'running') {
          exportStep = 'pending';
        }
      }

      return [
        { id: 'text', label: '文本结构化', state: outline, icon: FileText },
        { id: 'audio', label: '音频生成', state: audio, icon: Mic },
        { id: 'deck_master', label: '演示母版', state: master, icon: Palette },
        { id: 'deck_render', label: '场景页面', state: render, icon: LayoutTemplate },
        { id: 'export', label: '视频导出', state: exportStep, icon: Clapperboard },
      ];
    }

    const pMergedLegacy: ServerPipeline = pMergedRoot;
    const dsLegacy = (deckStatus || 'idle').trim().toLowerCase();
    let deck = mapServerStepStatus(w.demoStatus);
    if (deck === 'running' && dsLegacy !== 'generating') {
      deck = 'pending';
    }
    if (deck !== 'error') {
      if (pMergedLegacy.deck && !serverStepBlocksPipelineSuccess(deck)) {
        deck = 'success';
      } else if (dsLegacy === 'generating') {
        deck = 'running';
      }
    }

    const autoLegacy = options?.pipelineAutoAdvance !== false;
    // 旧版 pages 依赖 text + audio：两者均 success 才显示等待中
    if (
      !autoLegacy &&
      outline === 'success' &&
      audio === 'success' &&
      deck === 'pending' &&
      !pMergedLegacy.deck &&
      dsLegacy !== 'generating'
    ) {
      deck = 'waiting';
    }
    if (!autoLegacy && outline === 'success' && audio === 'pending') {
      audio = 'waiting';
    }

    let exportStepLegacy = mapServerStepStatus(exportRaw);
    if (outline !== 'success' || audio !== 'success' || deck !== 'success') {
      if (exportStepLegacy !== 'error' && exportStepLegacy !== 'running') {
        exportStepLegacy = 'pending';
      }
    } else if (pMergedLegacy.video) {
      exportStepLegacy = 'success';
    } else {
      exportStepLegacy = mapServerStepStatus(exportRaw);
      if (exportStepLegacy === 'success') {
        exportStepLegacy = 'pending';
      } else if (exportStepLegacy !== 'error' && exportStepLegacy !== 'running') {
        exportStepLegacy = 'pending';
      }
    }

    return [
      { id: 'text', label: '文本结构化', state: outline, icon: FileText },
      { id: 'audio', label: '音频生成', state: audio, icon: Mic },
      { id: 'pages', label: '场景生成', state: deck, icon: LayoutTemplate },
      { id: 'export', label: '视频导出', state: exportStepLegacy, icon: Clapperboard },
    ];
  }

  const p: ServerPipeline = { ...DEFAULT_PIPELINE, ...pipeline };
  const st = (projectStatus || 'draft').trim().toLowerCase();
  const ds = (deckStatus || 'idle').trim().toLowerCase();

  let outline: StepState;
  if (p.outline) outline = 'success';
  else if (st === 'structuring') outline = 'running';
  else if (st === 'pending_text') outline = 'pending';
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

  if (
    options?.pipelineAutoAdvance === false &&
    outline === 'success' &&
    audio === 'pending'
  ) {
    audio = 'waiting';
  }
  if (
    options?.pipelineAutoAdvance === false &&
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

/** 编辑内口播局部重合成时仅用于顶栏：在已完成音频步上显示「进行中」，但不阻塞主工作区。 */
export function applyEditorPendingToSteps(
  steps: WorkflowStep[],
  pending: { audio?: boolean; text?: boolean },
): WorkflowStep[] {
  return steps.map((s) => {
    if (pending.text && s.id === 'text') {
      return { ...s, state: 'running' as const };
    }
    if (pending.audio && s.id === 'audio' && s.state === 'success') {
      return { ...s, state: 'running' as const };
    }
    return s;
  });
}
