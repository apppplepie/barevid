import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { ExportVideoChoiceDialog } from './components/ExportVideoChoiceDialog';
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
import { TopBar } from './components/TopBar';
import { ProjectDetailsModal } from './components/ProjectDetailsModal';
import { DetailPanel } from './components/DetailPanel';
import { MainWorkspace } from './components/MainWorkspace';
import { Timeline } from './components/Timeline';
import { EditorRightSidebar } from './components/EditorRightSidebar';
import { Home, Project, type CreateProjectInput } from './components/Home';
import { ClipData, PageData } from './types';
import {
  deriveWorkflowSteps,
  type ServerWorkflow,
} from './utils/workflowFromPipeline';
import { ApiError, apiFetch, apiUrl, getAuthBearerToken, getStoredAuthToken, setStoredAuthToken } from './api';
import {
  buildTimelineFromPlayManifest,
  type PlayManifest,
  type PlayStep,
} from './data/playManifest';
import { useEditorWorkflowModel } from './hooks/useEditorWorkflowModel';
import { useProjectWorkflowState } from './hooks/useProjectWorkflowState';
import { useStepPlayer } from './hooks/useStepPlayer';
import { findClipAtTime } from './utils/timelineHit';

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
  include_intro?: boolean;
  include_outro?: boolean;
  narration_target_seconds?: number | null;
  video_exported_at?: string | null;
  pipeline?: { outline?: boolean; audio?: boolean; deck?: boolean; video?: boolean };
  workflow?: ServerWorkflow | null;
  pipeline_auto_advance?: boolean;
  text_structure_mode?: string | null;
  manual_outline_confirmed?: boolean;
  input_prompt?: string | null;
};

type ProjectDetailApi = {
  pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
  workflow?: ServerWorkflow | null;
  project: {
    id: number;
    name: string;
    status: string;
    deck_status?: string | null;
    deck_page_size?: string | null;
    deck_style_preset?: string | null;
    deck_master_source_project_id?: number | null;
    narration_target_seconds?: number | null;
    pipeline_auto_advance?: boolean;
    text_structure_mode?: string | null;
    manual_outline_confirmed?: boolean;
    input_prompt?: string | null;
    deck_style_user_hint?: string | null;
    deck_style_prompt_text?: string | null;
    tts_voice_type?: string | null;
    tts_voice_effective?: string | null;
  };
};

type AuthMe = { id: number; username: string };

/** 与 backend `DECK_STYLE_PRESETS` 对应的列表展示名（`Project.style` 在列表中为中文名） */
const DECK_STYLE_DISPLAY: Record<string, string> = {
  none: '未选预设',
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
const LS_THEME = 'neoncast_theme_mode';
const LS_AI_DRAFT_MAP = 'neoncast_ai_draft_map_v1';
const LS_NARRATION_DRAFT_MAP = 'neoncast_narration_draft_map_v1';
/** 配音/单页演示重生成后需重新导出：刷新后仍从 sessionStorage 恢复顶栏导出为待处理 */
const LS_EXPORT_STALE_PREFIX = 'neoncast_export_stale_';
/** 单页演示重生成提交后按项目保留 pending，避免切回主页后丢失提交态 */
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
  const initialRoute = readInitialRoute();
  const [username, setUsername] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  /** 避免本地有 token 时首帧仍用未恢复的 userId 打开编辑器 */
  const [sessionReady, setSessionReady] = useState(false);
  const [currentView, setCurrentView] = useState<'home' | 'editor'>(() =>
    initialRoute.view === 'editor' && !initialRoute.projectId ? 'home' : initialRoute.view,
  );
  const [projects, setProjects] = useState<Project[]>([]);
  const { patchProjectWorkflowLocally } = useProjectWorkflowState(setProjects);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() =>
    initialRoute.view === 'editor' && !initialRoute.projectId ? null : initialRoute.projectId,
  );
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      return localStorage.getItem(LS_THEME) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const currentProject = projects.find((p) => p.id === currentProjectId);

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
  const [headerDeckRegenPending, setHeaderDeckRegenPending] = useState(false);
  const [headerDeckRegenPendingPageNodeId, setHeaderDeckRegenPendingPageNodeId] = useState<
    number | null
  >(null);
  const [headerAudioRegenPending, setHeaderAudioRegenPending] = useState(false);
  /** 内容重生成后成片已过时：顶栏导出步显示待处理，直至再次导出成功 */
  const [headerExportStaleAfterRegen, setHeaderExportStaleAfterRegen] = useState(false);
  /** 重试后短时强制轮询，覆盖后端状态回写延迟 */
  const [retryPollBoostUntil, setRetryPollBoostUntil] = useState<number | null>(null);
  /** URL project 参数仅在登录恢复后消费一次，避免“回主页又跳回工程” */
  const urlProjectHydratedRef = useRef(false);
  /** 手动返回主页后，屏蔽一次基于 URL 的自动回跳 */
  const suppressNextUrlProjectHydrateRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  /** 时间轴「隐藏左侧详情栏」：收起后中间工作区变宽 */
  const [leftDetailCollapsed, setLeftDetailCollapsed] = useState(false);
  /** 时间轴区域默认更高一些，分隔条相对更靠上 */
  const [timelineHeight, setTimelineHeight] = useState(200);
  /** 手动确认弹窗将步骤交给后台时递增，用于收起时间轴上的工作流面板 */
  const [workflowPanelDismissSignal, setWorkflowPanelDismissSignal] = useState(0);
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
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', themeMode);
    try {
      localStorage.setItem(LS_THEME, themeMode);
    } catch {
      /* ignore */
    }
  }, [themeMode]);

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

  useEffect(() => {
    if (currentView === 'home') setProjectDetailsOpen(false);
  }, [currentView]);

  const [createError, setCreateError] = useState<string | null>(null);
  const [exportSubmitting, setExportSubmitting] = useState(false);
  const [exportChoiceOpen, setExportChoiceOpen] = useState(false);
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [editorFlashMessage, setEditorFlashMessage] = useState<string | null>(null);
  const [editorFlashDownloadUrl, setEditorFlashDownloadUrl] = useState<string | null>(null);
  const [previewSubtitlesVisible, setPreviewSubtitlesVisible] = useState(false);
  const [retryingWorkflowStepId, setRetryingWorkflowStepId] = useState<
    string | null
  >(null);
  const [cancellingRunningWorkflowStepId, setCancellingRunningWorkflowStepId] =
    useState<string | null>(null);
  const [reopeningWorkflowStepId, setReopeningWorkflowStepId] = useState<
    string | null
  >(null);
  const [editorDataVersion, setEditorDataVersion] = useState(0);
  const [headerTextStructureKickoffPending, setHeaderTextStructureKickoffPending] =
    useState(false);
  const prevDetailSyncedTextStatusRef = useRef<string | null>(null);
  const {
    activeManualDialog,
    closeConfirmDialog,
    closeManualDialog,
    confirmDialog,
    displaySteps,
    openConfirmDialog,
    openManualDialogForStep,
    timelineUnlocked: editorTimelineUnlocked,
    videoActionEnabled,
    videoActionLoading,
    videoReady: editorVideoReady,
  } = useEditorWorkflowModel({
    currentView,
    currentProject,
    headerTextStructureKickoffPending,
    headerAudioRegenPending,
    headerDeckRegenPending,
    headerExportStaleAfterRegen,
    exportFailed,
    exportSubmitting,
  });

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

  const detailPanelNarrationDraftText = useMemo(() => {
    if (detailPanelSurface !== 'audio') return null;
    const pid = Number(currentProjectId);
    const sid = parseStepNodeIdFromClipId(detailPanelClip.id);
    if (!Number.isFinite(pid) || sid == null) return null;
    const k = `${pid}:${sid}`;
    const row = narrationDraftMap[k];
    return row ? row.draftText : null;
  }, [
    detailPanelSurface,
    detailPanelClip.id,
    currentProjectId,
    narrationDraftMap,
  ]);

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
    setHeaderDeckRegenPending(false);
    setHeaderDeckRegenPendingPageNodeId(null);
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
      setHeaderDeckRegenPending(true);
      setHeaderDeckRegenPendingPageNodeId(pageNodeId);
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
              setHeaderDeckRegenPending(false);
              setHeaderDeckRegenPendingPageNodeId(null);
              persistDeckRegenPending(pid, null);
              if (st === 'ready') {
                try {
                  sessionStorage.setItem(`${LS_EXPORT_STALE_PREFIX}${String(pid)}`, '1');
                } catch {
                  /* ignore */
                }
              }
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
    if (currentProjectId) {
      try {
        sessionStorage.setItem(`${LS_EXPORT_STALE_PREFIX}${currentProjectId}`, '1');
      } catch {
        /* ignore */
      }
    }
    reloadEditorWithMessage('音频已更新。');
  }, [currentProjectId, reloadEditorWithMessage]);

  const onAudioResynthStart = useCallback(() => {
    setHeaderAudioRegenPending(true);
  }, []);

  const onAudioResynthEnd = useCallback(() => {
    setHeaderAudioRegenPending(false);
  }, []);

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
        const preset = (item.deck_style_preset || 'none').trim() || 'none';
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
        return {
          id: String(item.id),
          name: item.name,
          screenSize,
          style,
          deckStylePreset: preset,
          lastModified: formatDateTimeToMinute(updatedAt),
          serverStatus: item.status,
          deckStatus,
          pipeline,
          serverWorkflow: wf,
          workflowSteps: deriveWorkflowSteps(
            pipeline,
            item.status,
            deckStatus,
            wf,
            { pipelineAutoAdvance: item.pipeline_auto_advance !== false },
          ),
          author,
          isShared: item.is_shared,
          ownerUserId: item.owner_user_id,
          deckMasterSourceProjectId: parseDeckMasterSourceProjectId(
            item.deck_master_source_project_id,
          ),
          includeIntro: Boolean(item.include_intro),
          includeOutro: Boolean(item.include_outro),
          narrationTargetSeconds: item.narration_target_seconds ?? undefined,
          pipelineAutoAdvance: item.pipeline_auto_advance !== false,
          textStructureMode:
            item.text_structure_mode === 'verbatim_split'
              ? 'verbatim_split'
              : 'polish',
          manualOutlineConfirmed: item.manual_outline_confirmed ?? true,
          inputPrompt: item.input_prompt ?? null,
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

  /**
   * 轮询项目详情（workflow / pipeline）：未跑完或某步进行中、或口播/演示重生成中时需要。
   * play-manifest 仅在「文本+配音已就绪、可进时间轴」后加载与轮询，避免配音阶段反复拉画面数据。
   */
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
  const shouldPollEditorData =
    Boolean(pollEditorProject) &&
    (!pollPipelineSatisfied ||
      pollWorkflowRunning ||
      headerAudioRegenPending ||
      headerDeckRegenPending ||
      (retryPollBoostUntil != null && retryPollBoostUntil > Date.now()));

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
    setHeaderAudioRegenPending(false);
    setExportSubmitting(false);
    setExportChoiceOpen(false);
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
    if (headerDeckRegenPending) return;
    startDeckRegenWatch(pid, pageNodeId);
  }, [currentView, currentProjectId, headerDeckRegenPending, startDeckRegenWatch]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) {
      setHeaderExportStaleAfterRegen(false);
      return;
    }
    try {
      setHeaderExportStaleAfterRegen(
        sessionStorage.getItem(`${LS_EXPORT_STALE_PREFIX}${currentProjectId}`) === '1',
      );
    } catch {
      setHeaderExportStaleAfterRegen(false);
    }
  }, [currentView, currentProjectId]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;

    let cancelled = false;
    const pidKey = String(pid);
    if (manifestPidHydratedRef.current !== pidKey) {
      manifestPidHydratedRef.current = pidKey;
      setTimelineBlocking(true);
      setTimelineError(null);
    }

    const loadManifest = () => {
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
            if (
              persistedPid === String(pid)
            ) {
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
    };

    if (!editorTimelineUnlocked) {
      return () => {
        cancelled = true;
      };
    }

    loadManifest();

    if (!shouldPollEditorData) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(loadManifest, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    currentView,
    currentProjectId,
    shouldPollEditorData,
    editorDataVersion,
    editorTimelineUnlocked,
  ]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) {
      manifestPidHydratedRef.current = null;
    }
  }, [currentView, currentProjectId]);

  useEffect(() => {
    setHeaderTextStructureKickoffPending(false);
    prevDetailSyncedTextStatusRef.current = null;
  }, [currentProjectId]);

  useEffect(() => {
    if (currentView !== 'editor' || !currentProjectId) return;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;

    const sync = () => {
      void apiFetch<ProjectDetailApi>(`/api/projects/${pid}`)
        .then((data) => {
          const pl = {
            outline: Boolean(data.pipeline?.outline),
            audio: Boolean(data.pipeline?.audio),
            deck: Boolean(data.pipeline?.deck),
            video: Boolean(data.pipeline?.video),
          };
          const ds = data.project.deck_status || 'idle';
          const wf = data.workflow ?? null;
          const ts = (wf?.textStatus ?? 'not_started').toString().trim().toLowerCase();
          const st = (data.project.status ?? 'draft').toString().trim().toLowerCase();
          const prevTs = prevDetailSyncedTextStatusRef.current;
          setHeaderTextStructureKickoffPending((cur) => {
            if (!cur) return cur;
            const clearKickoff =
              ts === 'running' ||
              ts === 'failed' ||
              st === 'structuring' ||
              st === 'queued' ||
              (prevTs === 'running' && ts === 'success');
            return clearKickoff ? false : cur;
          });
          patchProjectWorkflowLocally(pid, (p) => ({
            name: data.project.name,
            serverStatus: data.project.status,
            deckStatus: ds,
            pipeline: pl,
            serverWorkflow: wf,
            screenSize: (data.project.deck_page_size || p.screenSize || '16:9').trim() || '16:9',
            style:
              DECK_STYLE_DISPLAY[
                (data.project.deck_style_preset || 'none').trim() || 'none'
              ] ||
              p.style ||
              '未选预设',
            ttsVoiceType: data.project.tts_voice_type ?? null,
            ttsVoiceEffective:
              (data.project.tts_voice_effective || '').trim() || undefined,
            pipelineAutoAdvance:
              data.project.pipeline_auto_advance !== false,
            textStructureMode:
              data.project.text_structure_mode === 'verbatim_split'
                ? 'verbatim_split'
                : 'polish',
            manualOutlineConfirmed:
              data.project.manual_outline_confirmed ?? true,
            inputPrompt: data.project.input_prompt ?? null,
            deckStyleUserHint: data.project.deck_style_user_hint ?? null,
            deckStylePreset:
              (data.project.deck_style_preset || 'none').trim() || 'none',
            deckStylePromptText: data.project.deck_style_prompt_text ?? null,
            deckMasterSourceProjectId: parseDeckMasterSourceProjectId(
              data.project.deck_master_source_project_id,
            ),
          }));
          prevDetailSyncedTextStatusRef.current = ts;
        })
        .catch(() => {});
    };

    sync();

    if (!shouldPollEditorData) {
      return () => {};
    }

    const t = window.setInterval(sync, 4000);
    return () => window.clearInterval(t);
  }, [currentView, currentProjectId, shouldPollEditorData, editorDataVersion]);

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
        pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
      },
    ) => {
      const nextPl = {
        outline: Boolean(res.pipeline.outline),
        audio: Boolean(res.pipeline.audio),
        deck: Boolean(res.pipeline.deck),
        video: Boolean(res.pipeline.video),
      };
      if (nextPl.video) {
        try {
          sessionStorage.removeItem(`${LS_EXPORT_STALE_PREFIX}${String(pid)}`);
        } catch {
          /* ignore */
        }
        setHeaderExportStaleAfterRegen(false);
      }
      patchProjectWorkflowLocally(pid, (p) => {
        const sw =
          nextPl.video && p.serverWorkflow
            ? { ...p.serverWorkflow, exportStatus: 'success' as const }
            : p.serverWorkflow ?? null;
        return {
          pipeline: nextPl,
          serverWorkflow: sw,
        };
      });
    },
    [patchProjectWorkflowLocally],
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
        setEditorFlashMessage('视频正在导出中，请稍候。');
        return;
      }
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      const forceReexport = Boolean(opts?.forceReexport);
      setExportSubmitting(true);
      try {
        const res = await apiFetch<{
          output_url: string;
          action: 'export' | 'download';
          pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
        }>(`/api/projects/${pid}/export-video`, {
          method: 'POST',
          body: postExportVideoBody(forceReexport ? { forceReexport: true } : undefined),
        });
        applyExportVideoResponse(pid, res);
        if (!res.pipeline.video) {
          setEditorFlashDownloadUrl(null);
          setEditorFlashMessage('导出尚未完成，请稍后再试。');
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
        setEditorFlashDownloadUrl(null);
        setEditorFlashMessage(e instanceof Error ? e.message : String(e));
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
      if (!currentProjectId) return;
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      const textState = currentProject?.workflowSteps?.find((s) => s.id === 'text')
        ?.state;
      if (
        textState !== 'success' &&
        (stepId === 'audio' ||
          stepId === 'pages' ||
          stepId === 'deck_render')
      ) {
        setEditorFlashMessage('请先完成文本结构化。');
        openManualDialogForStep('text');
        return;
      }
      /** 工作流面板内「开始」统一先关面板，再打开 ManualWorkflowDialogs 内对应确认表单 */
      openManualDialogForStep(stepId);
    },
    [
      currentProject?.workflowSteps,
      currentProjectId,
      openManualDialogForStep,
    ],
  );

  const handleCancelRunningWorkflowStep = useCallback(
    (stepId: string) => {
      if (!currentProjectId) return;
      openConfirmDialog('cancel', stepId);
    },
    [currentProjectId, openConfirmDialog],
  );

  const handleTopBarReopenSuccessStep = useCallback(
    (stepId: string) => {
      if (!currentProjectId) return;
      openConfirmDialog('reopen', stepId);
    },
    [currentProjectId, openConfirmDialog],
  );

  const handleConfirmCancelRunningWorkflowStep = useCallback(async () => {
    if (confirmDialog.kind !== 'cancel' || !confirmDialog.stepId || !currentProjectId) return;
    const stepId = confirmDialog.stepId;
    const pid = Number(currentProjectId);
    if (!Number.isFinite(pid)) return;
    closeConfirmDialog();
    setCancellingRunningWorkflowStepId(stepId);
    setEditorFlashDownloadUrl(null);
    try {
      patchProjectWorkflowLocally(pid, (project) => {
        const pipeline = {
          outline: Boolean(project.pipeline?.outline),
          audio: Boolean(project.pipeline?.audio),
          deck: Boolean(project.pipeline?.deck),
          video: false,
        };
        const serverWorkflow = { ...(project.serverWorkflow ?? {}) };
        if (stepId === 'text') {
          return {
            pipeline: { ...pipeline, outline: false, audio: false, deck: false },
            serverStatus: 'failed',
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              textStatus: 'failed',
              audioStatus: 'not_started',
              demoStatus: 'not_started',
              deckMasterStatus: 'pending',
              deckRenderStatus: 'pending',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'audio') {
          return {
            pipeline: { ...pipeline, audio: false, deck: false },
            serverStatus: 'failed',
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              audioStatus: 'failed',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'deck_master') {
          return {
            pipeline: { ...pipeline, deck: false },
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              deckMasterStatus: 'failed',
              deckRenderStatus: 'pending',
              demoStatus: 'failed',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'pages' || stepId === 'deck_render') {
          return {
            pipeline: { ...pipeline, deck: false },
            serverStatus: 'failed',
            deckStatus: 'failed',
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              deckRenderStatus: 'failed',
              demoStatus: 'failed',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'export') {
          return {
            pipeline,
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              exportStatus: 'failed',
              exportWorkflowStatus: 'export_failed',
            },
          };
        }
        return {};
      });
      await apiFetch(`/api/projects/${pid}/workflow/step/cancel-running`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepId }),
      });
      setEditorFlashMessage('已取消当前步骤并标记为失败。');
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
      if (userId !== null) {
        void fetchProjects(userId, username);
      }
    } finally {
      setCancellingRunningWorkflowStepId((cur) =>
        cur === stepId ? null : cur,
      );
    }
  }, [
    closeConfirmDialog,
    clearDeckWatch,
    confirmDialog.kind,
    confirmDialog.stepId,
    currentProjectId,
    fetchProjects,
    patchProjectWorkflowLocally,
    persistDeckRegenPending,
    userId,
    username,
  ]);

  const openManualFormAfterReopen = useCallback((stepId: string) => {
    openManualDialogForStep(stepId);
  }, [openManualDialogForStep]);

  /** 与确认弹窗内「确定回退」相同逻辑；流程面板两步确认后直接调用（不再二次弹窗）。 */
  const commitReopenSuccessWorkflowStep = useCallback(
    async (stepId: string) => {
      if (!currentProjectId) return;
      const pid = Number(currentProjectId);
      if (!Number.isFinite(pid)) return;
      setReopeningWorkflowStepId(stepId);
      setEditorFlashDownloadUrl(null);
      try {
        patchProjectWorkflowLocally(pid, (project) => {
        const pipeline = {
          outline: Boolean(project.pipeline?.outline),
          audio: Boolean(project.pipeline?.audio),
          deck: Boolean(project.pipeline?.deck),
          video: Boolean(project.pipeline?.video),
        };
        const serverWorkflow = { ...(project.serverWorkflow ?? {}) };
        if (stepId === 'text') {
          const masterStep = project.workflowSteps?.find((s) => s.id === 'deck_master');
          const keepDeckMasterStatus =
            serverWorkflow.deckMasterStatus ??
            (masterStep?.state === 'success'
              ? 'success'
              : masterStep?.state === 'running'
                ? 'running'
                : masterStep?.state === 'error'
                  ? 'failed'
                  : undefined);
          return {
            pipeline: { outline: false, audio: false, deck: false, video: false },
            pipelineAutoAdvance: false,
            manualOutlineConfirmed: false,
            serverWorkflow: {
              ...serverWorkflow,
              textStatus: 'not_started',
              audioStatus: 'not_started',
              deckRenderStatus: 'pending',
              demoStatus: 'not_started',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
              ...(keepDeckMasterStatus != null
                ? { deckMasterStatus: keepDeckMasterStatus }
                : {}),
            },
          };
        }
        if (stepId === 'audio') {
          return {
            pipeline: { ...pipeline, audio: false, video: false },
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              audioStatus: 'not_started',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'deck_master' || stepId === 'pages') {
          return {
            pipeline: { ...pipeline, deck: false, video: false },
            pipelineAutoAdvance: false,
            deckMasterSourceProjectId: null,
            serverWorkflow: {
              ...serverWorkflow,
              deckMasterStatus: 'pending',
              deckRenderStatus: 'pending',
              demoStatus: 'not_started',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'deck_render') {
          return {
            pipeline: { ...pipeline, deck: false, video: false },
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              deckRenderStatus: 'pending',
              demoStatus: 'not_started',
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        if (stepId === 'export') {
          return {
            pipeline: { ...pipeline, video: false },
            pipelineAutoAdvance: false,
            serverWorkflow: {
              ...serverWorkflow,
              exportStatus: 'not_started',
              exportWorkflowStatus: 'not_exported',
            },
          };
        }
        return {};
      });
      await apiFetch(`/api/projects/${pid}/workflow/step/reopen-success`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepId }),
      });
      setEditorFlashMessage(
        stepId === 'export'
          ? '已回退导出状态，可在顶栏重新导出。'
          : '已回退该步骤及后续流程，请在下方的手动表单中继续。',
      );
      setRetryPollBoostUntil(Date.now() + 20_000);
      if (userId !== null) {
        await fetchProjects(userId, username);
      }
      if (stepId !== 'export') {
        openManualFormAfterReopen(stepId);
      }
    } catch (e) {
      setEditorFlashMessage(e instanceof Error ? e.message : String(e));
      if (userId !== null) {
        void fetchProjects(userId, username);
      }
    } finally {
      setReopeningWorkflowStepId((cur) => (cur === stepId ? null : cur));
    }
  }, [
    currentProjectId,
    fetchProjects,
    openManualFormAfterReopen,
    patchProjectWorkflowLocally,
    userId,
    username,
  ]);

  const handleConfirmReopenSuccessWorkflowStep = useCallback(async () => {
    if (confirmDialog.kind !== 'reopen' || !confirmDialog.stepId || !currentProjectId) return;
    const stepId = confirmDialog.stepId;
    closeConfirmDialog();
    await commitReopenSuccessWorkflowStep(stepId);
  }, [
    closeConfirmDialog,
    commitReopenSuccessWorkflowStep,
    confirmDialog.kind,
    confirmDialog.stepId,
    currentProjectId,
  ]);

  const handleCreateProject = async (newProject: CreateProjectInput) => {
    /** 先落库 queued，后台跑结构化 → 配音 → 演示页；仅素材进 STRUCTURE_SYSTEM */
    const rawText = (newProject.prompt || '').trim();
    const trimmedName = (newProject.name || '').trim();
    if (!rawText || !trimmedName || userId === null) return;
    setCreateError(null);
    try {
      const preset = (newProject.style || 'none').trim() || 'none';
      const body: Record<string, unknown> = {
        name: trimmedName,
        raw_text: rawText,
        deck_page_size: newProject.screenSize,
        deck_style_preset: preset,
      };
      const hint = (newProject.deckStyleUserHint || '').trim();
      if (hint) body.deck_style_user_hint = hint;
      if (
        typeof newProject.copyDeckMasterFromProjectId === 'number' &&
        newProject.copyDeckMasterFromProjectId > 0
      ) {
        body.copy_deck_master_from_project_id =
          newProject.copyDeckMasterFromProjectId;
      }
      if (newProject.includeIntro) body.include_intro = true;
      if (newProject.includeOutro) body.include_outro = true;
      if (
        typeof newProject.narrationTargetSeconds === 'number' &&
        Number.isFinite(newProject.narrationTargetSeconds)
      ) {
        body.narration_target_seconds = Math.round(newProject.narrationTargetSeconds);
      }
      const ttsVt = (newProject.ttsVoiceType || '').trim();
      if (ttsVt) {
        body.tts_voice_type = ttsVt;
      }
      body.pipeline_auto_advance = newProject.pipelineAutoAdvance !== false;
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
        action: 'export' | 'download';
        pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
      }>(`/api/projects/${pid}/export-video`, {
        method: 'POST',
        body: postExportVideoBody(),
      });
      applyExportVideoResponse(pid, res);
      const finalUrl = apiUrl(res.output_url);
      if (typeof window !== 'undefined') {
        await startBrowserDownload(finalUrl, project?.name);
      }
    },
    [applyExportVideoResponse, postExportVideoBody, projects, startBrowserDownload],
  );

  const pl = currentProject?.pipeline;
  const editorUiBlocked =
    !editorTimelineUnlocked || (timelineBlocking && clips.length === 0);

  const editorFlashTone: 'success' | 'error' | null = editorFlashMessage
    ? /失败|未成功|错误/i.test(editorFlashMessage)
      ? 'error'
      : 'success'
    : null;

  /** 服务端是否已有成片（弹窗内区分「仅下载 / 重新导出」） */
  const serverExportVideoReady = Boolean(pl?.video);

  if (!sessionReady) {
    return (
      <div className="sf-theme sf-app-shell flex h-screen w-full items-center justify-center bg-zinc-950 font-sans text-zinc-400">
        正在恢复会话…
      </div>
    );
  }

  if (currentView === 'home') {
    return (
      <div className="sf-theme sf-app-shell h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden font-sans selection:bg-purple-500/30">
        <TopBar
          username={userId !== null ? username : null}
          onLogin={() => void bootstrap()}
          onLogout={() => void handleLogout()}
          themeMode={themeMode}
          onToggleTheme={() =>
            setThemeMode((prev) => (prev === 'dark' ? 'light' : 'dark'))
          }
        />
        {projectsError ? (
          <div
            role="alert"
            className="sf-toast-error-block pointer-events-auto fixed left-1/2 top-16 z-[100] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-2 text-sm text-red-200 shadow-xl backdrop-blur-md"
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
    <div className="sf-theme sf-app-shell h-screen w-full bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden font-sans selection:bg-purple-500/30">
      <TopBar
        username={userId !== null ? username : null}
        onLogin={() => void bootstrap()}
        onLogout={() => void handleLogout()}
        projectName={currentProject?.name}
        onOpenProjectDetails={() => setProjectDetailsOpen(true)}
        onBackToHome={() => {
          suppressNextUrlProjectHydrateRef.current = true;
          setCurrentView('home');
          setCurrentProjectId(null);
        }}
        steps={displaySteps}
        pipelineAutoAdvance={currentProject?.pipelineAutoAdvance !== false}
        manualOutlineConfirmed={currentProject?.manualOutlineConfirmed ?? true}
        onRetryStep={(id) => void handleRetryWorkflowStep(id)}
        retryingStepId={retryingWorkflowStepId}
        onCancelRunningStep={(id) => void handleCancelRunningWorkflowStep(id)}
        cancellingStepId={cancellingRunningWorkflowStepId}
        onReopenSuccessStep={(id) => handleTopBarReopenSuccessStep(id)}
        reopeningSuccessStepId={reopeningWorkflowStepId}
        downloadEnabled={videoActionEnabled}
        videoReady={editorVideoReady}
        downloadLoading={videoActionLoading}
        onDownloadClick={() => setExportChoiceOpen(true)}
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
      <ExportVideoChoiceDialog
        open={exportChoiceOpen}
        serverHasVideo={serverExportVideoReady}
        busy={exportSubmitting}
        onClose={() => setExportChoiceOpen(false)}
        onDownloadOnly={() => void handleExportChoiceDownloadOnly()}
        onForceReexport={() => void handleExportChoiceForceReexport()}
      />
      {currentProjectId && Number.isFinite(Number(currentProjectId)) ? (
        <>
          <ManualTextPrepDialog
            open={activeManualDialog === 'text'}
            projectId={Number(currentProjectId)}
            initialRaw={(currentProject?.inputPrompt ?? '').trim()}
            initialMode={
              currentProject?.textStructureMode === 'verbatim_split'
                ? 'verbatim_split'
                : 'polish'
            }
            onClose={closeManualDialog}
            onConfirmHandoff={() =>
              setWorkflowPanelDismissSignal((n) => n + 1)
            }
            onQueued={() => {
              setHeaderTextStructureKickoffPending(true);
              setEditorFlashMessage('已排队生成文案，请稍候。');
              setRetryPollBoostUntil(Date.now() + 20_000);
              if (userId !== null) void fetchProjects(userId, username);
            }}
          />
          <ManualOutlineConfirmDialog
            open={activeManualDialog === 'outline'}
            projectId={Number(currentProjectId)}
            onClose={closeManualDialog}
            onConfirmHandoff={() =>
              setWorkflowPanelDismissSignal((n) => n + 1)
            }
            onConfirmed={() => {
              setEditorDataVersion((v) => v + 1);
              if (userId !== null) void fetchProjects(userId, username);
            }}
            onAudioChainComplete={() => {
              setEditorFlashMessage('口播分段已确认，整稿配音已完成。');
              setRetryPollBoostUntil(Date.now() + 20_000);
              if (userId !== null) void fetchProjects(userId, username);
            }}
            onNextStepError={(msg) => setEditorFlashMessage(msg)}
          />
          <ManualDeckMasterDialog
            open={activeManualDialog === 'deck_master'}
            projectId={Number(currentProjectId)}
            initialHint={(currentProject?.deckStyleUserHint ?? '').trim()}
            initialDeckStylePreset={
              (currentProject?.deckStylePreset ?? 'none').trim() || 'none'
            }
            initialDeckMasterSourceProjectId={
              currentProject?.deckMasterSourceProjectId ?? null
            }
            onClose={closeManualDialog}
            onDone={() => {
              setRetryPollBoostUntil(Date.now() + 20_000);
              if (userId !== null) void fetchProjects(userId, username);
            }}
            onProceedToDeckPages={() => {
              setEditorFlashMessage('演示母版已就绪，请在弹窗中确认风格说明后再生成场景页。');
              openManualDialogForStep('pages');
            }}
          />
          <ManualDeckPagesDialog
            open={activeManualDialog === 'deck_pages'}
            projectId={Number(currentProjectId)}
            initialDeckStylePromptText={currentProject?.deckStylePromptText ?? null}
            onClose={closeManualDialog}
            onConfirmHandoff={() =>
              setWorkflowPanelDismissSignal((n) => n + 1)
            }
            onGenerationStarted={() => {
              const pid = Number(currentProjectId);
              if (!Number.isFinite(pid)) return;
              patchProjectWorkflowLocally(pid, (p) => ({
                deckStatus: 'generating',
                serverWorkflow: {
                  ...(p.serverWorkflow ?? {}),
                  deckRenderStatus: 'running',
                  demoStatus: 'running',
                },
              }));
            }}
            onDone={() => {
              setEditorFlashMessage('场景页生成已启动。');
              setRetryPollBoostUntil(Date.now() + 20_000);
              if (userId !== null) void fetchProjects(userId, username);
            }}
            onAlreadyComplete={() => {
              setEditorFlashMessage('各页演示已就绪，进度已与服务器同步。');
              setEditorDataVersion((v) => v + 1);
              setRetryPollBoostUntil(Date.now() + 20_000);
              if (userId !== null) void fetchProjects(userId, username);
            }}
          />
        </>
      ) : null}
      <CancelRunningPipelineStepDialog
        open={confirmDialog.kind === 'cancel'}
        busy={false}
        stepId={confirmDialog.stepId}
        onClose={closeConfirmDialog}
        onConfirm={() => void handleConfirmCancelRunningWorkflowStep()}
      />
      <ReopenSuccessPipelineStepDialog
        open={confirmDialog.kind === 'reopen'}
        busy={false}
        stepId={confirmDialog.stepId}
        onClose={closeConfirmDialog}
        onConfirm={() => void handleConfirmReopenSuccessWorkflowStep()}
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
                  ? 'sf-toast-editor-error pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-rose-500/35 bg-rose-950/90 px-3 py-2.5 text-sm text-rose-100 shadow-xl backdrop-blur-md'
                  : 'sf-toast-editor-success pointer-events-auto flex items-center justify-between gap-3 rounded-lg border border-emerald-500/35 bg-emerald-950/90 px-3 py-2.5 text-sm text-emerald-100 shadow-xl backdrop-blur-md'
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
                      ? 'shrink-0 rounded-md border border-rose-300/35 px-2 py-1 text-xs text-rose-100 transition-colors hover:bg-rose-900/40'
                      : 'shrink-0 rounded-md border border-emerald-300/35 px-2 py-1 text-xs text-emerald-50 transition-colors hover:bg-emerald-900/45'
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
                    ? 'shrink-0 rounded-md p-1 text-rose-300/90 transition-colors hover:bg-rose-900/45 hover:text-rose-50'
                    : 'shrink-0 rounded-md p-1 text-emerald-300/90 transition-colors hover:bg-emerald-900/50 hover:text-emerald-100'
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
              className="sf-toast-timeline-warn pointer-events-auto rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md"
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
              onAudioResynthStart={onAudioResynthStart}
              onAudioResynthEnd={onAudioResynthEnd}
              onAudioResynthSuccess={onAudioResynthSuccess}
              onDeckPageRegenSubmitted={onDeckPageRegenSubmitted}
              deckRegenerating={headerDeckRegenPending}
              deckRegeneratingPageNodeId={headerDeckRegenPendingPageNodeId}
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
              audioNarrationDraftText={detailPanelNarrationDraftText}
            />

            <div
              className="w-1.5 hover:bg-purple-500 bg-zinc-800 cursor-col-resize shrink-0 z-20 transition-colors"
              onMouseDown={handleSidebarMouseDown}
            />
          </>
        ) : null}

        <MainWorkspace
          steps={displaySteps}
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
        className="h-1.5 hover:bg-purple-500 bg-zinc-800 cursor-row-resize shrink-0 z-20 transition-colors relative"
        onMouseDown={handleTimelineMouseDown}
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-0.5 bg-zinc-600 rounded-full" />
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
        workflowPanel={
          displaySteps.length > 0
            ? {
                steps: displaySteps,
                pipelineAutoAdvance: currentProject?.pipelineAutoAdvance,
                manualOutlineConfirmed: currentProject?.manualOutlineConfirmed,
                deckMasterSourceProjectId:
                  currentProject?.deckMasterSourceProjectId ?? null,
                videoReady: editorVideoReady,
                onRetryStep: (id) => void handleRetryWorkflowStep(id),
                retryingStepId: retryingWorkflowStepId,
                onCancelRunningStep: (id) =>
                  void handleCancelRunningWorkflowStep(id),
                cancellingStepId: cancellingRunningWorkflowStepId,
                onCommitReopenSuccessStep: (id) =>
                  void commitReopenSuccessWorkflowStep(id),
                reopeningStepId: reopeningWorkflowStepId,
              }
            : null
        }
        workflowPanelDismissSignal={workflowPanelDismissSignal}
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
