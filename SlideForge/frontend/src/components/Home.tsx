import React, { useState } from 'react';
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
  Sparkles,
  Copy,
  Trash2,
  Pencil,
  MoreVertical,
  Download,
  ChevronDown,
} from 'lucide-react';
import { WorkflowStep } from './WorkflowProgressBar';
import type { ServerWorkflow } from '../utils/workflowFromPipeline';
import type { VideoExportJobInfo } from './ExportVideoStatusDialog';
import { APP_BRAND } from '../brand';

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
}

/** 提交创建表单时传入；母版源与列表字段 deckMasterSourceProjectId 不同 */
export type CreateProjectInput = Omit<
  Project,
  'id' | 'lastModified' | 'workflowSteps' | 'deckMasterSourceProjectId' | 'serverWorkflow'
> & {
  copyDeckMasterFromProjectId?: number | null;
  /** 对应后端 `project_styles.user_style_hint` / 创建接口 `deck_style_user_hint` */
  userStyleHint?: string;
};

function pipelineStatusLabel(project: Project): string {
  const st = (project.serverStatus || '').toLowerCase();
  const ds = (project.deckStatus || 'idle').toLowerCase();
  const pl = project.pipeline;
  if (st === 'failed') return '失败';
  if (st === 'queued') return '加载中';
  if (st === 'structuring') return '文本结构化';
  if (st === 'synthesizing') return '配音中';
  if (pl?.video) return '可下载';
  if (pl?.audio && pl?.deck) return '需导出';
  if (pl?.audio && (ds === 'generating' || !pl?.deck)) return '演示页生成中';
  if (pl?.audio) return '待演示页';
  if (pl?.outline) return '待配音';
  return '处理中';
}

function pipelineStatusClass(project: Project): string {
  const st = (project.serverStatus || '').toLowerCase();
  const pl = project.pipeline;
  if (st === 'failed') return 'border-red-500/35 bg-red-950/40 text-red-200';
  if (pl?.video) return 'border-emerald-500/40 bg-emerald-950/35 text-emerald-100';
  if (pl?.audio && pl?.deck) return 'border-blue-500/35 bg-blue-950/25 text-blue-100';
  if (st === 'queued') {
    return 'border-cyan-500/40 bg-cyan-950/30 text-cyan-100';
  }
  if (st === 'structuring' || st === 'synthesizing') {
    return 'border-amber-500/35 bg-amber-950/25 text-amber-100';
  }
  return 'border-zinc-600/50 bg-zinc-800/60 text-zinc-300';
}

const ASPECT_PRESETS = [
  { value: '16:9', title: '16:9', hint: '横屏' },
  { value: '4:3', title: '4:3', hint: '标准' },
  { value: '9:16', title: '9:16', hint: '竖屏' },
  { value: '1:1', title: '1:1', hint: '方形' },
] as const;

/** 与 backend `DECK_STYLE_PRESET_ORDER` / `DECK_STYLE_PRESETS` 一致；暂不展示用户自定义风格描述 */
const STYLE_PRESETS = [
  { value: 'aurora_glass', title: '极光玻璃', subtitle: '' },
  { value: 'minimal_tech', title: '极简科技', subtitle: '' },
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
    <span
      className={
        reused
          ? 'inline-flex shrink-0 items-center rounded-md border border-violet-500/50 bg-violet-950/50 px-2 py-0.5 font-mono text-[11px] tabular-nums leading-none text-violet-100'
          : 'inline-flex shrink-0 items-center rounded-md border border-zinc-600/70 bg-zinc-900/70 px-2 py-0.5 font-mono text-[11px] tabular-nums leading-none text-zinc-300'
      }
      title={reused ? `演示母版复用自项目 ${no}` : `本项目演示母版（项目 ID ${no}）`}
    >
      母版{no}
    </span>
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
  const [selectedStyle, setSelectedStyle] = useState<(typeof STYLE_PRESETS)[number]['value']>(
    'aurora_glass',
  );
  /** 复用已有项目的演示母版：填源项目数字 id，留空则走 AI 生成母版 */
  const [deckMasterSourceRaw, setDeckMasterSourceRaw] = useState('');
  const [styleHintOpen, setStyleHintOpen] = useState(false);
  const [userStyleHint, setUserStyleHint] = useState('');
  const [prompt, setPrompt] = useState('');
  const [creating, setCreating] = useState(false);
  const [managingProjectId, setManagingProjectId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [copyingProjectId, setCopyingProjectId] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ id: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);

  const parsedCopyMasterId = (() => {
    const t = deckMasterSourceRaw.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();
  const copyMasterInvalid =
    Boolean(deckMasterSourceRaw.trim()) && parsedCopyMasterId === null;
  const canSubmit =
    Boolean(newProjectName.trim()) &&
    Boolean(prompt.trim()) &&
    !copyMasterInvalid;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || creating) return;
    setCreating(true);
    try {
      await onCreateProject({
        name: newProjectName.trim(),
        screenSize: selectedSize,
        style: selectedStyle,
        prompt: prompt.trim(),
        copyDeckMasterFromProjectId: parsedCopyMasterId,
        userStyleHint: userStyleHint.trim() || undefined,
      });
      setNewProjectName('');
      setPrompt('');
      setDeckMasterSourceRaw('');
      setUserStyleHint('');
      setStyleHintOpen(false);
    } catch {
      /* 错误已由 App 写入 createError */
    } finally {
      setCreating(false);
    }
  };

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
    <div className="flex-1 bg-zinc-950 light:bg-slate-50 text-zinc-100 light:text-slate-900 overflow-y-auto p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        
        {/* Header & Create Form */}
        <section className="space-y-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 light:text-slate-900">{APP_BRAND}</h1>
            <p className="text-zinc-400 light:text-slate-500 mt-2">创建和管理你的视频工程项目。</p>
          </div>
          {currentUserId == null ? (
            <div className="rounded-2xl border border-zinc-800/80 light:border-slate-200 bg-zinc-900/40 light:bg-white px-6 py-14 text-center">
              <p className="text-sm text-zinc-300 light:text-slate-700">
                请先登录后再使用创建项目、编辑工程与云共享等功能。
              </p>
              <p className="mt-3 text-xs text-zinc-500 light:text-slate-400">点击右上角「Login」登录或注册账号。</p>
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
            className="relative overflow-hidden rounded-2xl border border-zinc-800/80 light:border-slate-200 bg-gradient-to-b from-zinc-900/80 to-zinc-950/90 light:from-white light:to-slate-50/90 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] light:shadow-slate-200/60 light:shadow-sm flex flex-col gap-6"
          >
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-purple-600/10 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-violet-500/5 blur-3xl"
              aria-hidden
            />

            <div className="relative space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
                <Type className="h-3.5 w-3.5 text-purple-400/90" />
                项目名称
                {/* <span className="text-xs font-normal text-zinc-500">
                  （必填，仅列表展示，不参与大纲生成）
                </span> */}
              </label>
              <input
                type="text"
                required
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="例如：产品发布会"
                className="w-full rounded-xl border border-zinc-800/90 light:border-slate-200 bg-zinc-950/80 light:bg-white px-4 py-3 text-sm text-zinc-100 light:text-slate-900 shadow-inner placeholder:text-zinc-600 light:placeholder:text-slate-400 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-[border-color,box-shadow]"
              />
            </div>

            <div className="relative space-y-6">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
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
                            ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 light:text-slate-900 shadow-[0_0_20px_-8px_rgba(168,85,247,0.5)]'
                            : 'border-zinc-800/90 light:border-slate-200 bg-zinc-950/50 light:bg-white text-zinc-400 light:text-slate-500 hover:border-zinc-700 light:hover:border-slate-300 hover:bg-zinc-900/60 light:hover:bg-slate-50 hover:text-zinc-200 light:hover:text-slate-700'
                        }`}
                      >
                        <span className="block font-medium tabular-nums">{opt.title}</span>
                        <span className="block text-xs text-zinc-500 light:text-slate-400">{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
                  <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-purple-400/90" />
                  <span>演示风格</span>
                </div>
                <div
                  role="group"
                  aria-label="复用母版与演示风格"
                  className="flex flex-row flex-wrap items-center gap-2"
                >
                  <div className="flex min-w-0 items-center gap-2 px-1">
                    <span className="shrink-0 text-sm text-zinc-400 light:text-slate-600">复用母版：</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="填 ID"
                      value={deckMasterSourceRaw}
                      onChange={(e) => setDeckMasterSourceRaw(e.target.value.replace(/\s+/g, ''))}
                      disabled={creating}
                      className="h-9 w-[6.5rem] shrink-0 rounded-lg border border-zinc-700/80 light:border-slate-200 bg-zinc-950/90 light:bg-white px-2.5 font-mono text-sm text-zinc-100 light:text-slate-900 placeholder:text-zinc-600 light:placeholder:text-slate-400 focus:border-violet-500/45 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                    />
                  </div>
                  <div className="hidden h-8 w-px shrink-0 bg-zinc-700/70 light:bg-slate-300/70 sm:block" aria-hidden />
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {STYLE_PRESETS.map((opt) => {
                      const on = selectedStyle === opt.value;
                      const lockStyle = parsedCopyMasterId != null;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSelectedStyle(opt.value)}
                          disabled={creating || lockStyle}
                          className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-all disabled:opacity-50 sm:px-3 sm:text-sm ${
                            on
                              ? 'border-purple-500/50 bg-purple-500/15 text-zinc-100 light:text-slate-900 shadow-[0_0_16px_-6px_rgba(168,85,247,0.45)]'
                              : 'border-zinc-700/80 light:border-slate-200 bg-zinc-950/80 light:bg-white text-zinc-400 light:text-slate-500 hover:border-zinc-600 light:hover:border-slate-300 hover:bg-zinc-900/70 light:hover:bg-slate-50 hover:text-zinc-200 light:hover:text-slate-700'
                          }`}
                        >
                          {opt.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {copyMasterInvalid ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    请输入正整数项目 ID，或留空。
                  </p>
                ) : parsedCopyMasterId != null ? (
                  <p className="text-xs text-zinc-500 light:text-slate-400">
                    已填母版源项目 ID，风格以该项目母版为准；右侧预设已禁用。源项目须已有就绪的演示母版。
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500 light:text-slate-400">
                    留空 ID 时由 AI 按所选风格生成母版；填写 ID 则复用该项目的演示母版并跳过风格预设。
                  </p>
                )}
                {parsedCopyMasterId == null ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setStyleHintOpen((o) => !o)}
                      disabled={creating}
                      className="flex w-full items-center gap-1.5 rounded-lg py-1.5 text-left text-xs text-zinc-400 light:text-slate-500 transition-colors hover:text-zinc-200 light:hover:text-slate-700 disabled:opacity-50 sm:text-sm"
                      aria-expanded={styleHintOpen}
                    >
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-zinc-500 light:text-slate-400 transition-transform ${styleHintOpen ? 'rotate-0' : '-rotate-90'}`}
                        aria-hidden
                      />
                      自定义风格（可选）
                    </button>
                    {styleHintOpen ? (
                      <textarea
                        name="user_style_hint"
                        value={userStyleHint}
                        onChange={(e) => setUserStyleHint(e.target.value)}
                        disabled={creating}
                        placeholder="例如：偏冷色科技感、少用渐变、大字报排版、参考苹果发布会…"
                        rows={3}
                        maxLength={4000}
                        className="mt-1 w-full resize-y rounded-xl border border-zinc-800/90 light:border-slate-200 bg-zinc-950/80 light:bg-white px-3 py-2.5 text-sm text-zinc-100 light:text-slate-900 placeholder:text-zinc-600 light:placeholder:text-slate-400 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 light:text-slate-700">
                <Sparkles className="h-3.5 w-3.5 text-amber-400/90" />
                主题与要点
                {/* <span className="text-xs font-normal text-zinc-500">
                  （必填，对应大纲生成的用户素材；模型按播客编辑规则整理为大标题 + 小标题 JSON）
                </span> */}
              </label>
              <textarea
                required
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="粘贴你的口播素材或要点：讲什么、例子、数据、节奏偏好…"
                rows={4}
                className="w-full resize-y min-h-[108px] rounded-xl border border-zinc-800/90 light:border-slate-200 bg-zinc-950/80 light:bg-white px-4 py-3 text-sm text-zinc-100 light:text-slate-900 shadow-inner placeholder:text-zinc-600 light:placeholder:text-slate-400 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-[border-color,box-shadow]"
              />
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
                先创建项目并进入工程页；后台依次执行文本结构化、整稿配音与演示页生成。首页与顶栏进度条会随轮询更新。
              </p>
              <button
                type="submit"
                disabled={!canSubmit || creating}
                className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-purple-600 px-6 py-3 text-sm font-medium text-white shadow-[0_0_24px_-6px_rgba(168,85,247,0.55)] transition-all hover:bg-purple-500 hover:shadow-[0_0_28px_-4px_rgba(192,132,252,0.45)] disabled:cursor-not-allowed disabled:bg-zinc-800 light:disabled:bg-slate-200 disabled:text-zinc-500 light:disabled:text-slate-400 disabled:shadow-none sm:w-auto sm:min-w-[148px]"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0" />
                )}
                {creating ? '正在创建…' : '创建项目'}
              </button>
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
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium leading-tight ${pipelineStatusClass(project)}`}
                    >
                      {pipelineStatusLabel(project)}
                    </span>
                    {project.isShared ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-950/30 px-2 py-0.5 text-[10px] font-medium leading-tight text-amber-100"
                        title="已上传云，需先设为私有才能打开"
                      >
                        <Lock className="h-3 w-3" />
                        已锁定
                      </span>
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
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-950/40"
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
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 light:bg-slate-300 max-sm:hidden" />
                    <span className="flex items-center gap-1"><LayoutTemplate className="w-3 h-3" /> {project.style}</span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 light:bg-slate-300 max-sm:hidden" />
                    <DeckMasterBadge project={project} />
                  </div>
                  {project.isShared ? (
                    <p className="mt-2 text-[11px] text-amber-200/90">
                      已上传云，防止并发冲突，禁止编辑，设为私有可编辑。
                    </p>
                  ) : null}
                </div>
                <div className="mt-auto flex items-center gap-1 text-xs font-mono text-zinc-500">
                  <Clock className="h-3 w-3" />
                  {project.lastModified}
                </div>
              </motion.div>
            ))}
            
            {recentProjects.length === 0 && (
              <div className="col-span-full py-12 text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
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
                className="bg-zinc-900/40 border border-zinc-800/80 hover:border-blue-500/50 hover:bg-zinc-900/80 rounded-xl p-5 text-left transition-all group flex flex-col gap-4 relative"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-lg bg-zinc-800/50 flex items-center justify-center group-hover:bg-blue-500/20 group-hover:text-blue-400 transition-colors">
                    <Video className="w-5 h-5" />
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium leading-tight ${pipelineStatusClass(project)}`}
                    >
                      {pipelineStatusLabel(project)}
                    </span>
                    <button
                      type="button"
                      disabled={copyingProjectId === project.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCopy(project.id);
                      }}
                      className="rounded-md bg-zinc-800 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
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
                  <h3 className="text-base font-medium text-zinc-200 group-hover:text-white transition-colors truncate">{project.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-2 text-xs text-zinc-500">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" /> {project.author || 'Unknown'}
                    </span>
                    {currentUserId != null &&
                    project.ownerUserId != null &&
                    project.ownerUserId === currentUserId ? (
                      <span className="rounded border border-amber-500/35 bg-amber-950/25 px-1.5 py-0.5 text-[10px] font-medium text-amber-100/95">
                        我上传
                      </span>
                    ) : null}
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 max-sm:hidden" />
                    <span className="flex items-center gap-1">
                      <Monitor className="w-3 h-3" /> {project.screenSize}
                    </span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 max-sm:hidden" />
                    <span className="flex items-center gap-1">
                      <LayoutTemplate className="w-3 h-3" /> {project.style}
                    </span>
                    <span className="w-1 h-1 shrink-0 rounded-full bg-zinc-700 max-sm:hidden" />
                    <DeckMasterBadge project={project} />
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-1 text-xs font-mono text-zinc-500">
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
              <div className="col-span-full py-12 text-center text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                暂无已上传云的项目。将项目「上传云」后（含你自己上传的），会出现在此处；他人共享的也会列出作者用户名。
              </div>
            )}
          </div>
        </section>
          </>
        ) : null}

      </div>
      {renameDialog ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <h3 className="text-sm font-medium text-zinc-100">修改项目名</h3>
            <p className="mt-1 text-xs text-zinc-400">仅修改展示名称，不影响已生成内容。</p>
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
              className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
              placeholder="输入新的项目名"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameDialog(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/25 bg-zinc-900 p-4 shadow-2xl">
            <h3 className="text-sm font-medium text-red-200">确认删除项目</h3>
            <p className="mt-2 text-sm text-zinc-300">
              确认删除项目「{deleteDialog.name}」？此操作不可恢复。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteDialog(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
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
