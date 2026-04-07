import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
// import { useTheme } from './ThemeContext'; // 顶栏主题按钮暂藏，恢复时取消注释
import { ExportVideoChoiceDialog } from './components/ExportVideoChoiceDialog';
import {
  ExportVideoStatusDialog,
  type VideoExportJobInfo,
} from './components/ExportVideoStatusDialog';
import { TopBar } from './components/TopBar';
import { DetailPanel } from './components/DetailPanel';
import { MainWorkspace } from './components/MainWorkspace';
import { Timeline } from './components/Timeline';
import { EditorRightSidebar } from './components/EditorRightSidebar';
import { Home, Project, type CreateProjectInput } from './components/Home';
import { ClipData, PageData } from './types';
import { type ServerWorkflow } from './utils/workflowFromPipeline';
import {
  buildWorkflowStepsForProject,
  mergeProjectWorkflowState,
} from './utils/workflowProject';
import { useEditorWorkflowModel } from './hooks/useEditorWorkflowModel';
import { WorkflowPanel } from './components/WorkflowPanel';
import type { WorkflowStep } from './components/WorkflowProgressBar';
import {
  CancelRunningPipelineStepDialog,
  ReopenSuccessPipelineStepDialog,
} from './components/WorkflowPipelineConfirmDialogs';
import {
  ManualDeckMasterDialog,
  ManualDeckPagesDialog,
  ManualOutlineConfirmDialog,
  ManualTextPrepDialog,
} from './components/ManualWorkflowDialogs';
import { ProjectDetailsModal } from './components/ProjectDetailsModal';
import { ApiError, apiFetch, apiUrl, getAuthBearerToken, getStoredAuthToken, setStoredAuthToken } from './api';
import {
  buildTimelineFromPlayManifest,
  type PlayManifest,
  type PlayStep,
} from './data/playManifest';
import { useStepPlayer } from './hooks/useStepPlayer';
import { findClipAtTime } from './utils/timelineHit';
import type { OutlineNodeApi } from './utils/outlineScriptPages';

function parsePageNodeIdFromPageId(pageId?: string | null): number {
  const pm = /^page-(\d+)$/.exec((pageId || '').trim());
  const n = pm ? Number(pm[1]) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function parseStepNodeIdFromClipId(clipId?: string | null): number | null {
  const m = /^step-(\d+)$/.exec((clipId || '').trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 列表接口里母版源 id（兼容 JSON 数字/字符串） */
function parseDeckMasterSourceProjectId(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d+$/.test(t)) {
      const n = parseInt(t, 10);
      return n > 0 ? n : null;
    }
  }
  return null;
}

function mapVideoExportJob(raw: unknown): VideoExportJobInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (
    status !== 'queued' &&
    status !== 'running' &&
    status !== 'succeeded' &&
    status !== 'failed'
  ) {
    return null;
  }
  const jobId = o.job_id;
  if (typeof jobId !== 'number' || !Number.isFinite(jobId)) return null;
  const st = status as VideoExportJobInfo['status'];
  return {
    job_id: jobId,
    status: st,
    worker_id: typeof o.worker_id === 'string' ? o.worker_id : null,
    created_at: typeof o.created_at === 'string' ? o.created_at : null,
    started_at: typeof o.started_at === 'string' ? o.started_at : null,
    finished_at: typeof o.finished_at === 'string' ? o.finished_at : null,
    output_url: typeof o.output_url === 'string' ? o.output_url : undefined,
    error_message: typeof o.error_message === 'string' ? o.error_message : null,
  };
}

type ProjectListItem = {
  id: number;
  name: string;
  owner_user_id: number;
  owner_username?: string;
  is_shared: boolean;
  status: string;
  deck_status?: string;
  created_at: string;
  updated_at?: string;
  deck_page_size?: string;
  deck_style_preset?: string;
  deck_master_source_project_id?: number | null;
  video_exported_at?: string | null;
  pipeline?: { outline?: boolean; audio?: boolean; deck?: boolean; video?: boolean };
  workflow?: ServerWorkflow | null;
  video_export_job?: unknown;
  pipeline_auto_advance?: boolean;
};

type ProjectDetailApi = {
  pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
  workflow?: ServerWorkflow | null;
  video_export_job?: unknown;
  /** 与后端 GET /api/projects/:id 顶层 outline 一致 */
  outline?: OutlineNodeApi[] | null;
  project: {
    id: number;
    name: string;
    status: string;
    deck_status?: string | null;
    deck_page_size?: string | null;
    deck_style_preset?: string | null;
    input_prompt?: string | null;
    deck_style_user_hint?: string | null;
    deck_style_prompt_text?: string | null;
    tts_voice_type?: string | null;
    pipeline_auto_advance?: boolean;
  };
};

function mergeProjectFromDetailApi(p: Project, data: ProjectDetailApi): Project {
  const pl = {
    outline: Boolean(data.pipeline?.outline),
    audio: Boolean(data.pipeline?.audio),
    deck: Boolean(data.pipeline?.deck),
    video: Boolean(data.pipeline?.video),
  };
  const ds = data.project.deck_status || 'idle';
  const wf = data.workflow ?? null;
  const vej = mapVideoExportJob(data.video_export_job);
  const outlineNodes =
    data.outline != null && Array.isArray(data.outline) ? data.outline : p.outlineNodes;
  const ttsVt = data.project.tts_voice_type;
  const nextPipelineAutoAdvance =
    typeof data.project.pipeline_auto_advance === 'boolean'
      ? data.project.pipeline_auto_advance
      : p.pipelineAutoAdvance !== false;
  return {
    ...p,
    name: data.project.name,
    serverStatus: data.project.status,
    deckStatus: ds,
    pipeline: pl,
    serverWorkflow: wf,
    videoExportJob: vej,
    outlineNodes: outlineNodes ?? null,
    ttsVoiceType:
      ttsVt != null
        ? String(ttsVt).trim() || null
        : p.ttsVoiceType,
    screenSize: (data.project.deck_page_size || p.screenSize || '16:9').trim() || '16:9',
    style:
      DECK_STYLE_DISPLAY[
        (data.project.deck_style_preset || 'aurora_glass').trim() || 'aurora_glass'
      ] ||
      p.style ||
      '极光玻璃',
    workflowSteps: buildWorkflowStepsForProject({
      ...p,
      pipeline: pl,
      pipelineAutoAdvance: nextPipelineAutoAdvance,
      serverStatus: data.project.status,
      deckStatus: ds,
      serverWorkflow: wf,
    }),
    inputPrompt:
      data.project.input_prompt != null
        ? String(data.project.input_prompt)
        : p.inputPrompt,
    deckStyleUserHint:
      data.project.deck_style_user_hint != null
        ? String(data.project.deck_style_user_hint)
        : p.deckStyleUserHint,
    deckStylePromptText:
      data.project.deck_style_prompt_text != null
        ? String(data.project.deck_style_prompt_text)
        : p.deckStylePromptText,
    deckStylePreset: (() => {
      const raw = (data.project.deck_style_preset || p.deckStylePreset || 'aurora_glass').trim();
      return raw || 'aurora_glass';
    })(),
    pipelineAutoAdvance: nextPipelineAutoAdvance,
  };
}

type AuthMe = { id: number; username: string };

/** 与 backend `DECK_STYLE_PRESETS` 对应的列表展示名（`Project.style` 在列表中为中文名） */
const DECK_STYLE_DISPLAY: Record<string, string> = {
  aurora_glass: '极光玻璃',
  minimal_tech: '极简科技',
  dark_neon: '暗黑霓虹',
  editorial_luxury: '杂志高级感',
  futuristic_hud: '未来 HUD',
};

const EMPTY_CLIP: ClipData = {
  id: '_empty',
  type: 'audio',
  label: '—',
  start: 0,
  width: 100,
  duration: '00:00',
  content: '',
  locked: true,
};

const EMPTY_VIDEO_CLIP: ClipData = {
  id: '_empty_video',
  type: 'video',
  label: '—',
  start: 0,
  width: 100,
  duration: '00:00',
  content: '',
  locked: true,
};

const LS_VIEW = 'neoncast_currentView';
const LS_PROJECT = 'neoncast_currentProjectId';
const LS_CLIP = 'neoncast_selectedClipId';
const LS_CLIP_PROJECT = 'neoncast_selectedClipProjectId';
const LS_CLIP_MODE = 'neoncast_selectedClipMode';
const LS_AI_DRAFT_MAP = 'neoncast_ai_draft_map_v1';
const LS_NARRATION_DRAFT_MAP = 'neoncast_narration_draft_map_v1';
/** 配音按草稿重合成后需重新导出：刷新后仍从 sessionStorage 恢复顶栏导出为待处理 */
const LS_EXPORT_STALE_PREFIX = 'neoncast_export_stale_';
/** 单页演示重生成提交后按项目保留节点 id，避免切回主页后丢失轮询恢复 */
const LS_DECK_REGEN_PENDING_PREFIX = 'neoncast_deck_regen_pending_';

type ClipSelectionMode = 'video' | 'audio' | 'none';
type DeckDraftEntry = {
  projectId: number;
  pageId: string;
  pageNodeId: number;
  draftMainTitle: string;
  draftHtml: string;
};

type NarrationDraftEntry = {
  projectId: number;
  stepNodeId: number;
  draftText: string;
};

function readProjectFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const pid = (params.get('project') || '').trim();
    return pid ? pid : null;
  } catch {
    return null;
  }
}

function readInitialRoute(): { view: 'home' | 'editor'; projectId: string | null } {
  if (typeof window === 'undefined') return { view: 'home', projectId: null };
  try {
    if (!getStoredAuthToken()) {
      return { view: 'home', projectId: null };
    }
    const fromUrl = readProjectFromUrl();
    if (fromUrl) return { view: 'editor', projectId: fromUrl };
    const v = localStorage.getItem(LS_VIEW);
    const pid = localStorage.getItem(LS_PROJECT);
    if (v === 'editor' && pid) return { view: 'editor', projectId: pid };
  } catch {
    /* ignore */
  }
  return { view: 'home', projectId: null };
}

export default function App() {
  // const { toggleTheme } = useTheme(); // 顶栏主题按钮暂藏
  const initialRoute = readInitialRoute();
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  /** 避免本地有 token 时首帧仍用未恢复的 userId 打开编辑器 */
  const [sessionReady, setSessionReady] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'editor'>(() =>
    initialRoute.view === 'editor' && !initialRoute.projectId ? 'home' : initialRoute.view,
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() =>
    initialRoute.view === 'editor' && !initialRoute.projectId ? null : initialRoute.projectId,
  );

  const [clips, setClips] = useState<ClipData[]>([]);
  const [workspacePages, setWorkspacePages] = useState<PageData[]>([]);
  const [playSteps, setPlaySteps] = useState<PlayStep[]>([]);
  const [totalDurationMs, setTotalDurationMs] = useState(60_000);
  /** 仅首包 manifest：避免轮询时全屏「加载时间轴」 */
  const [timelineBlocking, setTimelineBlocking] = useState(true);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  /** 来自 play-manifest，避免 projects 未同步时 currentProject?.screenSize 为空而预览退回 16:9 */
  const [previewDeckPageSize, setPreviewDeckPageSize] = useState<string | null>(null);
  const suppressManifestApplyRef = useRef(false);
  const deckWatchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manifestPidHydratedRef = useRef<string | null>(null);
  /** 单页演示重生成：仅用于侧栏页内 busy 与恢复轮询，不参与顶栏工作流步骤推导 */
  const [deckRegenWatchActive, setDeckRegenWatchActive] = useState(false);
  const [deckRegenWatchPageNodeId, setDeckRegenWatchPageNodeId] = useState<number | null>(
    null,
  );
  /** 重试后短时强制轮询，覆盖后端状态回写延迟 */
  const [retryPollBoostUntil, setRetryPollBoostUntil] = useState<number | null>(null);
  /** URL project 参数仅在登录恢复后消费一次，避免“回主页又跳回工程” */
  const urlProjectHydratedRef = useRef(false);
  /** 手动返回主页后，屏蔽一次基于 URL 的自动回跳 */
  const suppressNextUrlProjectHydrateRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  /** 时间轴工具栏：收起左侧 DetailPanel，中间主区域变宽 */
  const [leftDetailCollapsed, setLeftDetailCollapsed] = useState(false);
  /** 时间轴区域默认更高一些，分隔条相对更靠上 */
  const [timelineHeight, setTimelineHeight] = useState(200);
  const [selectedClipId, setSelectedClipId] = useState<string>('');
  const [selectionMode, setSelectionMode] = useState<ClipSelectionMode>('none');
  const [editorRightSidebarOpen, setEditorRightSidebarOpen] = useState(false);
  const [editorRightSidebarModule, setEditorRightSidebarModule] = useState<
    'deck' | 'narration'
  >('deck');
  const [aiPanelClipId, setAiPanelClipId] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [deckDraftMap, setDeckDraftMap] = useState<Record<string, DeckDraftEntry>>({});
  const [narrationPanelClipId, setNarrationPanelClipId] = useState<string | null>(null);
  const [narrationPanelError, setNarrationPanelError] = useState<string | null>(null);
  const [narrationResynthBusy, setNarrationResynthBusy] = useState(false);
  const [narrationApplyBusy, setNarrationApplyBusy] = useState(false);
  const [narrationDraftMap, setNarrationDraftMap] = useState<
    Record<string, NarrationDraftEntry>
  >({});

  useEffect(() => {
    if (!sessionReady) return;
    if (userId == null || currentView !== 'home') return;
    if (suppressNextUrlProjectHydrateRef.current) {
      suppressNextUrlProjectHydrateRef.current = false;
      return;
    }
    if (urlProjectHydratedRef.current) return;
    urlProjectHydratedRef.current = true;
    const urlProject = readProjectFromUrl();
    if (!urlProject) return;
    setCurrentProjectId(urlProject);
    setCurrentView('editor');
  }, [sessionReady, userId, currentView]);

  useEffect(() => {
    if (userId === null) {
      urlProjectHydratedRef.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const pid = readProjectFromUrl();
      if (pid && userId != null) {
        setCurrentProjectId(pid);
        setCurrentView('editor');
        return;
      }
      setCurrentProjectId(null);
      setCurrentView('home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (currentView === 'editor' && currentProjectId) {
        params.set('project', currentProjectId);
      } else {
        params.delete('project');
      }
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${
        nextQuery ? `?${nextQuery}` : ''
      }${window.location.hash}`;
      const currentUrl =
        window.location.pathname + window.location.search + window.location.hash;
      if (nextUrl !== currentUrl) {
        window.history.replaceState(null, '', nextUrl);
      }
    } catch {
      /* ignore */
    }
  }, [currentView, currentProjectId]);

  const [createError, setCreateError] = useState<string | null>(null);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);
  const [exportStatusOpen, setExportStatusOpen] = useState(false);
  /** 正在跟进的导出任务（含项目 id，支持首页下载入口入队后不在编辑器也能收到完成事件） */
  const [exportTracking, setExportTracking] = useState<{
    projectId: number;
    jobId: number;
  } | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [editorFlashMessage, setEditorFlashMessage] = useState<string | null>(null);
  const [editorFlashDownloadUrl, setEditorFlashDownloadUrl] = useState<string | null>(null);
  const [previewSubtitlesVisible, setPreviewSubtitlesVisible] = useState(false);
  const [retryingWorkflowStepId, setRetryingWorkflowStepId] = useState<
    string | null
  >(null);
  const [cancellingRunningWorkflowStepId, setCancellingRunningWorkflowStepId] =
    useState<string | null>(null);
  const [editorDataVersion, setEditorDataVersion] = useState(0);

  const currentProject = useMemo(
    () =>
      currentProjectId ? projects.find((p) => p.id === currentProjectId) : undefined,
    [projects, currentProjectId],
  );
  const [headerTextKickoffPending, setHeaderTextKickoffPending] = useState(false);
  /** 口播分段确认后、workflow 尚未标音频 running 前的乐观态 */
  const [headerAudioWorkflowKickoffPending, setHeaderAudioWorkflowKickoffPending] =
    useState(false);
  /** 母版弹窗确认后、workflow 尚未标母版 running 前的乐观态 */
  const [headerDeckMasterKickoffPending, setHeaderDeckMasterKickoffPending] =
    useState(false);
  /** 点击启动场景页生成后、服务端尚未标 running 前，顶栏乐观为「进行中」（勿用 waiting/pending 清标记，否则与点击前状态相同会误清） */
  const [headerDeckPagesKickoffPending, setHeaderDeckPagesKickoffPending] =
    useState(false);
  const prevDeckSceneStateRef = useRef<WorkflowStep['state'] | undefined>(
    undefined,
  );
  /** 口播助理「按草稿重新合成」进行中，顶栏导出步可标为待处理 */
  const [headerAudioRegenPending, setHeaderAudioRegenPending] = useState(false);
  const [workflowPanelOpen, setWorkflowPanelOpen] = useState(false);
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);
  const [reopeningWorkflowStepId, setReopeningWorkflowStepId] = useState<
    string | null
  >(null);

  const workflowModel = useEditorWorkflowModel({
    currentView,
    currentProject,
    headerTextStructureKickoffPending: headerTextKickoffPending,
    headerAudioRegenPending,
    headerAudioWorkflowKickoffPending,
    headerDeckMasterKickoffPending,
    headerDeckPagesKickoffPending,
    headerDeckRegenPending: deckRegenWatchActive,
    headerExportStaleAfterRegen: false,
    exportFailed,
    exportSubmitting,
  });

  const {
    activeManualDialog,
    closeManualDialog,
    closeConfirmDialog,
    confirmDialog,
    displaySteps: displayWorkflowSteps,
    openConfirmDialog,
    openManualDialogForStep,
  } = workflowModel;
  const editorTimelineUnlocked = workflowModel.timelineUnlocked;

  /** 仅当服务端步骤已 running/success 时收起乐观态；勿用 displayWorkflowSteps（含乐观覆盖，会立刻把 pending 清掉）。 */
  useEffect(() => {
    const t = currentProject?.workflowSteps?.find((s) => s.id === 'text');
    if (t?.state === 'running' || t?.state === 'success') {
      setHeaderTextKickoffPending(false);
    }
  }, [currentProject?.workflowSteps]);

  useEffect(() => {
    prevDeckSceneStateRef.current = undefined;
    setHeaderDeckPagesKickoffPending(false);
    setHeaderAudioWorkflowKickoffPending(false);
    setHeaderDeckMasterKickoffPending(false);
  }, [currentProjectId]);

  useEffect(() => {
    const a = currentProject?.workflowSteps?.find((s) => s.id === 'audio');
    if (a?.state === 'running' || a?.state === 'success') {
      setHeaderAudioWorkflowKickoffPending(false);
    }
  }, [currentProject?.workflowSteps]);

  useEffect(() => {
    const m = currentProject?.workflowSteps?.find((s) => s.id === 'deck_master');
    if (m?.state === 'running' || m?.state === 'success') {
      setHeaderDeckMasterKickoffPending(false);
    }
  }, [currentProject?.workflowSteps]);

  useEffect(() => {
    const dr = currentProject?.workflowSteps?.find(
      (s) => s.id === 'deck_render' || s.id === 'pages',
    );
    const st = dr?.state;
    const prev = prevDeckSceneStateRef.current;
    if (headerDeckPagesKickoffPending) {
      // 仅当服务端步态与「刚点确认」前不同才收乐观：waiting/pending 在点确认前后不变，不能用来清标记。
      if (st === 'running' || st === 'error' || st === 'cancelled') {
        setHeaderDeckPagesKickoffPending(false);
      } else if (st === 'success' && prev === 'running') {
        setHeaderDeckPagesKickoffPending(false);
      }
    }
    prevDeckSceneStateRef.current = st;
  }, [currentProject?.workflowSteps, headerDeckPagesKickoffPending]);

  const isDraggingSidebar = useRef(false);
  const isDraggingTimeline = useRef(false);

  const {
    audioRef,
    currentStep,
    globalMs,
    totalMs,
    isPlaying,
    play,
    pause,
    restart,
    goNext,
    goPrev,
    seekToMs,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
  } = useStepPlayer(playSteps);

  const timelineTotalMs = totalMs || totalDurationMs;
  const currentTime =
    timelineTotalMs > 0 ? Math.min(100, (globalMs / timelineTotalMs) * 100) : 0;

  const selectedClipForPanel = clips.find((c) => c.id === selectedClipId);
  const currentPlayStep = playSteps[currentStep];
  const clipUnderPlayhead = (kind: 'video' | 'audio') =>
    findClipAtTime(clips, kind, currentTime);
  /** 仅当选中的是视频轨片段时左侧跟「指针下视频大页」；选中音频或未选则跟「指针下音频段」 */
  const detailPanelFollowsVideo = selectedClipForPanel?.type === 'video';
  const firstVideoClip = clips.find((c) => c.type === 'video');
  const firstAudioClip = clips.find((c) => c.type === 'audio');
  const detailPanelSurface: 'page' | 'audio' = detailPanelFollowsVideo ? 'page' : 'audio';
  const detailPanelClip: ClipData = detailPanelFollowsVideo
    ? clipUnderPlayhead('video') ??
      (selectedClipForPanel?.type === 'video' ? selectedClipForPanel : undefined) ??
      firstVideoClip ??
      EMPTY_VIDEO_CLIP
    : clipUnderPlayhead('audio') ??
      (selectedClipForPanel?.type === 'audio' ? selectedClipForPanel : undefined) ??
      firstAudioClip ??
      EMPTY_CLIP;
  const aiPanelClip = clips.find((c) => c.id === aiPanelClipId) ?? null;
  const narrationPanelClip = clips.find((c) => c.id === narrationPanelClipId) ?? null;
  const aiPanelPageId = aiPanelClip?.type === 'video' ? aiPanelClip.pageId || '' : '';
  const aiPanelProjectIdNum = Number(currentProjectId);
  const aiDraftKey =
    Number.isFinite(aiPanelProjectIdNum) && aiPanelPageId
      ? `${aiPanelProjectIdNum}:${aiPanelPageId}`
      : '';
  const aiDraft = aiDraftKey ? deckDraftMap[aiDraftKey] : undefined;
  const aiContextPage = workspacePages.find((p) => p.id === aiPanelPageId);
  const aiCurrentDraftHtml = (aiDraft?.draftHtml || aiContextPage?.html || '').trim();
  /** 发给后端的上下文（含 html），面板内单独展示原始 HTML */
  const aiContextPayloadForApi = JSON.stringify(
    {
      page_id: aiPanelPageId,
      main_title: aiContextPage?.title || aiPanelClip?.label || '',
      html: aiCurrentDraftHtml,
    },
    null,
    2,
  );
  const aiContextHtmlText = (aiContextPage?.html || '').trim();
  const workspacePagesWithDraft = useMemo(
    () =>
      workspacePages.map((p) => {
        if (!Number.isFinite(aiPanelProjectIdNum)) return p;
        const k = `${aiPanelProjectIdNum}:${p.id}`;
        const d = deckDraftMap[k];
        if (!d || !d.draftHtml) return p;
        return { ...p, html: d.draftHtml, deckStatus: 'ready' as const };
      }),
    [workspacePages, deckDraftMap, aiPanelProjectIdNum],
  );

  const narrationKeyForPanel = useMemo(() => {
    const pid = Number(currentProjectId);
    const sid = narrationPanelClip
      ? parseStepNodeIdFromClipId(narrationPanelClip.id)
      : null;
    if (!Number.isFinite(pid) || sid == null) return '';
    return `${pid}:${sid}`;
  }, [currentProjectId, narrationPanelClip]);

  const narrationBaselineForPanel = useMemo(() => {
    const c = narrationPanelClip;
    if (!c) return '';
    return (
      playSteps.find((s) => s.clip_id === c.id)?.narration_text ??
      c.content ??
      ''
    );
  }, [narrationPanelClip, playSteps]);

  const narrationDraftTextForPanel = narrationKeyForPanel
    ? narrationDraftMap[narrationKeyForPanel]?.draftText ?? narrationBaselineForPanel
    : '';

  const parseServerIso = (iso: string) => {
    const raw = (iso || '').trim();
    if (!raw) return new Date(NaN);
    // 后端可能返回无时区的 UTC 时间；前端按本地解释会导致北京时间显示偏差。
    const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
    return new Date(hasZone ? raw : `${raw}Z`);
  };

  const formatDateTimeToMinute = (iso: string) => {
    const date = parseServerIso(iso);
    if (Number.isNaN(date.getTime())) return '未知';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
  };

  const reloadEditorWithMessage = useCallback((msg: string) => {
    setEditorFlashDownloadUrl(null);
    setEditorFlashMessage(msg.trim() || null);
    setEditorDataVersion((v) => v + 1);
  }, []);

  const clearDeckWatch = useCallback(() => {
    if (deckWatchTimerRef.current != null) {
      window.clearInterval(deckWatchTimerRef.current);
      deckWatchTimerRef.current = null;
    }
    suppressManifestApplyRef.current = false;
    setDeckRegenWatchActive(false);
    setDeckRegenWatchPageNodeId(null);
  }, []);

  const persistDeckRegenPending = useCallback((pid: number, pageNodeId: number | null) => {
    try {
      const key = `${LS_DECK_REGEN_PENDING_PREFIX}${String(pid)}`;
      if (pageNodeId != null && Number.isFinite(pageNodeId)) {
        sessionStorage.setItem(key, String(pageNodeId));
      } else {
        sessionStorage.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startDeckRegenWatch = useCallback(
    (pid: number, pageNodeId: number) => {
      if (!Number.isFinite(pid) || !Number.isFinite(pageNodeId)) return;
      clearDeckWatch();
      suppressManifestApplyRef.current = true;
      setDeckRegenWatchActive(true);
      setDeckRegenWatchPageNodeId(pageNodeId);
      deckWatchTimerRef.current = window.setInterval(() => {
        void (async () => {
          try {
            const d = await apiFetch<{ page_deck_status?: string | null }>(
              `/api/projects/${pid}/outline-nodes/${pageNodeId}/deck-preview`,
            );
            const st = (d.page_deck_status || '').trim().toLowerCase();
            if (st === 'ready' || st === 'failed' || st === 'cancelled') {
              if (deckWatchTimerRef.current != null) {
                window.clearInterval(deckWatchTimerRef.current);
                deckWatchTimerRef.current = null;
              }
              suppressManifestApplyRef.current = false;
              setDeckRegenWatchActive(false);
              setDeckRegenWatchPageNodeId(null);
              persistDeckRegenPending(pid, null);
              reloadEditorWithMessage(
                st === 'ready'
                  ? '演示页面已更新。'
                  : st === 'cancelled'
                    ? '演示页面生成已取消。'
                    : '演示页面重新生成未成功，请稍后重试。',
              );
            }
          } catch {
            /* 继续轮询 */
          }
        })();
      }, 2000);
    },
    [clearDeckWatch, persistDeckRegenPending, reloadEditorWithMessage],
  );

  const onAudioResynthSuccess = useCallback(() => {
    reloadEditorWithMessage('音频已更新。');
  }, [reloadEditorWithMessage]);

  const onDeckPageRegenSubmitted = useCallback(
    (pageNodeId: number) => {
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      persistDeckRegenPending(pid, pageNodeId);
      startDeckRegenWatch(pid, pageNodeId);
    },
    [currentProjectId, persistDeckRegenPending, startDeckRegenWatch],
  );

  const fetchProjects = useCallback(
    async (uid: number, uname: string | null) => {
      const list = await apiFetch<{ items: ProjectListItem[] }>('/api/projects');
      const items = list.items || [];
      const mapped: Project[] = items.map((item) => {
        const screenSize = item.deck_page_size || '16:9';
        const preset = (item.deck_style_preset || 'aurora_glass').trim() || 'aurora_glass';
        const style = DECK_STYLE_DISPLAY[preset] || preset;
        const updatedAt = item.updated_at || item.created_at;
        const author =
          item.owner_user_id === uid
            ? uname || '我'
            : (item.owner_username?.trim() || (item.owner_user_id ? `用户 ${item.owner_user_id}` : undefined));
        const pipeline = {
          outline: Boolean(item.pipeline?.outline),
          audio: Boolean(item.pipeline?.audio),
          deck: Boolean(item.pipeline?.deck),
          video: Boolean(item.pipeline?.video),
        };
        const deckStatus = item.deck_status || 'idle';
        const wf = item.workflow ?? null;
        const pipelineAutoAdvance = item.pipeline_auto_advance !== false;
        return {
          id: String(item.id),
          name: item.name,
          screenSize,
          style,
          lastModified: formatDateTimeToMinute(updatedAt),
          serverStatus: item.status,
          deckStatus,
          pipeline,
          serverWorkflow: wf,
          workflowSteps: buildWorkflowStepsForProject({
            pipeline,
            serverStatus: item.status,
            deckStatus,
            serverWorkflow: wf,
            pipelineAutoAdvance,
          }),
          author,
          isShared: item.is_shared,
          ownerUserId: item.owner_user_id,
          deckMasterSourceProjectId: parseDeckMasterSourceProjectId(
            item.deck_master_source_project_id,
          ),
          videoExportJob: mapVideoExportJob(item.video_export_job),
          pipelineAutoAdvance,
        };
      });
      setProjects(mapped);
    },
    []
  );

  const [projectsError, setProjectsError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setProjectsError(null);
    setSessionReady(false);
    if (!getStoredAuthToken()) {
      setUserId(null);
      setUsername(null);
      setProjects([]);
      try {
        localStorage.removeItem(LS_VIEW);
        localStorage.removeItem(LS_PROJECT);
        localStorage.removeItem(LS_CLIP);
        localStorage.removeItem(LS_CLIP_PROJECT);
      } catch {
        /* ignore */
      }
      setCurrentView('home');
      setCurrentProjectId(null);
      setSessionReady(true);
      return;
    }
    let uid: number | null = null;
    let uname: string | null = null;
    try {
      const me = await apiFetch<AuthMe>('/api/auth/me');
      uid = me.id;
      uname = me.username;
    } catch (e) {
      const unauthorized = e instanceof ApiError && e.status === 401;
      if (unauthorized) {
        setStoredAuthToken(null);
        setUserId(null);
        setUsername(null);
        setProjects([]);
        try {
          localStorage.removeItem(LS_VIEW);
          localStorage.removeItem(LS_PROJECT);
          localStorage.removeItem(LS_CLIP);
          localStorage.removeItem(LS_CLIP_PROJECT);
        } catch {
          /* ignore */
        }
        setCurrentView('home');
        setCurrentProjectId(null);
      } else {
        setProjectsError(e instanceof Error ? e.message : String(e));
      }
      setSessionReady(true);
      return;
    }
    setUserId(uid);
    setUsername(uname);
    try {
      await fetchProjects(uid, uname);
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : String(e));
      setProjects([]);
    } finally {
      setSessionReady(true);
    }
  }, [fetchProjects]);

  const handleLogout = useCallback(async () => {
    const t = getStoredAuthToken();
    if (t) {
      try {
        await apiFetch('/api/auth/logout', { method: 'POST' });
      } catch {
        /* ignore */
      }
      setStoredAuthToken(null);
    }
    try {
      localStorage.removeItem(LS_VIEW);
      localStorage.removeItem(LS_PROJECT);
      localStorage.removeItem(LS_CLIP);
      localStorage.removeItem(LS_CLIP_PROJECT);
    } catch {
      /* ignore */
    }
    setCurrentView('home');
    setCurrentProjectId(null);
    await bootstrap();
  }, [bootstrap]);

  const handleClipChange = (id: string, updates: Partial<ClipData>) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.locked) return c;
        return { ...c, ...updates };
      })
    );
  };

  const handleSelectClip = useCallback(
    (id: string) => {
      setSelectedClipId(id);
      const clip = clips.find((c) => c.id === id);
      if (!clip) {
        setSelectionMode('none');
        return;
      }
      setSelectionMode(clip.type === 'video' ? 'video' : 'audio');
    },
    [clips],
  );

  const handleOpenAiPanelForVideoClip = useCallback((clip: ClipData) => {
    if (clip.type !== 'video') return;
    const pid = Number(currentProjectId);
    const pageId = (clip.pageId || '').trim();
    const pageNodeId = parsePageNodeIdFromPageId(pageId);
    const page = workspacePages.find((p) => p.id === pageId);
    if (Number.isFinite(pid) && pageId && Number.isFinite(pageNodeId)) {
      const key = `${pid}:${pageId}`;
      setDeckDraftMap((prev) => {
        if (prev[key]) return prev;
        return {
          ...prev,
          [key]: {
            projectId: pid,
            pageId,
            pageNodeId,
            draftMainTitle: String(page?.title || clip.label || ''),
            draftHtml: String(page?.html || '').trim(),
          },
        };
      });
    }
    setSelectedClipId(clip.id);
    setSelectionMode('video');
    setAiPanelClipId(clip.id);
    setEditorRightSidebarModule('deck');
    setEditorRightSidebarOpen(true);
    setAiError(null);
  }, [currentProjectId, workspacePages]);

  const handleOpenNarrationPanelForAudioClip = useCallback(
    (clip: ClipData) => {
      if (clip.type !== 'audio') return;
      const st = playSteps.find((s) => s.clip_id === clip.id);
      if (st?.kind === 'pause') {
        setEditorFlashDownloadUrl(null);
        setEditorFlashMessage('停顿段不支持在口播助理中编辑。');
        return;
      }
      const pid = Number(currentProjectId);
      const stepNodeId = parseStepNodeIdFromClipId(clip.id);
      if (!Number.isFinite(pid) || stepNodeId == null) {
        setEditorFlashDownloadUrl(null);
        setEditorFlashMessage('无法解析该音频片段节点。');
        return;
      }
      setSelectedClipId(clip.id);
      setSelectionMode('audio');
      setNarrationPanelClipId(clip.id);
      setEditorRightSidebarModule('narration');
      setEditorRightSidebarOpen(true);
      setNarrationPanelError(null);
      const baseline = (
        playSteps.find((s) => s.clip_id === clip.id)?.narration_text ??
        clip.content ??
        ''
      ).trim();
      const key = `${pid}:${stepNodeId}`;
      setNarrationDraftMap((prev) => {
        if (prev[key]) return prev;
        return {
          ...prev,
          [key]: { projectId: pid, stepNodeId, draftText: baseline },
        };
      });
    },
    [currentProjectId, playSteps],
  );

  const handleNarrationDraftChange = useCallback(
    (next: string) => {
      const c = narrationPanelClip;
      if (!c || c.type !== 'audio') return;
      const pid = Number(currentProjectId);
      const sid = parseStepNodeIdFromClipId(c.id);
      if (!Number.isFinite(pid) || sid == null) return;
      const key = `${pid}:${sid}`;
      setNarrationDraftMap((prev) => ({
        ...prev,
        [key]: { projectId: pid, stepNodeId: sid, draftText: next },
      }));
    },
    [narrationPanelClip, currentProjectId],
  );

  const handleDiscardNarrationDraft = useCallback(() => {
    const c = narrationPanelClip;
    if (!c || c.type !== 'audio') return;
    const pid = Number(currentProjectId);
    const sid = parseStepNodeIdFromClipId(c.id);
    if (!Number.isFinite(pid) || sid == null) return;
    const key = `${pid}:${sid}`;
    setNarrationDraftMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setNarrationPanelError(null);
  }, [narrationPanelClip, currentProjectId]);

  const handleResynthesizeNarrationDraft = useCallback(async () => {
    const c = narrationPanelClip;
    if (!c || c.type !== 'audio') return;
    const pid = Number(currentProjectId);
    const sid = parseStepNodeIdFromClipId(c.id);
    if (!Number.isFinite(pid) || sid == null) return;
    const key = `${pid}:${sid}`;
    const text = (narrationDraftMap[key]?.draftText ?? '').trim();
    if (!text) {
      setNarrationPanelError('口播草稿为空，无法合成。');
      return;
    }
    setNarrationResynthBusy(true);
    setNarrationPanelError(null);
    setHeaderAudioRegenPending(true);
    try {
      const resp = await apiFetch<{ reused_existing?: boolean; message?: string }>(
        `/api/projects/${pid}/outline-nodes/${sid}/resynthesize-audio`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        },
      );
      if (resp?.reused_existing) {
        setEditorFlashDownloadUrl(null);
        setEditorFlashMessage(resp.message || '该段音频已就绪。');
      } else {
        if (currentProjectId) {
          try {
            sessionStorage.setItem(`${LS_EXPORT_STALE_PREFIX}${currentProjectId}`, '1');
          } catch {
            /* ignore */
          }
        }
        reloadEditorWithMessage(
          '已按草稿重新合成音频。请点击「应用」将当前草稿写入库内正文。',
        );
      }
    } catch (e) {
      setNarrationPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setNarrationResynthBusy(false);
      setHeaderAudioRegenPending(false);
    }
  }, [narrationPanelClip, currentProjectId, narrationDraftMap, reloadEditorWithMessage]);

  const handleApplyNarrationDraft = useCallback(async () => {
    const c = narrationPanelClip;
    if (!c || c.type !== 'audio') return;
    const pid = Number(currentProjectId);
    const sid = parseStepNodeIdFromClipId(c.id);
    if (!Number.isFinite(pid) || sid == null) return;
    const key = `${pid}:${sid}`;
    const text = narrationDraftMap[key]?.draftText ?? '';
    const baseline = (
      playSteps.find((s) => s.clip_id === c.id)?.narration_text ?? c.content ?? ''
    ).trim();
    if (text.trim() === baseline) {
      setNarrationPanelError('草稿与已保存台词一致，无需应用。');
      return;
    }
    setNarrationApplyBusy(true);
    setNarrationPanelError(null);
    try {
      await apiFetch(`/api/projects/${pid}/outline-nodes/${sid}/narration-text`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narration_text: text }),
      });
      setNarrationDraftMap((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      reloadEditorWithMessage('口播正文已保存。');
    } catch (e) {
      setNarrationPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setNarrationApplyBusy(false);
    }
  }, [narrationPanelClip, currentProjectId, narrationDraftMap, playSteps, reloadEditorWithMessage]);

  const handleGenerateAiDraft = useCallback(
    async (instruction: string) => {
      if (!aiPanelClip || aiPanelClip.type !== 'video') return;
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      const pageNodeId = parsePageNodeIdFromPageId(aiPanelClip.pageId);
      if (!Number.isFinite(pageNodeId)) {
        setAiError('无法解析当前页面节点。');
        return;
      }
      setAiGenerating(true);
      setAiError(null);
      try {
        const resp = await apiFetch<{
          draft_json: Record<string, unknown>;
          draft_html: string;
          main_title: string;
        }>(`/api/projects/${pid}/outline-nodes/${pageNodeId}/contextual-ai/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instruction, current_json: aiContextPayloadForApi }),
        });
        const draftHtml = String(resp.draft_html || '').trim();
        if (!draftHtml) {
          setAiError('AI 返回结果缺少 html。');
          return;
        }
        const pageId = aiPanelClip.pageId || '';
        const key = `${pid}:${pageId}`;
        setDeckDraftMap((prev) => ({
          ...prev,
            [key]: {
            projectId: pid,
            pageId,
            pageNodeId,
            draftMainTitle: String(resp.main_title || aiPanelClip.label || ''),
            draftHtml,
          },
        }));
      } catch (e) {
        setAiError(e instanceof Error ? e.message : String(e));
      } finally {
        setAiGenerating(false);
      }
    },
    [aiPanelClip, aiContextPayloadForApi, currentProjectId],
  );

  const handleApplyAiDraft = useCallback(async () => {
    const draft = aiDraft;
    if (!draft) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      await apiFetch(`/api/projects/${draft.projectId}/outline-nodes/${draft.pageNodeId}/contextual-ai/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draft_json: {
            main_title: draft.draftMainTitle,
            html: draft.draftHtml,
          },
        }),
      });
      setDeckDraftMap((prev) => {
        const next = { ...prev };
        delete next[`${draft.projectId}:${draft.pageId}`];
        return next;
      });
      reloadEditorWithMessage('AI 草稿已应用并保存。');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiGenerating(false);
    }
  }, [aiDraft, reloadEditorWithMessage]);

  const handleDiscardAiDraft = useCallback(() => {
    if (!aiPanelClip || aiPanelClip.type !== 'video') return;
    const pid = Number(currentProjectId);
    const pageId = (aiPanelClip.pageId || '').trim();
    const pageNodeId = parsePageNodeIdFromPageId(pageId);
    if (!Number.isFinite(pid) || !pageId || !Number.isFinite(pageNodeId)) return;
    const page = workspacePages.find((p) => p.id === pageId);
    setDeckDraftMap((prev) => {
      const key = `${pid}:${pageId}`;
      return {
        ...prev,
        [key]: {
          projectId: pid,
          pageId,
          pageNodeId,
          draftMainTitle: String(page?.title || aiPanelClip.label || ''),
          draftHtml: String(page?.html || '').trim(),
        },
      };
    });
  }, [aiPanelClip, currentProjectId, workspacePages]);

  const handleEditAiDraft = useCallback(
    (nextHtml: string) => {
      if (!aiPanelClip || aiPanelClip.type !== 'video') return;
      const pid = Number(currentProjectId);
      const pageId = (aiPanelClip.pageId || '').trim();
      const pageNodeId = parsePageNodeIdFromPageId(pageId);
      if (!Number.isFinite(pid) || !pageId || !Number.isFinite(pageNodeId)) return;
      const page = workspacePages.find((p) => p.id === pageId);
      const key = `${pid}:${pageId}`;
      setDeckDraftMap((prev) => ({
        ...prev,
        [key]: {
          projectId: pid,
          pageId,
          pageNodeId,
          draftMainTitle: String(prev[key]?.draftMainTitle || page?.title || aiPanelClip.label || ''),
          draftHtml: nextHtml,
        },
      }));
    },
    [aiPanelClip, currentProjectId, workspacePages],
  );

  /** 编辑器内当前项目：用于轮询与主工作台步骤（与 currentProject 在工程页等价） */
  const pollEditorProject =
    currentView === 'editor' && currentProjectId
      ? projects.find((p) => p.id === currentProjectId)
      : undefined;
  const pollPipelineSatisfied = Boolean(
    pollEditorProject?.pipeline?.outline &&
      pollEditorProject?.pipeline?.audio &&
      pollEditorProject?.pipeline?.deck,
  );
  const pollWorkflowRunning =
    pollEditorProject?.workflowSteps?.some((s) => s.state === 'running') ?? false;
  /** 轮询项目详情：流水线未齐、任一步 running、或重试后短时加强拉取 */
  const shouldPollProjectDetail =
    Boolean(pollEditorProject) &&
    (!pollPipelineSatisfied ||
      pollWorkflowRunning ||
      (retryPollBoostUntil != null && retryPollBoostUntil > Date.now()));

  /** 流水线三态变化时补拉一次 play-manifest（不定时轮询画面） */
  const manifestReloadKey = useMemo(() => {
    const plp = pollEditorProject?.pipeline;
    if (!plp) return '0-0-0';
    return `${plp.outline ? 1 : 0}-${plp.audio ? 1 : 0}-${plp.deck ? 1 : 0}`;
  }, [
    pollEditorProject?.pipeline?.outline,
    pollEditorProject?.pipeline?.audio,
    pollEditorProject?.pipeline?.deck,
  ]);

  useEffect(() => {
    if (retryPollBoostUntil == null) return;
    const remain = retryPollBoostUntil - Date.now();
    if (remain <= 0) {
      setRetryPollBoostUntil(null);
      return;
    }
    const t = window.setTimeout(() => {
      setRetryPollBoostUntil(null);
    }, remain + 20);
    return () => window.clearTimeout(t);
  }, [retryPollBoostUntil]);

  const handleSidebarMouseDown = () => {
    isDraggingSidebar.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleTimelineMouseDown = () => {
    isDraggingTimeline.current = true;
    document.body.style.cursor = 'row-resize';
  };

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_VIEW, currentView);
      if (currentProjectId) {
        localStorage.setItem(LS_PROJECT, currentProjectId);
      } else {
        localStorage.removeItem(LS_PROJECT);
      }
    } catch {
      /* ignore */
    }
  }, [currentView, currentProjectId]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    try {
      localStorage.setItem(LS_CLIP_PROJECT, currentProjectId);
      localStorage.setItem(LS_CLIP_MODE, selectionMode);
      if (selectedClipId) {
        localStorage.setItem(LS_CLIP, selectedClipId);
      } else {
        localStorage.removeItem(LS_CLIP);
      }
    } catch {
      /* ignore */
    }
  }, [currentView, currentProjectId, selectedClipId, selectionMode]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_AI_DRAFT_MAP);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, DeckDraftEntry>;
      if (parsed && typeof parsed === 'object') {
        setDeckDraftMap(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_AI_DRAFT_MAP, JSON.stringify(deckDraftMap));
    } catch {
      /* ignore */
    }
  }, [deckDraftMap]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_NARRATION_DRAFT_MAP);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, NarrationDraftEntry>;
      if (parsed && typeof parsed === 'object') {
        setNarrationDraftMap(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_NARRATION_DRAFT_MAP, JSON.stringify(narrationDraftMap));
    } catch {
      /* ignore */
    }
  }, [narrationDraftMap]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    if (projects.length === 0) return;
    const exists = projects.some((p) => p.id === currentProjectId);
    if (!exists) {
      setCurrentView('home');
      setCurrentProjectId(null);
    }
  }, [currentView, currentProjectId, projects]);

  useEffect(() => {
    if (!editorFlashMessage) return;
    const t = window.setTimeout(() => {
      setEditorFlashMessage(null);
      setEditorFlashDownloadUrl(null);
    }, 6000);
    return () => window.clearTimeout(t);
  }, [editorFlashMessage]);

  useEffect(() => {
    clearDeckWatch();
    setExportSubmitting(false);
    setExportChoiceOpen(false);
    setExportStatusOpen(false);
    setExportTracking(null);
    setExportFailed(false);
    setPreviewSubtitlesVisible(false);
    setRetryingWorkflowStepId(null);
    setPreviewDeckPageSize(null);
    // 切项目时立即清空旧时间轴，避免短暂显示上一个项目内容。
    setTimelineBlocking(true);
    setTimelineError(null);
    setWorkspacePages([]);
    setClips([]);
    setPlaySteps([]);
    setSelectedClipId('');
    setSelectionMode('none');
    setEditorRightSidebarOpen(false);
    setEditorRightSidebarModule('deck');
    setAiPanelClipId(null);
    setAiGenerating(false);
    setAiError(null);
    setNarrationPanelClipId(null);
    setNarrationPanelError(null);
    setNarrationResynthBusy(false);
    setNarrationApplyBusy(false);
    setHeaderAudioRegenPending(false);
    setLeftDetailCollapsed(false);
  }, [currentProjectId, clearDeckWatch]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;
    let persistedNodeIdRaw: string | null = null;
    try {
      persistedNodeIdRaw = sessionStorage.getItem(
        `${LS_DECK_REGEN_PENDING_PREFIX}${String(pid)}`,
      );
    } catch {
      persistedNodeIdRaw = null;
    }
    const pageNodeId = persistedNodeIdRaw ? Number(persistedNodeIdRaw) : NaN;
    if (!Number.isFinite(pageNodeId)) return;
    if (deckRegenWatchActive) return;
    startDeckRegenWatch(pid, pageNodeId);
  }, [currentView, currentProjectId, deckRegenWatchActive, startDeckRegenWatch]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;

    let cancelled = false;
    const pidKey = String(pid);

    if (!editorTimelineUnlocked) {
      if (manifestPidHydratedRef.current !== pidKey) {
        manifestPidHydratedRef.current = pidKey;
        setTimelineError(null);
      }
      setTimelineBlocking(false);
      return () => {
        cancelled = true;
      };
    }

    if (manifestPidHydratedRef.current !== pidKey) {
      manifestPidHydratedRef.current = pidKey;
      setTimelineError(null);
    }
    setTimelineBlocking(true);

    void (async () => {
      try {
        const manifest = await apiFetch<PlayManifest>(`/api/projects/${pid}/play-manifest`);
        if (cancelled) return;

        const built = buildTimelineFromPlayManifest(manifest);
        const psz = (manifest.deck_page_size || '').trim();
        setPreviewDeckPageSize(psz || null);
        setWorkspacePages(built.pages);
        setClips(built.clips);
        setPlaySteps(built.steps);
        setTotalDurationMs(built.totalDurationMs);
        const firstAudio = built.clips.find((c) => c.type === 'audio');
        let nextSel = firstAudio?.id || built.clips[0]?.id || '';
        let nextMode: ClipSelectionMode = nextSel
          ? firstAudio
            ? 'audio'
            : 'video'
          : 'none';
        try {
          const persistedPid = localStorage.getItem(LS_CLIP_PROJECT);
          const persistedCid = localStorage.getItem(LS_CLIP);
          const persistedModeRaw = localStorage.getItem(LS_CLIP_MODE);
          const persistedMode: ClipSelectionMode =
            persistedModeRaw === 'video' || persistedModeRaw === 'audio' || persistedModeRaw === 'none'
              ? persistedModeRaw
              : 'none';
          if (persistedPid === String(pid)) {
            if (persistedMode === 'none') {
              nextSel = '';
              nextMode = 'none';
            } else if (
              persistedCid &&
              built.clips.some((c) => c.id === persistedCid)
            ) {
              nextSel = persistedCid;
              nextMode = persistedMode;
            }
          }
        } catch {
          /* ignore */
        }
        setSelectedClipId(nextSel);
        setSelectionMode(nextMode);
        setTimelineError(null);
      } catch (e) {
        if (!cancelled) {
          setTimelineError(e instanceof Error ? e.message : String(e));
          setPreviewDeckPageSize(null);
          setWorkspacePages([]);
          setClips([]);
          setPlaySteps([]);
          setSelectedClipId('');
          setSelectionMode('none');
        }
      } finally {
        if (!cancelled) setTimelineBlocking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentView,
    currentProjectId,
    editorTimelineUnlocked,
    manifestReloadKey,
    editorDataVersion,
  ]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) {
      manifestPidHydratedRef.current = null;
    }
  }, [currentView, currentProjectId]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;

    const sync = () => {
      void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`)
        .then((data) => {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === String(pid) ? mergeProjectFromDetailApi(p, data) : p,
            ),
          );
        })
        .catch(() => {});
    };

    sync();

    if (!shouldPollProjectDetail) {
      return () => {};
    }

    const t = window.setInterval(sync, 4000);
    return () => window.clearInterval(t);
  }, [currentView, currentProjectId, shouldPollProjectDetail, editorDataVersion]);

  useEffect(() => {
    if (currentView !== 'editor' || userId === null) return;
    void fetchProjects(userId, username);
  }, [currentView, userId, username, fetchProjects]);

  useEffect(() => {
    if (userId !== null) return;
    if (getStoredAuthToken()) return;
    if (currentView === 'editor') {
      setCurrentView('home');
      setCurrentProjectId(null);
    }
  }, [userId, currentView]);

  useEffect(() => {
    if (!playSteps.length) return;
    restart();
  }, [playSteps, restart]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentPlayStep) return;
    if (selectionMode === 'none') {
      if (selectedClipId) setSelectedClipId('');
      return;
    }

    const targetClipId =
      selectionMode === 'audio'
        ? currentPlayStep.clip_id
        : clips.find(
            (c) => c.type === 'video' && c.pageId === currentPlayStep.pageId,
          )?.id || '';

    if (!targetClipId) return;
    if (targetClipId !== selectedClipId) {
      setSelectedClipId(targetClipId);
    }
  }, [
    currentView,
    currentPlayStep,
    selectionMode,
    clips,
    selectedClipId,
  ]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar.current) {
        const newWidth = Math.max(200, Math.min(e.clientX, 600));
        setSidebarWidth(newWidth);
      }
      if (isDraggingTimeline.current) {
        const newHeight = window.innerHeight - e.clientY;
        setTimelineHeight(Math.max(150, Math.min(newHeight, window.innerHeight - 200)));
      }
    };
    const handleMouseUp = () => {
      isDraggingSidebar.current = false;
      isDraggingTimeline.current = false;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleTogglePlay = () => {
    if (currentTime >= 100) {
      seekToMs(0);
    }
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  const handleSeek = (time: number) => {
    const targetMs = (time / 100) * timelineTotalMs;
    seekToMs(targetMs);
  };

  const makeDownloadFileName = useCallback((projectName?: string | null) => {
    const raw = (projectName || '').trim() || 'project';
    const safe = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
    const base = safe || 'project';
    return base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`;
  }, []);

  const startBrowserDownload = useCallback(
    async (finalUrl: string, projectName?: string | null) => {
      const filename = makeDownloadFileName(projectName);
      try {
        const token = getAuthBearerToken();
        const res = await fetch(finalUrl, {
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (!res.ok) {
          throw new Error(`下载失败：HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
        return;
      } catch {
        const link = document.createElement('a');
        link.href = finalUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    },
    [makeDownloadFileName],
  );

  const postExportVideoBody = useCallback(
    (opts?: { forceReexport?: boolean }) =>
      JSON.stringify({
        frontend_url:
          (import.meta.env.VITE_EXPORT_PLAY_ORIGIN as string | undefined)?.trim() ||
          (typeof window !== 'undefined' ? window.location.origin : null),
        ...(opts?.forceReexport ? { force_reexport: true } : {}),
      }),
    [],
  );

  const applyExportVideoResponse = useCallback(
    (
      pid: number,
      res: {
        action?: string;
        export_job_id?: number | null;
        pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
      },
    ) => {
      const nextPl = {
        outline: Boolean(res.pipeline.outline),
        audio: Boolean(res.pipeline.audio),
        deck: Boolean(res.pipeline.deck),
        video: Boolean(res.pipeline.video),
      };
      const queued = (res.action || '').trim().toLowerCase() === 'queued';
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== String(pid)) return p;
          let sw = p.serverWorkflow ?? null;
          if (nextPl.video && sw) {
            sw = { ...sw, exportStatus: 'success' as const, exportWorkflowStatus: 'export_success' };
          } else if (queued) {
            sw = {
              ...(sw ?? {}),
              exportWorkflowStatus: 'exporting',
            };
          }
          let nextVideoJob: VideoExportJobInfo | null = p.videoExportJob ?? null;
          if (nextPl.video) {
            nextVideoJob = null;
          } else if (queued && res.export_job_id != null) {
            nextVideoJob = {
              job_id: res.export_job_id,
              status: 'queued',
              worker_id: null,
              created_at: null,
              started_at: null,
            };
          }
          return {
            ...p,
            pipeline: nextPl,
            serverWorkflow: sw,
            videoExportJob: nextVideoJob,
            workflowSteps: buildWorkflowStepsForProject({
              ...p,
              pipeline: nextPl,
              serverWorkflow: sw,
            }),
          };
        }),
      );
    },
    [],
  );

  const handleDownloadVideoClick = useCallback(
    async (opts?: { forceReexport?: boolean }) => {
      if (exportSubmitting || !currentProjectId) return;
      setEditorFlashDownloadUrl(null);
      setExportFailed(false);
      const project = projects.find((p) => p.id === currentProjectId);
      const pl = project?.pipeline;
      const firstThreeOk = Boolean(pl?.outline && pl?.audio && pl?.deck);
      if (!firstThreeOk) {
        setEditorFlashMessage('请先完成文本结构化、音频与场景生成后再下载。');
        return;
      }
      const exportStepState = project?.workflowSteps?.find((s) => s.id === 'export')?.state;
      if (exportStepState === 'running') {
        setExportStatusOpen(true);
        return;
      }
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      const forceReexport = Boolean(opts?.forceReexport);
      setExportSubmitting(true);
      try {
        const res = await apiFetch<{
          output_url: string;
          action: 'export' | 'download' | 'queued';
          export_job_id?: number | null;
          pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
        }>(`/api/projects/${pid}/export-video`, {
          method: 'POST',
          body: postExportVideoBody(forceReexport ? { forceReexport: true } : undefined),
        });
        applyExportVideoResponse(pid, res);
        if (res.action === 'queued') {
          if (res.export_job_id != null) {
            setExportTracking({ projectId: pid, jobId: res.export_job_id });
          }
          setExportStatusOpen(true);
          setEditorFlashDownloadUrl(null);
          setEditorFlashMessage(
            '导出任务已排队，将由远程 worker 处理；完成后将按任务状态提示（也可点「导出中」查看进度）。',
          );
          return;
        }
        setExportTracking(null);
        if (!res.pipeline.video) {
          setEditorFlashDownloadUrl(null);
          setEditorFlashMessage('导出尚未完成，请稍后再试。');
          setExportTracking(null);
          return;
        }
        const finalUrl = apiUrl(res.output_url);
        if (typeof window !== 'undefined') {
          await startBrowserDownload(finalUrl, project?.name);
        }
        setEditorFlashDownloadUrl(finalUrl);
        if (res.action === 'export') {
          setEditorFlashMessage('导出已完成并开始下载。若浏览器拦截，请点击下载链接。');
        } else {
          setEditorFlashMessage('下载已开始。若浏览器拦截，请点击下载链接。');
        }
      } catch (e) {
        setExportFailed(true);
        setExportTracking(null);
        setEditorFlashDownloadUrl(null);
        setEditorFlashMessage(e instanceof Error ? e.message : String(e));
        void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`)
          .then((data) => {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === String(pid) ? mergeProjectFromDetailApi(p, data) : p,
              ),
            );
          })
          .catch(() => {});
      } finally {
        setExportSubmitting(false);
      }
    },
    [
      applyExportVideoResponse,
      currentProjectId,
      exportSubmitting,
      postExportVideoBody,
      projects,
      startBrowserDownload,
    ],
  );

  const handleExportChoiceDownloadOnly = useCallback(async () => {
    setExportChoiceOpen(false);
    await handleDownloadVideoClick({ forceReexport: false });
  }, [handleDownloadVideoClick]);

  const handleExportChoiceForceReexport = useCallback(async () => {
    setExportChoiceOpen(false);
    await handleDownloadVideoClick({ forceReexport: true });
  }, [handleDownloadVideoClick]);

  const handleRetryWorkflowStep = useCallback(
    async (stepId: string) => {
      if (stepId === 'export') {
        setExportChoiceOpen(true);
        return;
      }
      if (stepId === 'pages' || stepId === 'deck_render') {
        openManualDialogForStep(stepId);
        return;
      }
      if (!currentProjectId) return;
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      const stepState = displayWorkflowSteps.find((s) => s.id === stepId)?.state;
      if (
        currentProject?.pipelineAutoAdvance === false &&
        (stepState === 'waiting' || stepState === 'pending')
      ) {
        openManualDialogForStep(stepId);
        return;
      }
      setRetryingWorkflowStepId(stepId);
      setEditorFlashDownloadUrl(null);
      try {
        const jsonHeaders = { 'Content-Type': 'application/json' };
        if (stepId === 'text') {
          setHeaderTextKickoffPending(true);
          await apiFetch(`/api/projects/${pid}/workflow/text/run`, {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
          });
          setEditorFlashMessage('已排队重新生成文案，请稍候。');
        } else if (stepId === 'audio') {
          await apiFetch(`/api/projects/${pid}/workflow/audio/run`, {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
          });
          setEditorFlashMessage('配音任务已提交。');
        } else if (stepId === 'pages' || stepId === 'deck_render') {
          setHeaderDeckPagesKickoffPending(true);
          await apiFetch(`/api/projects/${pid}/workflow/demo/run`, {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
          });
          setEditorFlashMessage('演示页生成已启动。');
        } else if (stepId === 'deck_master') {
          await apiFetch(`/api/projects/${pid}/workflow/deck_master/run`, {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
          });
          setEditorFlashMessage('演示母版已刷新。');
        } else {
          return;
        }
        setRetryPollBoostUntil(Date.now() + 20_000);
        if (userId !== null) {
          await fetchProjects(userId, username);
        }
      } catch (e) {
        if (stepId === 'text') setHeaderTextKickoffPending(false);
        if (stepId === 'pages' || stepId === 'deck_render') {
          setHeaderDeckPagesKickoffPending(false);
        }
        setEditorFlashMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setRetryingWorkflowStepId((cur) => (cur === stepId ? null : cur));
      }
    },
    [
      currentProject?.pipelineAutoAdvance,
      currentProjectId,
      displayWorkflowSteps,
      fetchProjects,
      handleDownloadVideoClick,
      openManualDialogForStep,
      userId,
      username,
    ],
  );

  const handleCancelRunningWorkflowStep = useCallback(
    (stepId: string) => {
      if (!currentProjectId) return;
      openConfirmDialog('cancel', stepId);
    },
    [currentProjectId, openConfirmDialog],
  );

  const handleConfirmPipelineCancel = useCallback(async () => {
    if (confirmDialog.kind !== 'cancel' || !confirmDialog.stepId || !currentProjectId) {
      return;
    }
    const stepId = confirmDialog.stepId;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;
    setCancellingRunningWorkflowStepId(stepId);
    setEditorFlashDownloadUrl(null);
    try {
      const cancelRes = await apiFetch<{
        ok?: boolean;
        pipeline_auto_advance?: boolean;
      }>(`/api/projects/${pid}/workflow/step/cancel-running`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepId }),
      });
      const pipelinePatch =
        typeof cancelRes.pipeline_auto_advance === 'boolean'
          ? { pipelineAutoAdvance: cancelRes.pipeline_auto_advance }
          : null;

      if (stepId === 'export') {
        setExportSubmitting(false);
        setExportTracking(null);
        setExportStatusOpen(false);
        setExportFailed(false);
        setEditorFlashDownloadUrl(null);
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== String(pid)) return p;
            const sw: ServerWorkflow | null =
              p.serverWorkflow != null
                ? {
                    ...p.serverWorkflow,
                    exportStatus: 'failed',
                    exportWorkflowStatus: 'export_failed',
                  }
                : p.serverWorkflow;
            const j = p.videoExportJob;
            const nextJob: VideoExportJobInfo | null =
              j && (j.status === 'queued' || j.status === 'running')
                ? {
                    ...j,
                    status: 'failed',
                    error_message: '用户取消',
                    finished_at: new Date().toISOString(),
                  }
                : (p.videoExportJob ?? null);
            return mergeProjectWorkflowState(p, {
              ...(pipelinePatch ?? {}),
              serverWorkflow: sw,
              videoExportJob: nextJob,
            });
          }),
        );
        setEditorFlashMessage('已取消视频导出。');
      } else {
        if (pipelinePatch) {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === String(pid) ? mergeProjectWorkflowState(p, pipelinePatch) : p,
            ),
          );
        }
        setEditorFlashMessage('已提交取消请求。');
      }
      closeConfirmDialog();
      if (stepId === 'pages' || stepId === 'deck_render') {
        clearDeckWatch();
        persistDeckRegenPending(pid, null);
      }
      setRetryPollBoostUntil(Date.now() + 12_000);
      if (userId !== null) {
        await fetchProjects(userId, username);
      }
    } catch (e) {
      setEditorFlashMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingRunningWorkflowStepId((cur) =>
        cur === stepId ? null : cur,
      );
    }
  }, [
    clearDeckWatch,
    closeConfirmDialog,
    confirmDialog.kind,
    confirmDialog.stepId,
    currentProjectId,
    fetchProjects,
    persistDeckRegenPending,
    userId,
    username,
  ]);

  const handleReopenSuccessStep = useCallback(
    async (stepId: string) => {
      if (!currentProjectId) return;
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      setReopeningWorkflowStepId(stepId);
      try {
        const reopenRes = await apiFetch<{
          ok?: boolean;
          pipeline_auto_advance?: boolean;
        }>(`/api/projects/${pid}/workflow/step/reopen-success`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: stepId }),
        });
        if (typeof reopenRes.pipeline_auto_advance === 'boolean') {
          setProjects((prev) =>
            prev.map((p) =>
              p.id === String(pid)
                ? mergeProjectWorkflowState(p, {
                    pipelineAutoAdvance: reopenRes.pipeline_auto_advance,
                  })
                : p,
            ),
          );
        }
        setWorkflowPanelOpen(false);
        closeConfirmDialog();
        setRetryPollBoostUntil(Date.now() + 15_000);
        if (userId !== null) {
          await fetchProjects(userId, username);
        }
        setEditorFlashMessage('已回退该步骤，可按新流程继续。');
      } catch (e) {
        setEditorFlashMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setReopeningWorkflowStepId((cur) => (cur === stepId ? null : cur));
      }
    },
    [
      closeConfirmDialog,
      currentProjectId,
      fetchProjects,
      userId,
      username,
    ],
  );

  const handleConfirmPipelineReopen = useCallback(async () => {
    if (confirmDialog.kind !== 'reopen' || !confirmDialog.stepId) return;
    await handleReopenSuccessStep(confirmDialog.stepId);
  }, [confirmDialog.kind, confirmDialog.stepId, handleReopenSuccessStep]);

  const handleCreateProject = async (newProject: CreateProjectInput) => {
    /** 先落库 queued，后台跑结构化 → 配音 → 演示页；仅素材进 STRUCTURE_SYSTEM */
    const rawText = (newProject.prompt || '').trim();
    const trimmedName = (newProject.name || '').trim();
    if (!rawText || !trimmedName || userId === null) return;
    setCreateError(null);
    try {
      const rawPreset = (newProject.style || 'aurora_glass').trim() || 'aurora_glass';
      const preset = rawPreset === 'none' ? 'aurora_glass' : rawPreset;
      const body: Record<string, unknown> = {
        name: trimmedName,
        raw_text: rawText,
        deck_page_size: newProject.screenSize,
        deck_style_preset: preset,
        pipeline_auto_advance: newProject.pipelineAutoAdvance !== false,
      };
      if (
        typeof newProject.copyDeckMasterFromProjectId === 'number' &&
        newProject.copyDeckMasterFromProjectId > 0
      ) {
        body.copy_deck_master_from_project_id =
          newProject.copyDeckMasterFromProjectId;
      }
      const styleHint = (newProject.userStyleHint || '').trim();
      if (styleHint && newProject.copyDeckMasterFromProjectId == null) {
        body.deck_style_user_hint = styleHint;
      }
      const tns = newProject.targetNarrationSeconds;
      if (typeof tns === 'number' && Number.isFinite(tns) && tns >= 10 && tns <= 1800) {
        body.target_narration_seconds = Math.round(tns);
      }
      // 片头/片尾暂不使用；恢复时与后端 ProjectCreate 字段一并打开
      // if (newProject.includeIntro) body.include_intro = true;
      // if (newProject.includeOutro) body.include_outro = true;
      const ttsVt = (newProject.ttsVoiceType || '').trim();
      if (ttsVt) body.tts_voice_type = ttsVt;
      const res = await apiFetch<{ project_id: number }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const pid = res.project_id;
      await fetchProjects(userId, username);
      setCurrentProjectId(String(pid));
      setCurrentView('editor');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCreateError(msg);
      throw e;
    }
  };

  const handleRenameProject = useCallback(
    async (id: string, name: string) => {
      const projectId = Number(id);
      const trimmed = name.trim();
      if (!Number.isFinite(projectId) || !trimmed) return;
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      await fetchProjects(userId, username);
    },
    [fetchProjects, userId, username],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      const projectId = Number(id);
      if (!Number.isFinite(projectId)) return;
      await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        setCurrentView('home');
      }
      await fetchProjects(userId, username);
    },
    [fetchProjects, userId, username, currentProjectId],
  );

  const handleCopyProject = useCallback(
    async (id: string) => {
      if (userId === null) return;
      const projectId = Number(id);
      if (!Number.isFinite(projectId)) return;
      const meta = projects.find((p) => p.id === id);
      const copiedName = `${(meta?.name || '').trim() || '未命名项目'}复制版`;
      await apiFetch<{ project_id: number }>(`/api/projects/${projectId}/clone`, {
        method: 'POST',
        body: JSON.stringify({ name: copiedName }),
      });
      await fetchProjects(userId, username);
    },
    [fetchProjects, projects, userId, username],
  );

  const handleUploadProject = useCallback(
    async (id: string) => {
      const projectId = Number(id);
      if (!Number.isFinite(projectId)) return;
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_shared: true }),
      });
      await fetchProjects(userId, username);
    },
    [fetchProjects, userId, username],
  );

  const handleDownloadProject = useCallback(
    async (id: string) => {
      const pid = Number(id);
      if (!Number.isFinite(pid)) {
        throw new Error('无效项目 id，无法下载。');
      }
      const project = projects.find((p) => p.id === id);
      const res = await apiFetch<{
        output_url: string;
        action: 'export' | 'download' | 'queued';
        export_job_id?: number | null;
        pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
      }>(`/api/projects/${pid}/export-video`, {
        method: 'POST',
        body: postExportVideoBody(),
      });
      applyExportVideoResponse(pid, res);
      if (res.action === 'queued') {
        if (res.export_job_id != null) {
          setExportTracking({ projectId: pid, jobId: res.export_job_id });
        }
        setExportStatusOpen(true);
        return;
      }
      setExportTracking(null);
      const finalUrl = apiUrl(res.output_url);
      if (typeof window !== 'undefined' && res.output_url) {
        await startBrowserDownload(finalUrl, project?.name);
      }
    },
    [applyExportVideoResponse, postExportVideoBody, projects, startBrowserDownload],
  );

  /** 有导出任务跟进时，定时拉取该项目详情，保证列表/任务状态与 worker 队列同步（不仅依赖编辑器内轮询） */
  useEffect(() => {
    if (!exportTracking) return;
    const pid = exportTracking.projectId;
    const refresh = () => {
      void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`)
        .then((data) => {
          setProjects((prev) =>
            prev.map((p) => (p.id === String(pid) ? mergeProjectFromDetailApi(p, data) : p)),
          );
        })
        .catch(() => {});
    };
    refresh();
    const t = window.setInterval(refresh, 2500);
    return () => window.clearInterval(t);
  }, [exportTracking]);

  const exportTrackedJob = useMemo(() => {
    if (!exportTracking) return null;
    const p = projects.find((x) => x.id === String(exportTracking.projectId));
    const j = p?.videoExportJob;
    if (!j || j.job_id !== exportTracking.jobId) return null;
    return { job: j, projectId: exportTracking.projectId };
  }, [projects, exportTracking]);

  useEffect(() => {
    if (!exportTrackedJob) return;
    const { job, projectId: pid } = exportTrackedJob;

    if (job.status === 'succeeded') {
      setExportTracking(null);
      setExportSubmitting(false);
      setExportStatusOpen(false);
      void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`).then((data) => {
        setProjects((prev) =>
          prev.map((p) => (p.id === String(pid) ? mergeProjectFromDetailApi(p, data) : p)),
        );
        const rawUrl = job.output_url?.trim();
        if (rawUrl) {
          setEditorFlashDownloadUrl(apiUrl(rawUrl));
        }
        setEditorFlashMessage(
          '导出已完成：worker 已回传成片。可点击顶栏下载或使用下方链接。',
        );
      });
    } else if (job.status === 'failed') {
      setExportTracking(null);
      setExportSubmitting(false);
      setExportFailed(true);
      setEditorFlashMessage(job.error_message || '视频导出失败');
      void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`).then((data) => {
        setProjects((prev) =>
          prev.map((p) => (p.id === String(pid) ? mergeProjectFromDetailApi(p, data) : p)),
        );
      });
    }
  }, [exportTrackedJob]);

  const exportJobForTracking = useMemo(() => {
    if (!exportTracking || !currentProjectId) return null;
    if (String(exportTracking.projectId) !== currentProjectId) return null;
    const j = currentProject?.videoExportJob;
    if (!j || j.job_id !== exportTracking.jobId) return null;
    return j;
  }, [currentProject?.videoExportJob, currentProjectId, exportTracking]);

  const pl = currentProject?.pipeline;
  const serverPipelineSatisfied = Boolean(pl?.outline && pl?.audio && pl?.deck);
  const editorUiBlocked =
    !editorTimelineUnlocked || (timelineBlocking && clips.length === 0);

  const editorDisplaySteps = useMemo(() => {
    let base = displayWorkflowSteps;
    if (
      exportJobForTracking &&
      (exportJobForTracking.status === 'queued' ||
        exportJobForTracking.status === 'running')
    ) {
      base = base.map((s) =>
        s.id === 'export' ? { ...s, state: 'running' as const } : s,
      );
    }
    return base;
  }, [displayWorkflowSteps, exportJobForTracking]);

  const preExportAllSuccess = useMemo(() => {
    const s = editorDisplaySteps;
    const preExport = s.filter((x) => x.id !== 'export');
    return preExport.length >= 3 && preExport.every((x) => x.state === 'success');
  }, [editorDisplaySteps]);

  const headerExportStepState = useMemo(
    () => editorDisplaySteps.find((s) => s.id === 'export')?.state,
    [editorDisplaySteps],
  );

  /** 与 TopBar `videoReady` 一致：用于导出按钮禁用逻辑与状态弹窗 */
  const serverExportVideoReady = Boolean(pl?.video);

  const headerVideoActionLoading =
    serverPipelineSatisfied &&
    (exportSubmitting ||
      headerExportStepState === 'running' ||
      (exportJobForTracking != null &&
        (exportJobForTracking.status === 'queued' ||
          exportJobForTracking.status === 'running')));

  /** 导出中（无成片）也允许点击打开状态面板；仅有成片时的短请求仍禁用防重复点 */
  const headerVideoMainButtonEnabled =
    preExportAllSuccess &&
    (!headerVideoActionLoading || !serverExportVideoReady);

  const editorFlashTone: 'success' | 'error' | null = editorFlashMessage
    ? /失败|未成功|错误/i.test(editorFlashMessage)
      ? 'error'
      : 'success'
    : null;

  if (!sessionReady) {
    return (
      <div className="sf-bg-base flex h-screen w-full items-center justify-center font-sans sf-text-muted">
        正在恢复会话…
      </div>
    );
  }

  if (currentView === 'home') {
    return (
      <div className="sf-bg-base sf-text-primary flex h-screen w-full flex-col overflow-hidden font-sans selection:bg-purple-500/30">
        <TopBar
          username={userId !== null ? username : null}
          onLogin={() => void bootstrap()}
          onLogout={() => void handleLogout()}
        />
        {projectsError ? (
          <div
            role="alert"
            className="pointer-events-auto fixed left-1/2 top-16 z-[100] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-2 text-sm text-red-200 shadow-xl backdrop-blur-md light:border-red-400/50 light:bg-red-50 light:text-red-800"
          >
            {projectsError}
          </div>
        ) : null}
        <Home
          projects={projects}
          currentUserId={userId}
          createError={createError}
          onCreateProject={handleCreateProject}
          onSelectProject={(id) => {
            setCurrentProjectId(id);
            setCurrentView('editor');
          }}
          onToggleShare={(id, isShared) => {
            const projectId = Number(id);
            if (!Number.isFinite(projectId)) return;
            void (async () => {
              await apiFetch(`/api/projects/${projectId}`, {
                method: 'PATCH',
                body: JSON.stringify({ is_shared: isShared }),
              });
              if (userId !== null) {
                await fetchProjects(userId, username);
              }
            })();
          }}
          onRenameProject={(id, name) => void handleRenameProject(id, name)}
          onDeleteProject={(id) => void handleDeleteProject(id)}
          onCopyProject={(id) => void handleCopyProject(id)}
          onUploadProject={(id) => void handleUploadProject(id)}
          onDownloadProject={(id) => void handleDownloadProject(id)}
        />
      </div>
    );
  }

  return (
    <div className="sf-bg-base sf-text-primary flex h-screen w-full flex-col overflow-hidden font-sans selection:bg-purple-500/30">
      <TopBar
        username={userId !== null ? username : null}
        onLogin={() => void bootstrap()}
        onLogout={() => void handleLogout()}
        projectName={currentProject?.name}
        onBackToHome={() => {
          suppressNextUrlProjectHydrateRef.current = true;
          setCurrentView('home');
          setCurrentProjectId(null);
        }}
        steps={editorDisplaySteps}
        downloadEnabled={headerVideoMainButtonEnabled}
        videoReady={workflowModel.videoReady}
        downloadLoading={headerVideoActionLoading}
        onDownloadClick={() => {
          if (headerVideoActionLoading && !serverExportVideoReady) {
            setExportStatusOpen(true);
            return;
          }
          setExportChoiceOpen(true);
        }}
        onRetryWorkflowStep={(id) => void handleRetryWorkflowStep(id)}
        retryingWorkflowStepId={retryingWorkflowStepId}
        onCancelRunningWorkflowStep={(id) =>
          void handleCancelRunningWorkflowStep(id)
        }
        cancellingRunningWorkflowStepId={cancellingRunningWorkflowStepId}
        onRequestReopenSuccessStep={(id) => openConfirmDialog('reopen', id)}
        reopeningWorkflowStepId={reopeningWorkflowStepId}
        pipelineAutoAdvance={currentProject?.pipelineAutoAdvance !== false}
        manualOutlineConfirmed={currentProject?.manualOutlineConfirmed !== false}
        onOpenProjectDetails={() => setProjectDetailsOpen(true)}
      />

      <ExportVideoChoiceDialog
        open={exportChoiceOpen}
        serverHasVideo={serverExportVideoReady}
        busy={exportSubmitting}
        onClose={() => setExportChoiceOpen(false)}
        onDownloadOnly={() => void handleExportChoiceDownloadOnly()}
        onForceReexport={() => void handleExportChoiceForceReexport()}
      />
      <ExportVideoStatusDialog
        open={exportStatusOpen}
        onClose={() => setExportStatusOpen(false)}
        job={
          exportTrackedJob?.job ??
          exportJobForTracking ??
          currentProject?.videoExportJob ??
          null
        }
        workflowExporting={headerExportStepState === 'running' && !serverExportVideoReady}
      />
      <CancelRunningPipelineStepDialog
        open={confirmDialog.kind === 'cancel'}
        busy={cancellingRunningWorkflowStepId !== null}
        stepId={confirmDialog.stepId}
        onClose={() => {
          if (cancellingRunningWorkflowStepId) return;
          closeConfirmDialog();
        }}
        onConfirm={() => void handleConfirmPipelineCancel()}
      />
      <ReopenSuccessPipelineStepDialog
        open={confirmDialog.kind === 'reopen'}
        busy={reopeningWorkflowStepId !== null}
        stepId={confirmDialog.stepId}
        onClose={() => {
          if (reopeningWorkflowStepId) return;
          closeConfirmDialog();
        }}
        onConfirm={() => void handleConfirmPipelineReopen()}
      />
      {workflowPanelOpen ? (
        <WorkflowPanel
          steps={editorDisplaySteps}
          revertGuardSteps={currentProject?.workflowSteps ?? null}
          pipelineAutoAdvance={currentProject?.pipelineAutoAdvance !== false}
          manualOutlineConfirmed={currentProject?.manualOutlineConfirmed !== false}
          deckMasterSourceProjectId={currentProject?.deckMasterSourceProjectId ?? null}
          videoReady={workflowModel.videoReady}
          onRetryStep={(id) => void handleRetryWorkflowStep(id)}
          retryingStepId={retryingWorkflowStepId}
          onCancelRunningStep={(id) => void handleCancelRunningWorkflowStep(id)}
          cancellingStepId={cancellingRunningWorkflowStepId}
          onCommitReopenSuccessStep={(id) => {
            void handleReopenSuccessStep(id);
          }}
          reopeningStepId={reopeningWorkflowStepId}
          onClose={() => setWorkflowPanelOpen(false)}
        />
      ) : null}
      <ManualTextPrepDialog
        open={activeManualDialog === 'text'}
        projectId={currentProjectId != null ? Number(currentProjectId) : 0}
        initialRaw={(currentProject?.inputPrompt ?? '').trim()}
        initialMode={
          currentProject?.textStructureMode === 'verbatim_split'
            ? 'verbatim_split'
            : 'polish'
        }
        onClose={closeManualDialog}
        onQueued={() => {
          /** 后端写 workflow 有间隔；先乐观标为 running，直到轮询看到真实态 */
          setHeaderTextKickoffPending(true);
          setRetryPollBoostUntil(Date.now() + 20_000);
        }}
        onKickoffFailed={() => setHeaderTextKickoffPending(false)}
        onConfirmHandoff={() => setWorkflowPanelOpen(false)}
      />
      <ManualOutlineConfirmDialog
        open={activeManualDialog === 'outline'}
        projectId={currentProjectId != null ? Number(currentProjectId) : 0}
        initialOutline={currentProject?.outlineNodes ?? null}
        initialTtsVoiceType={currentProject?.ttsVoiceType ?? null}
        onClose={closeManualDialog}
        onAudioWorkflowKickoff={() => {
          setHeaderAudioWorkflowKickoffPending(true);
          setRetryPollBoostUntil(Date.now() + 20_000);
        }}
        onAudioWorkflowKickoffFailed={() => setHeaderAudioWorkflowKickoffPending(false)}
        onConfirmed={() => {
          if (userId !== null) void fetchProjects(userId, username);
        }}
        onAudioChainComplete={() => {
          if (userId !== null) void fetchProjects(userId, username);
        }}
        onNextStepError={(msg) => setEditorFlashMessage(msg)}
        onConfirmHandoff={() => setWorkflowPanelOpen(false)}
      />
      <ManualDeckMasterDialog
        open={activeManualDialog === 'deck_master'}
        projectId={currentProjectId != null ? Number(currentProjectId) : 0}
        initialHint={(currentProject?.deckStyleUserHint ?? '').trim()}
        initialDeckStylePreset={(currentProject?.deckStylePreset ?? 'aurora_glass').trim() || 'aurora_glass'}
        initialDeckMasterSourceProjectId={currentProject?.deckMasterSourceProjectId ?? null}
        onClose={closeManualDialog}
        onKickoffOptimistic={() => {
          setHeaderDeckMasterKickoffPending(true);
          setRetryPollBoostUntil(Date.now() + 20_000);
        }}
        onKickoffFailed={() => setHeaderDeckMasterKickoffPending(false)}
        onDone={() => {
          if (userId !== null) void fetchProjects(userId, username);
        }}
      />
      <ManualDeckPagesDialog
        open={activeManualDialog === 'deck_pages'}
        projectId={currentProjectId != null ? Number(currentProjectId) : 0}
        initialDeckStylePromptText={currentProject?.deckStylePromptText ?? null}
        onClose={closeManualDialog}
        onDone={() => {
          if (userId !== null) void fetchProjects(userId, username);
        }}
        onConfirmHandoff={() => setWorkflowPanelOpen(false)}
        onGenerationStarted={() => {
          setHeaderDeckPagesKickoffPending(true);
          setRetryPollBoostUntil(Date.now() + 20_000);
        }}
        onGenerationKickoffFailed={() => setHeaderDeckPagesKickoffPending(false)}
      />
      <ProjectDetailsModal
        open={projectDetailsOpen}
        onClose={() => setProjectDetailsOpen(false)}
        projectId={
          currentProjectId != null && Number.isFinite(Number(currentProjectId))
            ? Number(currentProjectId)
            : null
        }
      />

      {(editorFlashMessage || timelineError) ? (
        <div
          className="pointer-events-none fixed left-1/2 top-16 z-[100] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col gap-2"
          aria-live="polite"
        >
          {editorFlashMessage ? (
            <div
              role="status"
              className={
                editorFlashTone === 'error'
                  ? 'pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-rose-500/35 bg-rose-950/90 px-3 py-2.5 text-sm text-rose-100 shadow-xl backdrop-blur-md light:border-rose-400/40 light:bg-rose-50 light:text-rose-900'
                  : 'pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-emerald-500/35 bg-emerald-950/90 px-3 py-2.5 text-sm text-emerald-100 shadow-xl backdrop-blur-md light:border-emerald-400/40 light:bg-emerald-50 light:text-emerald-900'
              }
            >
              <span className="min-w-0 flex-1 leading-snug">{editorFlashMessage}</span>
              {editorFlashDownloadUrl ? (
                <a
                  href={editorFlashDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    editorFlashTone === 'error'
                      ? 'shrink-0 rounded-md border border-rose-300/35 px-2 py-1 text-xs text-rose-100 transition-colors hover:bg-rose-900/40 light:border-rose-300/60 light:text-rose-800 light:hover:bg-rose-100'
                      : 'shrink-0 rounded-md border border-emerald-300/35 px-2 py-1 text-xs text-emerald-50 transition-colors hover:bg-emerald-900/45 light:border-emerald-300/60 light:text-emerald-800 light:hover:bg-emerald-100'
                  }
                >
                  下载链接
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setEditorFlashMessage(null);
                  setEditorFlashDownloadUrl(null);
                }}
                className={
                  editorFlashTone === 'error'
                    ? 'shrink-0 rounded-md p-1 text-rose-300/90 transition-colors hover:bg-rose-900/45 hover:text-rose-50 light:text-rose-600 light:hover:bg-rose-100 light:hover:text-rose-900'
                    : 'shrink-0 rounded-md p-1 text-emerald-300/90 transition-colors hover:bg-emerald-900/50 hover:text-emerald-100 light:text-emerald-600 light:hover:bg-emerald-100 light:hover:text-emerald-900'
                }
                aria-label="关闭提示"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {timelineError ? (
            <div
              role="alert"
              className="pointer-events-auto rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md light:border-amber-400/50 light:bg-amber-50 light:text-amber-950"
            >
              时间轴加载失败：{timelineError}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ai-panel-host relative flex min-h-0 flex-1 overflow-hidden">
        {!leftDetailCollapsed ? (
          <>
            <DetailPanel
              width={sidebarWidth}
              clip={detailPanelClip}
              surface={detailPanelSurface}
              onSeek={handleSeek}
              isGenerating={editorUiBlocked}
              currentTime={currentTime}
              totalDurationMs={timelineTotalMs}
              projectId={
                currentProjectId != null && Number.isFinite(Number(currentProjectId))
                  ? Number(currentProjectId)
                  : null
              }
              onAudioResynthSuccess={onAudioResynthSuccess}
              onDeckPageRegenSubmitted={onDeckPageRegenSubmitted}
              deckRegenerating={deckRegenWatchActive}
              deckRegeneratingPageNodeId={deckRegenWatchPageNodeId}
              onNotify={(message) => {
                setEditorFlashDownloadUrl(null);
                setEditorFlashMessage(message);
              }}
              playback={{
                steps: playSteps,
                currentStepIndex: currentStep,
                globalMs,
                totalMs: timelineTotalMs,
                isPlaying,
              }}
            />

            <div
              className="w-1.5 cursor-col-resize shrink-0 z-20 bg-[var(--sf-splitter-track)] transition-colors hover:bg-purple-500"
              onMouseDown={handleSidebarMouseDown}
            />
          </>
        ) : null}

        <MainWorkspace
          steps={editorDisplaySteps}
          timelineUnlocked={editorTimelineUnlocked}
          currentTime={currentTime}
          clips={clips}
          pages={workspacePagesWithDraft}
          timelineLoading={timelineBlocking}
          screenSize={
            (previewDeckPageSize || currentProject?.screenSize || '16:9').trim() ||
            '16:9'
          }
          playSteps={playSteps}
          globalMs={globalMs}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          totalDurationMs={timelineTotalMs}
          showSubtitles={previewSubtitlesVisible}
        />
        <EditorRightSidebar
          isOpen={editorRightSidebarOpen}
          onClose={() => setEditorRightSidebarOpen(false)}
          activeModule={editorRightSidebarModule}
          defaultOpenWidthRatio={0.4}
          maxWidthRatio={0.6}
          leftSafeOffsetPx={leftDetailCollapsed ? 12 : sidebarWidth + 6}
          deck={{
            clip: aiPanelClip,
            contextHtmlText: aiContextHtmlText,
            draftHtmlText: aiDraft?.draftHtml || null,
            isGenerating: aiGenerating,
            errorText: aiError,
            onGenerate: handleGenerateAiDraft,
            onApplyChanges: () => void handleApplyAiDraft(),
            onDiscardDraft: handleDiscardAiDraft,
            onDraftChange: handleEditAiDraft,
          }}
          narration={{
            clip: narrationPanelClip,
            baselineText: narrationBaselineForPanel,
            draftText: narrationDraftTextForPanel,
            isResynthesizing: narrationResynthBusy,
            isApplying: narrationApplyBusy,
            errorText: narrationPanelError,
            onDraftChange: handleNarrationDraftChange,
            onResynthesize: () => void handleResynthesizeNarrationDraft(),
            onApply: () => void handleApplyNarrationDraft(),
            onDiscard: handleDiscardNarrationDraft,
          }}
        />
      </div>

      <div
        className="relative z-20 h-1.5 shrink-0 cursor-row-resize bg-[var(--sf-splitter-track)] transition-colors hover:bg-purple-500"
        onMouseDown={handleTimelineMouseDown}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-0.5 w-8 rounded-full bg-[var(--sf-splitter-handle)]" />
        </div>
      </div>

      <Timeline
        height={timelineHeight}
        clips={clips}
        selectedClipId={selectedClipId}
        onSelectClip={handleSelectClip}
        isPlaying={isPlaying}
        currentTime={currentTime}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        isGenerating={editorUiBlocked}
        onClipChange={handleClipChange}
        onVideoClipDoubleClick={handleOpenAiPanelForVideoClip}
        onAudioClipDoubleClick={handleOpenNarrationPanelForAudioClip}
        totalDurationMs={timelineTotalMs}
        subtitlesVisible={previewSubtitlesVisible}
        onSubtitlesVisibleChange={setPreviewSubtitlesVisible}
        leftDetailCollapsed={leftDetailCollapsed}
        onLeftDetailCollapsedChange={setLeftDetailCollapsed}
        onOpenWorkflowPanel={() => setWorkflowPanelOpen(true)}
      />

      <audio
        ref={audioRef}
        className="hidden"
        preload="auto"
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
      />
    </div>
  );
}
