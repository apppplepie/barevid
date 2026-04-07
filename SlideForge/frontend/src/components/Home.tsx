import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Folder,
  Plus,
  Video,
  LayoutTemplate,
  Monitor,
  Clock,
  Cloud,
  Lock,
  User,
  Loader2,
  Type,
  Mic,
  Sparkles,
  Copy,
  Trash2,
  Pencil,
  MoreVertical,
  Download,
  Check,
} from 'lucide-react';
import { WorkflowStep } from './WorkflowProgressBar';
import type { ServerWorkflow } from '../utils/workflowFromPipeline';
import {
  NARRATION_CUSTOM_MINUTES_MAX,
  NARRATION_CUSTOM_MINUTES_MIN,
  clampNarrationSeconds,
  narrationCharEstimate,
} from '../utils/narrationLength';
import {
  TTS_VOICE_PRESETS_FALLBACK,
  mergeTtsVoicePresetsFromServer,
} from '../utils/ttsVoicePresets';
import { apiFetch } from '../api';
import { TtsVoiceSelect } from './TtsVoiceSelect';
import type { VideoExportJobInfo } from './ExportVideoStatusDialog';
import { APP_BRAND } from '../brand';
import type { OutlineNodeApi } from '../utils/outlineScriptPages';
import { projectPipelineTagTone } from '../utils/projectPipelineTagTone';
import { SfTag } from './ui/SfTag';

export interface Project {
  id: string;
  name: string;
  screenSize: string;
  style: string;
  lastModified: string;
  prompt?: string;
  workflowSteps: WorkflowStep[];
  /** 最近一次列表/详情接口的 workflow，供 deriveWorkflowSteps 与导出结果合并 */
  serverWorkflow?: ServerWorkflow | null;
  /** 后端 projects.status */
  serverStatus?: string;
  deckStatus?: string;
  /** 与后端 `compute_project_pipeline` 一致 */
  pipeline?: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
  author?: string;
  isShared?: boolean;
  /** 与后端 `owner_user_id` 一致，用于区分「我的项目」与「他人云共享」 */
  ownerUserId?: number;
  /** 创建时复用母版的源项目 id（后端写入 description 标记） */
  deckMasterSourceProjectId?: number | null;
  /** 当前进行中的视频导出任务（GET /api/projects 与详情轮询） */
  videoExportJob?: VideoExportJobInfo | null;
  includeIntro?: boolean;
  includeOutro?: boolean;
  /** 列表/详情来自后端 narration_target_seconds */
  narrationTargetSeconds?: number | null;
  /** 项目豆包音色；创建时可填，null/未设表示跟随服务器 .env */
  ttsVoiceType?: string | null;
  /** 解析后的实际 voice_type（展示用） */
  ttsVoiceEffective?: string;
  /** 后端 pipeline_auto_advance：创建时可开自动；任一步「回退已完成」后服务端会置为 false */
  pipelineAutoAdvance?: boolean;
  textStructureMode?: 'polish' | 'verbatim_split';
  /** false 时需用户在表单中确认口播分段后才可配音/演示 */
  manualOutlineConfirmed?: boolean;
  /** 详情接口同步的主题原文 */
  inputPrompt?: string | null;
  /** 演示风格用户提示词（详情同步） */
  deckStyleUserHint?: string | null;
  /** 后端 deck_style_preset slug（none | aurora_glass | …），供母版弹窗等使用 */
  deckStylePreset?: string;
  /** 详情同步：ProjectStyle.style_prompt_text，供「生成场景页」弹窗预填 */
  deckStylePromptText?: string | null;
  /** 最近一次 GET /api/projects/:id 的 outline 树，供口播确认弹窗首屏即用 */
  outlineNodes?: OutlineNodeApi[] | null;
}

/** 提交创建表单时传入；母版源与列表字段 deckMasterSourceProjectId 不同 */
export type CreateProjectInput = Omit<
  Project,
  'id' | 'lastModified' | 'workflowSteps' | 'deckMasterSourceProjectId' | 'serverWorkflow'
> & {
  copyDeckMasterFromProjectId?: number | null;
  includeIntro?: boolean;
  includeOutro?: boolean;
  /** 对应后端 `deck_style_user_hint` */
  userStyleHint?: string;
  /** 目标口播总时长（秒），写入 `projects.target_narration_seconds` */
  targetNarrationSeconds?: number;
  ttsVoiceType?: string;
  pipelineAutoAdvance?: boolean;
};

function pipelineStatusLabel(project: Project): string {
  const st = (project.serverStatus || '').toLowerCase();
  const ds = (project.deckStatus || 'idle').toLowerCase();
  const pl = project.pipeline;
  if (st === 'failed') return '失败';
  if (st === 'queued') return '加载中';
  if (st === 'pending_text') return '待生成文案';
  if (st === 'structuring') return '文本结构化';
  if (st === 'synthesizing') return '配音中';
  if (pl?.video) return '完成';
  if (pl?.audio && pl?.deck) return '就绪';
  if (pl?.audio && (ds === 'generating' || !pl?.deck)) return '演示页生成中';
  if (pl?.audio) return '待演示页';
  if (pl?.outline) return '待配音';
  return '处理中';
}

/** 为 false 时隐藏片头/片尾勾选 UI；状态仍参与提交，便于日后开放入口 */
/** 与后端片头/片尾入口一致：暂关；恢复时改为 true 并打开 App 内 body.include_* */
const SHOW_INTRO_OUTRO_UI = false;

const ASPECT_PRESETS = [
  { value: '16:9', title: '16:9', hint: '横屏' },
  { value: '4:3', title: '4:3', hint: '标准' },
  { value: '9:16', title: '9:16', hint: '竖屏' },
  { value: '1:1', title: '1:1', hint: '方形' },
] as const;

/** 与 backend `DECK_STYLE_PRESET_ORDER` / `DECK_STYLE_PRESETS` 一致；暂不展示用户自定义风格描述 */
const NARRATION_LENGTH_PRESETS = [
  { id: '30' as const, seconds: 30, label: '30 秒' },
  { id: '60' as const, seconds: 60, label: '1 分钟' },
  { id: '180' as const, seconds: 180, label: '3 分钟' },
  { id: '300' as const, seconds: 300, label: '5 分钟' },
] as const;

type NarrationLengthPick =
  | null
  | { kind: 'preset'; id: (typeof NARRATION_LENGTH_PRESETS)[number]['id'] }
  | { kind: 'custom' };

const STYLE_PRESETS = [
  { value: 'aurora_glass', title: '极光玻璃', subtitle: '' },
  { value: 'minimal_tech', title: '极简科技', subtitle: '' },
  { value: 'dark_neon', title: '暗黑霓虹', subtitle: '' },
  { value: 'editorial_luxury', title: '杂志高级感', subtitle: '' },
  { value: 'futuristic_hud', title: '未来 HUD', subtitle: '' },
] as const;

/** 卡片上展示的母版号：复用则显示源项目 id，自建则显示本项目 id */
function deckMasterDisplayNo(project: Project): string {
  if (project.deckMasterSourceProjectId != null) {
    return String(project.deckMasterSourceProjectId);
  }
  const n = Number.parseInt(String(project.id), 10);
  return Number.isFinite(n) ? String(n) : String(project.id);
}

function DeckMasterBadge({ project }: { project: Project }) {
  const no = deckMasterDisplayNo(project);
  const reused = project.deckMasterSourceProjectId != null;
  return (
    <SfTag
      tone={reused ? 'violet' : 'neutral'}
      size="xs"
      mono
      className="sf-deck-master-badge shrink-0 text-[11px] leading-none"
      title={reused ? `演示母版复用自项目 ${no}` : `本项目演示母版（项目 ID ${no}）`}
    >
      母版{no}
    </SfTag>
  );
}

interface HomeProps {
  projects: Project[];
  /** 已登录时与后端用户 id 一致；未登录为 null */
  currentUserId: number | null;
  /** 创建项目接口失败时由 App 传入，在表单内展示 */
  createError?: string | null;
  onCreateProject: (project: CreateProjectInput) => void | Promise<void>;
  onSelectProject: (id: string) => void;
  onToggleShare: (id: string, isShared: boolean) => void;
  onRenameProject: (id: string, name: string) => void | Promise<void>;
  onDeleteProject: (id: string) => void | Promise<void>;
  onCopyProject: (id: string) => void | Promise<void>;
  onUploadProject: (id: string) => void | Promise<void>;
  onDownloadProject: (id: string) => void | Promise<void>;
}

export function Home({
  projects,
  currentUserId,
  createError,
  onCreateProject,
  onSelectProject,
  onToggleShare,
  onRenameProject,
  onDeleteProject,
  onCopyProject,
  onUploadProject,
  onDownloadProject,
}: HomeProps) {
  const [newProjectName, setNewProjectName] = useState('');
  const [selectedSize, setSelectedSize] = useState('16:9');
  /** 与后端 style_preset 一致；none 表示未选预设，可再点同一项取消 */
  const [selectedStyle, setSelectedStyle] = useState<string>('none');
  const [deckStyleUserHint, setDeckStyleUserHint] = useState('');
  /** 复用已有项目的演示母版：填源项目数字 id */
  const [deckMasterSourceRaw, setDeckMasterSourceRaw] = useState('');
  /** 自己设计 = AI 按风格生成母版；复用母版 = 从指定项目复制（与风格预设/提示词互斥） */
  const [deckMasterMode, setDeckMasterMode] = useState<'self' | 'reuse'>('self');
  const [includeIntro, setIncludeIntro] = useState(false);
  const [includeOutro, setIncludeOutro] = useState(false);
  const [narrationLengthPick, setNarrationLengthPick] = useState<NarrationLengthPick>(null);
  const [narrationCustomMinutes, setNarrationCustomMinutes] = useState('');
  const [prompt, setPrompt] = useState('');
  const [ttsVoicePresets, setTtsVoicePresets] = useState<
    { value: string; label: string }[]
  >([]);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState('');
  /** 创建时流水线：自动=文案成功后后台跑配音+演示；手动=每步在工程内确认 */
  const [pipelineRunMode, setPipelineRunMode] = useState<'auto' | 'manual'>('auto');
  const [creating, setCreating] = useState(false);
  const [managingProjectId, setManagingProjectId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [copyingProjectId, setCopyingProjectId] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ id: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [exportWorkerAlive, setExportWorkerAlive] = useState<number | null>(null);
  const [exportWorkerStatusErr, setExportWorkerStatusErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await apiFetch<{ alive: number }>('/api/video-export-workers/status');
        if (!cancelled) {
          setExportWorkerAlive(typeof r.alive === 'number' ? r.alive : 0);
          setExportWorkerStatusErr(false);
        }
      } catch {
        if (!cancelled) {
          setExportWorkerAlive(null);
          setExportWorkerStatusErr(true);
        }
      }
    };
    void tick();
    const id = window.setInterval(tick, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (currentUserId == null) return;
    let cancelled = false;
    void apiFetch<{ presets: { value: string; label: string }[] }>(
      '/api/tts/voice-presets',
    )
      .then((r) => {
        if (!cancelled) {
          setTtsVoicePresets(mergeTtsVoicePresetsFromServer(r.presets));
        }
      })
      .catch(() => {
        if (!cancelled) setTtsVoicePresets(TTS_VOICE_PRESETS_FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  const parsedCopyMasterId = (() => {
    const t = deckMasterSourceRaw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const copyMasterInvalid =
    deckMasterMode === 'reuse' &&
    Boolean(deckMasterSourceRaw.trim()) &&
    parsedCopyMasterId === null;
  const reuseMasterNeedsId =
    deckMasterMode === 'reuse' &&
    (!deckMasterSourceRaw.trim() || parsedCopyMasterId === null);

  const customMinutesTrimmed = narrationCustomMinutes.trim();
  const customMinutesNumericLoose = (() => {
    if (!customMinutesTrimmed) return null;
    const n = Math.round(Number(customMinutesTrimmed));
    return Number.isFinite(n) ? n : null;
  })();
  const parsedCustomMinutes = (() => {
    if (!customMinutesTrimmed) return null;
    const n = Math.round(Number(customMinutesTrimmed));
    if (!Number.isFinite(n)) return null;
    if (n < NARRATION_CUSTOM_MINUTES_MIN || n > NARRATION_CUSTOM_MINUTES_MAX) return null;
    return n;
  })();

  const narrationCustomOverMax =
    narrationLengthPick?.kind === 'custom' &&
    customMinutesNumericLoose !== null &&
    customMinutesNumericLoose > NARRATION_CUSTOM_MINUTES_MAX;
  const narrationCustomUnderMin =
    narrationLengthPick?.kind === 'custom' &&
    customMinutesNumericLoose !== null &&
    customMinutesNumericLoose < NARRATION_CUSTOM_MINUTES_MIN;

  const resolvedNarrationSeconds = (() => {
    if (narrationLengthPick?.kind === 'preset') {
      const row = NARRATION_LENGTH_PRESETS.find((p) => p.id === narrationLengthPick.id);
      return row?.seconds ?? null;
    }
    if (narrationLengthPick?.kind === 'custom' && parsedCustomMinutes != null) {
      return clampNarrationSeconds(parsedCustomMinutes * 60);
    }
    return null;
  })();

  const narrationCustomInvalid =
    narrationLengthPick?.kind === 'custom' &&
    (customMinutesTrimmed === '' || parsedCustomMinutes === null);

  const narrationEstimate =
    resolvedNarrationSeconds != null
      ? narrationCharEstimate(resolvedNarrationSeconds)
      : null;

  const canSubmit =
    Boolean(newProjectName.trim()) &&
    Boolean(prompt.trim()) &&
    !copyMasterInvalid &&
    !reuseMasterNeedsId &&
    !narrationCustomInvalid;

  const resetCreateForm = () => {
    setNewProjectName('');
    setPrompt('');
    setDeckMasterSourceRaw('');
    setDeckMasterMode('self');
    setSelectedStyle('none');
    setDeckStyleUserHint('');
    setIncludeIntro(false);
    setIncludeOutro(false);
    setNarrationLengthPick(null);
    setNarrationCustomMinutes('');
    setPipelineRunMode('auto');
    setSelectedSize('16:9');
    setSelectedTtsVoice('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || creating) return;
    setCreating(true);
    try {
      const narrSec =
        resolvedNarrationSeconds != null
          ? Math.min(1800, clampNarrationSeconds(resolvedNarrationSeconds))
          : undefined;
      await onCreateProject({
        name: newProjectName.trim(),
        screenSize: selectedSize,
        style: deckMasterMode === 'reuse' ? 'none' : selectedStyle,
        prompt: prompt.trim(),
        copyDeckMasterFromProjectId:
          deckMasterMode === 'reuse' ? parsedCopyMasterId : null,
        includeIntro,
        includeOutro,
        targetNarrationSeconds: narrSec,
        userStyleHint:
          deckMasterMode === 'reuse'
            ? undefined
            : deckStyleUserHint.trim() || undefined,
        ttsVoiceType: selectedTtsVoice.trim() || undefined,
        pipelineAutoAdvance: pipelineRunMode === 'auto',
      });
      setNewProjectName('');
      setPrompt('');
      setDeckMasterSourceRaw('');
      setDeckMasterMode('self');
      setSelectedStyle('none');
      setDeckStyleUserHint('');
      setIncludeIntro(false);
      setIncludeOutro(false);
      setNarrationLengthPick(null);
      setNarrationCustomMinutes('');
      setPipelineRunMode('auto');
      setSelectedTtsVoice('');
    } catch {
      /* 错误已由 App 写入 createError */
    } finally {
      setCreating(false);
    }
  };

  const introOutroSection = SHOW_INTRO_OUTRO_UI ? (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
                  <Video className="h-3.5 w-3.5 text-cyan-400/90 light:text-cyan-600" />
                  导出附加片头/片尾
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-800/90 light:border-slate-200 bg-zinc-950/50 light:bg-white px-3 py-2 text-sm text-zinc-300 light:text-slate-700 has-[:disabled]:cursor-not-allowed">
                    <input
                      type="checkbox"
                      checked={includeIntro}
                      onChange={(e) => setIncludeIntro(e.target.checked)}
                      disabled={creating}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-600 light:border-slate-400 bg-zinc-800/95 light:bg-slate-100 text-zinc-100 shadow-inner peer-checked:border-purple-500/70 peer-checked:bg-purple-600 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500/45 peer-disabled:opacity-50 [&>svg]:scale-90 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span>片头</span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-800/90 light:border-slate-200 bg-zinc-950/50 light:bg-white px-3 py-2 text-sm text-zinc-300 light:text-slate-700 has-[:disabled]:cursor-not-allowed">
                    <input
                      type="checkbox"
                      checked={includeOutro}
                      onChange={(e) => setIncludeOutro(e.target.checked)}
                      disabled={creating}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-zinc-600 light:border-slate-400 bg-zinc-800/95 light:bg-slate-100 text-zinc-100 shadow-inner peer-checked:border-purple-500/70 peer-checked:bg-purple-600 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500/45 peer-disabled:opacity-50 [&>svg]:scale-90 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span>片尾</span>
                  </label>
                </div>
                <p className="text-xs text-zinc-500 light:text-slate-500">
                  勾选后，视频导出会按服务端配置的默认时长追加片头/片尾。
                </p>
              </div>
  ) : null;

  /** 最近项目：仅本人拥有的项目（含本人已上传云的锁定项目） */
  const recentProjects =
    currentUserId == null
      ? []
      : projects.filter((p) => p.ownerUserId === currentUserId);
  /** 云共享：所有已上传云的项目（含本人），与「最近项目」中本人已锁定项一致，便于在目录中看到 */
  const sharedProjects =
    currentUserId == null ? [] : projects.filter((p) => Boolean(p.isShared));

  const withManage = async (task: () => Promise<void>) => {
    setManageError(null);
    try {
      await task();
    } catch (e) {
      setManageError(e instanceof Error ? e.message : String(e));
    } finally {
      setManagingProjectId(null);
    }
  };

  const handleCopy = async (projectId: string) => {
    if (copyingProjectId) return;
    setCopyingProjectId(projectId);
    try {
      await withManage(async () => onCopyProject(projectId));
    } finally {
      setCopyingProjectId(null);
    }
  };

  return (
    <div className="sf-home-root sf-bg-base sf-text-primary flex-1 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        
        {/* Header & Create Form */}
        <section className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sf-text-primary">{APP_BRAND}</h1>
              <p className="mt-2 sf-text-muted">创建和管理你的视频工程项目。</p>
            </div>
            <div
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                exportWorkerStatusErr || exportWorkerAlive === null
                  ? 'border-zinc-600/50 bg-zinc-900/50 text-zinc-400 light:border-slate-300 light:bg-slate-100 light:text-slate-600'
                  : exportWorkerAlive > 0
                    ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300/95 light:border-emerald-600/30 light:bg-emerald-50 light:text-emerald-800'
                    : 'border-red-500/40 bg-red-950/25 text-red-200/95 light:border-red-300 light:bg-red-50 light:text-red-800'
              }`}
              title={
                exportWorkerStatusErr
                  ? '无法连接服务器获取导出 Worker 状态'
                  : exportWorkerAlive === null
                    ? '正在检测导出 Worker 状态'
                    : exportWorkerAlive > 0
                      ? '有在线导出 Worker，视频导出任务可排队处理'
                      : '当前无在线导出 Worker，视频将无法导出'
              }
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  exportWorkerStatusErr || exportWorkerAlive === null
                    ? 'bg-zinc-500 light:bg-slate-400'
                    : exportWorkerAlive > 0
                      ? 'bg-emerald-400 light:bg-emerald-500'
                      : 'bg-red-400 light:bg-red-500'
                }`}
                aria-hidden
              />
              <span>
                {exportWorkerStatusErr
                  ? 'Worker 状态未知'
                  : exportWorkerAlive === null
                    ? '正在检测 Worker状态…'
                    : exportWorkerAlive > 0
                      ? `有 ${exportWorkerAlive} 个在线 Worker`
                      : '无在线 Worker（无法导出视频）'}
              </span>
            </div>
          </div>
          {currentUserId == null ? (
            <div className="rounded-2xl border border-zinc-800/80 light:border-slate-200 bg-zinc-900/40 light:bg-white px-6 py-14 text-center">
              <p className="text-sm text-zinc-300 light:text-slate-700">
                请先登录后再使用创建项目、编辑工程与云共享等功能。
              </p>
              <p className="mt-3 text-xs text-sf-muted">点击右上角「Login」登录或注册账号。</p>
            </div>
          ) : (
            <>
              {manageError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-red-500/35 bg-red-950/25 px-3 py-2 text-sm text-red-200/95"
                >
                  {manageError}
                </p>
              ) : null}

              <form
            onSubmit={(e) => void handleCreate(e)}
            className="sf-home-create-form relative overflow-hidden rounded-2xl border border-zinc-800/80 light:border-slate-200 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 light:from-white light:to-slate-50/90 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] light:shadow-slate-200/60 light:shadow-sm flex flex-col gap-6"
          >
            <div
              className="sf-home-create-form-glow pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-purple-600/10 blur-3xl"
              aria-hidden
            />
            <div
              className="sf-home-create-form-glow pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-violet-500/5 blur-3xl"
              aria-hidden
            />

            <div className="relative space-y-2">
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-300">
                <Type className="h-3.5 w-3.5 text-purple-400/90" />
                <span className="inline-flex items-center gap-2">
                  项目名称
                  <SfTag tone="red" size="xs" className="px-1.5 text-[10px] font-semibold tracking-wide">
                    必填
                  </SfTag>
                </span>
              </label>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="例如：产品发布会口播"
                className="w-full rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 shadow-inner placeholder:text-zinc-600 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-[border-color,box-shadow]"
              />
            </div>

            <div className="relative flex flex-col gap-2">
              <label className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-300">
                <Sparkles className="h-3.5 w-3.5 text-amber-400/90" />
                <span className="inline-flex items-center gap-2">
                  主题与要点
                  <SfTag tone="red" size="xs" className="px-1.5 text-[10px] font-semibold tracking-wide">
                    必填
                  </SfTag>
                </span>
              </label>
              <textarea
                required
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="粘贴你的口播素材或要点：讲什么、例子、数据、节奏偏好等。模型会按播客编辑规则整理成结构化 JSON 大纲。"
                rows={4}
                className="w-full resize-y min-h-[108px] rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 shadow-inner placeholder:text-zinc-600 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-[border-color,box-shadow]"
              />
            </div>

            <div className="relative space-y-6">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                  <Monitor className="h-3.5 w-3.5 text-purple-400/90" />
                  画面比例
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ASPECT_PRESETS.map((opt) => {
                    const on = selectedSize === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSelectedSize(opt.value)}
                        disabled={creating}
                        className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-all disabled:opacity-50 ${
                          on
                            ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_20px_-8px_rgba(168,85,247,0.5)]'
                            : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                        }`}
                      >
                        <span className="block font-medium tabular-nums">{opt.title}</span>
                        <span className="block text-xs text-zinc-500 sf-text-muted">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                  <LayoutTemplate className="h-3.5 w-3.5 text-purple-400/90" />
                  演示母版
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (creating || deckMasterMode === 'self') return;
                      setDeckMasterMode('self');
                      setDeckMasterSourceRaw('');
                    }}
                    disabled={creating}
                    className={`rounded-xl border px-3 py-2 text-sm transition-all disabled:opacity-50 ${
                      deckMasterMode === 'self'
                        ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(168,85,247,0.45)]'
                        : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                    }`}
                  >
                    自己设计
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (creating || deckMasterMode === 'reuse') return;
                      setDeckMasterMode('reuse');
                      setSelectedStyle('none');
                      setDeckStyleUserHint('');
                    }}
                    disabled={creating}
                    className={`rounded-xl border px-3 py-2 text-sm transition-all disabled:opacity-50 ${
                      deckMasterMode === 'reuse'
                        ? 'border-violet-500/50 bg-violet-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(139,92,246,0.4)]'
                        : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                    }`}
                  >
                    复用母版
                  </button>
                </div>
                {deckMasterMode === 'self' ? (
                  <>
                    <p className="text-xs text-zinc-500">
                      由模型按下方风格生成演示母版。预设可点选或取消（再点同一项恢复为不选）；可与自定义风格提示词一起使用。
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {STYLE_PRESETS.map((opt) => {
                        const on = selectedStyle === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setSelectedStyle((prev) =>
                                prev === opt.value ? 'none' : opt.value,
                              )
                            }
                            disabled={creating}
                            className={`shrink-0 rounded-xl border px-3 py-2.5 text-left text-sm transition-all disabled:opacity-50 ${
                              on
                                ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_20px_-8px_rgba(168,85,247,0.5)]'
                                : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                            }`}
                          >
                            <span className="block font-medium leading-snug">{opt.title}</span>
                            {opt.subtitle ? (
                              <span className="mt-0.5 block text-xs text-zinc-500 sf-text-muted">{opt.subtitle}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor="deck-style-user-hint"
                        className="text-xs font-medium text-zinc-400"
                      >
                        自定义风格提示词（选填）
                      </label>
                      <textarea
                        id="deck-style-user-hint"
                        rows={3}
                        value={deckStyleUserHint}
                        onChange={(e) => setDeckStyleUserHint(e.target.value)}
                        disabled={creating}
                        placeholder="例如：主色用深蓝、偏商务、少用渐变……"
                        className="w-full resize-y rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-3 py-2.5 text-sm text-zinc-100 shadow-inner placeholder:text-zinc-600 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-zinc-500">
                      从已有工程复制演示母版，不再为母版调用模型。须填写源项目的数字 ID，且该项目已有就绪母版。
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-400 sf-text-secondary">源项目 ID</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="例如 12"
                        title="源项目数字 ID"
                        value={deckMasterSourceRaw}
                        onChange={(e) =>
                          setDeckMasterSourceRaw(e.target.value.replace(/\s+/g, ''))
                        }
                        disabled={creating}
                        aria-label="复用母版源项目 ID"
                        className="min-w-[6rem] max-w-[10rem] rounded-xl border border-zinc-700/80 bg-zinc-950/90 px-3 py-2 text-center font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/55 focus:outline-none focus:ring-2 focus:ring-violet-500/25 disabled:cursor-not-allowed disabled:border-zinc-800/50 disabled:bg-zinc-950/40 disabled:text-zinc-600"
                      />
                    </div>
                    {copyMasterInvalid ? (
                      <p className="text-xs text-amber-200/95" role="alert">
                        须填写正整数项目 ID。
                      </p>
                    ) : reuseMasterNeedsId ? (
                      <p className="text-xs text-zinc-500" role="status">
                        请填写有效的源项目 ID 后即可创建。
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-500">
                        将使用项目 {parsedCopyMasterId} 的演示母版外观。
                      </p>
                    )}
                  </>
                )}
              </div>

              {introOutroSection}

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
                  <Clock className="h-3.5 w-3.5 text-amber-400/90 light:text-amber-600" />
                  口播体量（目标时长）
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {NARRATION_LENGTH_PRESETS.map((opt) => {
                    const on =
                      narrationLengthPick?.kind === 'preset' && narrationLengthPick.id === opt.id;
                    const lockedByCustom = narrationLengthPick?.kind === 'custom';
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          if (creating || lockedByCustom) return;
                          setNarrationLengthPick((cur) => {
                            if (cur?.kind === 'preset' && cur.id === opt.id) return null;
                            return { kind: 'preset', id: opt.id };
                          });
                          setNarrationCustomMinutes('');
                        }}
                        disabled={creating || lockedByCustom}
                        className={`rounded-xl border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                          on
                            ? 'border-amber-500/50 bg-amber-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(245,158,11,0.45)]'
                            : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-xl border py-1 pl-1 pr-2 transition-all ${
                      narrationLengthPick?.kind === 'custom'
                        ? 'border-amber-500/50 bg-amber-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(245,158,11,0.45)]'
                        : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400'
                    } ${creating ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (creating) return;
                        if (narrationLengthPick?.kind === 'custom') {
                          setNarrationCustomMinutes('');
                          setNarrationLengthPick(null);
                          return;
                        }
                        setNarrationCustomMinutes('');
                        setNarrationLengthPick({ kind: 'custom' });
                      }}
                      disabled={creating}
                      className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                        narrationLengthPick?.kind === 'custom'
                          ? 'text-zinc-100 hover:bg-amber-500/15'
                          : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                      }`}
                    >
                      自选
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={narrationCustomMinutes}
                      onChange={(e) =>
                        setNarrationCustomMinutes(e.target.value.replace(/[^\d]/g, ''))
                      }
                      disabled={creating || narrationLengthPick?.kind !== 'custom'}
                      placeholder="—"
                      aria-label="自选口播分钟数"
                      className="w-10 min-w-0 rounded-md border border-zinc-700/80 bg-zinc-950/90 px-1 py-1 text-center font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/55 focus:outline-none focus:ring-1 focus:ring-amber-500/35 disabled:cursor-not-allowed disabled:border-zinc-800/50 disabled:bg-zinc-950/40 disabled:text-zinc-600"
                    />
                    <span
                      className={`shrink-0 text-sm tabular-nums ${
                        narrationLengthPick?.kind === 'custom' ? 'text-zinc-300' : 'text-zinc-600'
                      }`}
                    >
                      分钟
                    </span>
                  </div>
                </div>
                {narrationCustomOverMax ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    自选口播最长为 {NARRATION_CUSTOM_MINUTES_MAX} 分钟，请改小数值或再次点击「自选」取消。
                  </p>
                ) : narrationCustomUnderMin ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    请填写至少 {NARRATION_CUSTOM_MINUTES_MIN} 分钟。
                  </p>
                ) : narrationCustomInvalid ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    已选「自选」时，请填写 {NARRATION_CUSTOM_MINUTES_MIN}～{NARRATION_CUSTOM_MINUTES_MAX}{' '}
                    之间的整数分钟；再次点击「自选」可取消。
                  </p>
                ) : null}
                {narrationEstimate ? (
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    按自然语速粗算：全稿口播约{' '}
                    <span className="tabular-nums text-zinc-300 sf-text-secondary">{narrationEstimate.midChars}</span> 字（约{' '}
                    <span className="tabular-nums text-zinc-400 sf-text-muted">
                      {narrationEstimate.minChars}～{narrationEstimate.maxChars}
                    </span>{' '}
                    字）。用于提示 AI 控制篇幅，非成片精确时长。
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    不选固定档位且未使用自选时，不对口播篇幅做额外限制。
                  </p>
                )}
              </div>
            </div>

            <div className="relative space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
                <Mic className="h-3.5 w-3.5 text-purple-400/90" />
                配音音色
              </label>
              {/* <p className="text-xs text-zinc-500">
                列表含 2.0（Uranus）与 1.0（BV）等常用 ID；若后台为 V3 + seed-tts-2.0，请优先选带「2.0」的 Uranus
                项，选 BV 可能需改 DOUBAO_TTS_RESOURCE_ID 或关闭 V3。选「默认」则用 .env 的 DOUBAO_TTS_VOICE_TYPE。
              </p> */}
              <TtsVoiceSelect
                options={ttsVoicePresets}
                value={selectedTtsVoice}
                onChange={setSelectedTtsVoice}
                disabled={creating}
                loading={ttsVoicePresets.length === 0}
              />
            </div>

            <div className="relative space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-4">
              <p className="text-sm font-medium text-zinc-300">流水线执行方式</p>
              {/* <p className="text-xs text-zinc-500 leading-relaxed">
                自动：创建后后台先跑文案结构化，成功后再连续跑配音与演示页。手动：创建后不会生成口播稿，进入工程后请在顶栏进度条上从「文本结构化」起依次点击开始；任一步失败后会自动改为手动模式。
              </p> */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setPipelineRunMode('auto')}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${
                    pipelineRunMode === 'auto'
                      ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(168,85,247,0.45)]'
                      : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  自动执行
                </button>
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setPipelineRunMode('manual')}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${
                    pipelineRunMode === 'manual'
                      ? 'border-amber-500/50 bg-amber-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(245,158,11,0.35)]'
                      : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                  }`}
                >
                  手动逐步
                </button>
              </div>
            </div>

            {createError ? (
              <p
                role="alert"
                className="relative rounded-lg border border-red-500/35 bg-red-950/25 px-3 py-2 text-sm text-red-200/95"
              >
                {createError}
              </p>
            ) : null}

            <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500 sm:max-w-md">
                {pipelineRunMode === 'auto'
                  ? '创建后将进入工程页；后台在「文案结构化」与「演示母版」风格生成阶段并行推进，随后再自动并行配音与演示页。首页与顶栏进度条会随轮询更新。'
                  : '创建后将进入工程页；口播稿不会自动生成，请在顶栏进度条点击「文本结构化」开始，再按需开始配音与演示。'}
              </p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <button
                  type="button"
                  disabled={creating}
                  onClick={resetCreateForm}
                  className="order-2 flex w-full items-center justify-center rounded-xl border border-zinc-700/90 bg-zinc-900/80 px-6 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 sm:order-1 sm:w-auto"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit || creating}
                  className="sf-home-create-submit order-1 flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-purple-600 px-6 py-3 text-sm font-medium text-white shadow-[0_0_24px_-6px_rgba(168,85,247,0.55)] transition-all hover:bg-purple-500 hover:shadow-[0_0_28px_-4px_rgba(192,132,252,0.45)] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:opacity-80 disabled:shadow-none sm:order-2 sm:w-auto sm:min-w-[148px]"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0" />
                  )}
                  {creating ? '正在创建…' : '创建项目'}
                </button>
              </div>
            </div>
              </form>
            </>
          )}
        </section>

        {currentUserId != null ? (
          <>
        {/* Project List */}
        <section className="space-y-6">
          <h2 className="text-xl font-medium text-zinc-200 light:text-slate-800 flex items-center gap-2">
            <Folder className="w-5 h-5 text-purple-400" />
            最近项目
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentProjects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`bg-zinc-900/40 light:bg-white border rounded-xl p-5 text-left transition-all group flex flex-col gap-4 relative ${
                  project.isShared
                    ? 'border-zinc-800/80 light:border-slate-200 opacity-85 cursor-not-allowed'
                    : 'border-zinc-800/80 light:border-slate-200 hover:border-purple-500/50 hover:bg-zinc-900/80 light:hover:bg-slate-50 cursor-pointer'
                }`}
                onClick={() => {
                  if (project.isShared) return;
                  onSelectProject(project.id);
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-zinc-800/50 light:bg-slate-100 flex items-center justify-center group-hover:bg-purple-500/20 group-hover:text-purple-400 transition-colors text-zinc-400 light:text-slate-500">
                    <Video className="w-5 h-5" />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <SfTag tone={projectPipelineTagTone(project)} size="xs">
                      {pipelineStatusLabel(project)}
                    </SfTag>
                    {project.isShared ? (
                      <SfTag
                        tone="amber"
                        size="xs"
                        className="sf-chip-locked gap-1"
                        title="已上传云，需先设为私有才能打开"
                      >
                        <Lock className="h-3 w-3" />
                        已锁定
                      </SfTag>
                    ) : null}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setManagingProjectId((prev) => (prev === project.id ? null : project.id));
                        }}
                        className="rounded-md bg-zinc-800 light:bg-slate-100 p-1.5 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-700 light:hover:bg-slate-200 hover:text-zinc-200 light:hover:text-slate-800"
                        title="管理"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                      {managingProjectId === project.id ? (
                        <div
                          className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-lg border border-zinc-700 light:border-slate-200 bg-zinc-900/95 light:bg-white shadow-xl backdrop-blur"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-50"
                            onClick={() => {
                              setRenameDialog({ id: project.id, currentName: project.name });
                              setRenameValue(project.name);
                              setManagingProjectId(null);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            修改项目名
                          </button>
                          <button
                            type="button"
                            disabled={copyingProjectId === project.id}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-50"
                            onClick={() => {
                              void handleCopy(project.id);
                            }}
                          >
                            {copyingProjectId === project.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                            {copyingProjectId === project.id ? '复制中…' : '复制项目'}
                          </button>
                          {project.pipeline?.video ? (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-50"
                              onClick={() => {
                                void withManage(async () => onDownloadProject(project.id));
                              }}
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载视频
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-50"
                            onClick={() => {
                              void withManage(async () => {
                                if (project.isShared) {
                                  await onToggleShare(project.id, false);
                                } else {
                                  await onUploadProject(project.id);
                                }
                              });
                            }}
                          >
                            <Cloud className="h-3.5 w-3.5" />
                            {project.isShared ? '设为私有' : '上传云'}
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-300 light:text-red-700 transition-colors hover:bg-red-950/40 light:hover:bg-red-50"
                            onClick={() => {
                              setDeleteDialog({ id: project.id, name: project.name });
                              setManagingProjectId(null);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除项目
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-base font-medium text-zinc-200 light:text-slate-800 group-hover:text-white light:group-hover:text-slate-900 transition-colors truncate">{project.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-2 text-xs text-zinc-500 light:text-slate-500">
                    <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {project.screenSize}</span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 sf-bg-card max-sm:hidden" />
                    <span className="flex items-center gap-1"><LayoutTemplate className="w-3 h-3" /> {project.style}</span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 sf-bg-card max-sm:hidden" />
                    <DeckMasterBadge project={project} />
                  </div>
                  {project.isShared ? (
                    <p className="mt-2 text-[11px] text-amber-200/90 light:text-amber-800">
                      已上传云，防止并发冲突，禁止编辑，设为私有可编辑。
                    </p>
                  ) : null}
                </div>
                <div className="mt-auto flex items-center gap-1 text-xs font-mono text-zinc-500 light:text-slate-500">
                  <Clock className="h-3 w-3" />
                  {project.lastModified}
                </div>
              </motion.div>
            ))}
            
            {recentProjects.length === 0 && (
              <div className="col-span-full py-12 text-center text-zinc-500 light:text-slate-500 border border-dashed border-zinc-800 light:border-slate-300 rounded-xl">
                没有找到项目。创建一个项目以开始。
              </div>
            )}
          </div>
        </section>

        {/* Cloud Sharing Directory */}
        <section className="space-y-6">
          <h2 className="text-xl font-medium text-zinc-200 light:text-slate-800 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-blue-400" />
            云共享
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sharedProjects.map((project, i) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/40 light:bg-white border border-zinc-800/80 light:border-slate-200 hover:border-blue-500/50 hover:bg-zinc-900/80 light:hover:bg-slate-50 rounded-xl p-5 text-left transition-all group flex flex-col gap-4 relative shadow-sm light:shadow-slate-200/40"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-zinc-800/50 light:bg-slate-100 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:text-blue-400 transition-colors text-zinc-400 light:text-slate-500">
                    <Video className="w-5 h-5" />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <SfTag tone={projectPipelineTagTone(project)} size="xs">
                      {pipelineStatusLabel(project)}
                    </SfTag>
                    <button
                      type="button"
                      disabled={copyingProjectId === project.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCopy(project.id);
                      }}
                      className="rounded-md bg-zinc-800 light:bg-slate-100 p-1.5 text-zinc-400 light:text-slate-500 transition-colors hover:bg-zinc-700 light:hover:bg-slate-200 hover:text-zinc-200 light:hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      title="复制到我的项目"
                    >
                      {copyingProjectId === project.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-base font-medium text-zinc-200 light:text-slate-800 group-hover:text-white light:group-hover:text-slate-900 transition-colors truncate">{project.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-2 text-xs text-zinc-500 light:text-slate-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" /> {project.author || 'Unknown'}
                    </span>
                    {currentUserId != null &&
                    project.ownerUserId != null &&
                    project.ownerUserId === currentUserId ? (
                      <SfTag tone="amber" size="xs" className="sf-chip-locked px-1.5 text-[10px]">
                        我上传
                      </SfTag>
                    ) : null}
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 sf-bg-card max-sm:hidden" />
                    <span className="flex items-center gap-1">
                      <Monitor className="w-3 h-3" /> {project.screenSize}
                    </span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 sf-bg-card max-sm:hidden" />
                    <span className="flex items-center gap-1">
                      <LayoutTemplate className="w-3 h-3" /> {project.style}
                    </span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 sf-bg-card max-sm:hidden" />
                    <DeckMasterBadge project={project} />
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1 text-xs font-mono text-zinc-500 light:text-slate-500">
                  <Clock className="h-3 w-3" />
                  {project.lastModified}
                </div>
                {/* <button
                  type="button"
                  onClick={() => {
                    void withManage(async () => onCopyProject(project.id));
                  }}
                  className="mt-1 inline-flex w-fit items-center gap-2 rounded-lg border border-blue-500/35 bg-blue-950/25 px-3 py-1.5 text-xs text-blue-100 transition-colors hover:bg-blue-900/35"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制到我的项目后打开
                </button> */}
              </motion.div>
            ))}
            
            {sharedProjects.length === 0 && (
              <div className="col-span-full py-12 text-center text-zinc-500 light:text-slate-500 border border-dashed border-zinc-800 light:border-slate-300 rounded-xl">
                暂无已上传云的项目。将项目「上传云」后（含你自己上传的），会出现在此处；他人共享的也会列出作者用户名。
              </div>
            )}
          </div>
        </section>
          </>
        ) : null}

      </div>
      {renameDialog ? (
        <div className="sf-modal-backdrop-medium fixed inset-0 z-40 flex items-center justify-center bg-black/60 light:bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 light:border-slate-200 bg-zinc-900 light:bg-white p-4 shadow-2xl">
            <h3 className="text-sm font-medium text-zinc-100 light:text-slate-900">修改项目名</h3>
            <p className="mt-1 text-xs text-zinc-400 light:text-slate-600">仅修改展示名称，不影响已生成内容。</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const next = renameValue.trim();
                  if (!next || next === renameDialog.currentName) {
                    setRenameDialog(null);
                    return;
                  }
                  void withManage(async () => onRenameProject(renameDialog.id, next));
                  setRenameDialog(null);
                }
              }}
              className="mt-3 w-full rounded-lg border border-zinc-700 light:border-slate-200 bg-zinc-950 light:bg-slate-50 px-3 py-2 text-sm text-zinc-100 light:text-slate-900 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              placeholder="输入新的项目名"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameDialog(null)}
                className="rounded-lg border border-zinc-700 light:border-slate-200 px-3 py-1.5 text-xs text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = renameValue.trim();
                  if (!next || next === renameDialog.currentName) {
                    setRenameDialog(null);
                    return;
                  }
                  void withManage(async () => onRenameProject(renameDialog.id, next));
                  setRenameDialog(null);
                }}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-purple-500"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteDialog ? (
        <div className="sf-modal-backdrop-medium fixed inset-0 z-40 flex items-center justify-center bg-black/60 light:bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/25 light:border-red-300/50 bg-zinc-900 light:bg-white p-4 shadow-2xl">
            <h3 className="text-sm font-medium text-red-200 light:text-red-700">确认删除项目</h3>
            <p className="mt-2 text-sm text-zinc-300 light:text-slate-700">
              确认删除项目「{deleteDialog.name}」？此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded-lg border border-zinc-700 light:border-slate-200 px-3 py-1.5 text-xs text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void withManage(async () => onDeleteProject(deleteDialog.id));
                  setDeleteDialog(null);
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-500"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
