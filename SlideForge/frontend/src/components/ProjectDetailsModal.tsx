import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Loader2,
  Info,
  FileText,
  Palette,
  Activity,
  Cpu,
  Layers,
  Copy,
  Check,
} from 'lucide-react';
import { apiFetch } from '../api';
import {
  type OutlineNodeApi,
  buildNarrationPlainText,
  outlineToPages,
  scriptPagesHaveBrief,
} from '../utils/outlineScriptPages';

/** 与 GET /api/projects/:id 对齐（project + 顶层摘要） */
export type ProjectFullDetailApi = {
  latest_export_url?: string | null;
  video_exported_at?: string | null;
  /** 影响成片内容的素材最近变更时间（晚于导出则需重导） */
  video_source_updated_at?: string | null;
  pipeline: { outline: boolean; audio: boolean; deck: boolean; video: boolean };
  workflow: Record<string, unknown> | null;
  project: {
    id: number;
    name: string;
    owner_user_id: number;
    is_shared: boolean;
    description?: string | null;
    deck_master_source_project_id?: number | null;
    include_intro?: boolean;
    intro_style_id?: number | null;
    include_outro?: boolean;
    /** 后端字段名 */
    target_narration_seconds?: number | null;
    pipeline_auto_advance?: boolean;
    text_structure_mode?: string | null;
    manual_outline_confirmed?: boolean;
    tts_voice_type?: string | null;
    tts_voice_effective?: string | null;
    input_prompt?: string | null;
    status: string;
    deck_status?: string | null;
    deck_error?: string | null;
    deck_style_preset?: string;
    deck_style_user_hint?: string;
    deck_style_prompt_text?: string;
    deck_page_size?: string;
    deck_style_ready?: boolean;
    deck_style_version?: number;
    deck_style_theme_name?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  slides?: unknown[];
  outline?: unknown[];
};

/** 与 backend `app.services.project_meta` 一致 */
const PROJECT_META_MARKER = '__sfmeta:';
const DECK_MASTER_SRC_MARKER = '__sf_deck_src:';

const DECK_STYLE_LABELS: Record<string, string> = {
  none: '未选预设（占位）',
  aurora_glass: '极光玻璃',
  minimal_tech: '极简科技',
  dark_neon: '温暖治愈',
  material_design: 'Material 质感',
  flat_illustration: '扁平插画风',
  editorial_luxury: '杂志高级感',
  futuristic_hud: '未来 HUD',
};

type TabId = 'overview' | 'prompt_input' | 'prompt_config' | 'prompt_script' | 'style' | 'status' | 'workflow' | 'resources';

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number' && !Number.isFinite(v)) return '—';
  const s = String(v).trim();
  return s || '—';
}

function countOutlineNodes(nodes: unknown): number {
  if (!Array.isArray(nodes)) return 0;
  let n = 0;
  for (const node of nodes) {
    n += 1;
    if (node && typeof node === 'object' && 'children' in node) {
      n += countOutlineNodes((node as { children?: unknown }).children);
    }
  }
  return n;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide sf-text-muted">{title}</h3>
      <div className="divide-y divide-[var(--sf-border-base)] rounded-xl border sf-border-base sf-bg-card">
        {children}
      </div>
    </section>
  );
}

function CopyTextButton({
  text,
  label = '复制',
  iconOnly = true,
}: {
  text: string;
  /** 按钮文案，成功时仍显示「已复制」 */
  label?: string;
  /** 仅显示图标（默认）；需要解释语义时可显示文案 */
  iconOnly?: boolean;
}) {
  const [ok, setOk] = useState(false);
  const disabled = !text.trim();
  const onClick = async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      window.setTimeout(() => setOk(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`sf-chip-neutral inline-flex shrink-0 items-center rounded-md border text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
        iconOnly ? 'h-7 w-7 justify-center p-0' : 'gap-1 px-2 py-1'
      }`}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
      {!iconOnly ? (ok ? '已复制' : label) : null}
    </button>
  );
}

function Row({
  label,
  value,
  copyText,
}: {
  label: ReactNode;
  value: ReactNode;
  copyText?: string;
}) {
  const showCopy = copyText != null && copyText.trim() !== '';
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="shrink-0 text-[13px] sf-text-muted sm:w-44">{label}</div>
      <div className="relative min-w-0 flex-1">
        {showCopy ? (
          <div className="absolute right-0 top-0">
            <CopyTextButton text={copyText!} />
          </div>
        ) : null}
        <div className={`break-words text-[13px] sf-text-primary ${showCopy ? 'pr-9' : ''}`}>{value}</div>
      </div>
    </div>
  );
}

/** `projects.description` 仅存内部标记，不是用户写的「项目简介」；主题正文在 input_prompt。 */
function renderDescriptionColumn(raw: string | null): ReactNode {
  if (!raw?.trim()) return <span className="sf-text-muted">—</span>;
  const t = raw.trim();
  if (t.startsWith(PROJECT_META_MARKER)) {
    const tail = t.slice(PROJECT_META_MARKER.length).trim();
    try {
      const obj = JSON.parse(tail) as unknown;
      return (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed sf-text-muted">
            数据库 <code className="sf-text-secondary">description</code> 列中的{' '}
            <code className="sf-text-secondary">__sfmeta:</code> JSON，与下方「母版与导出选项」一致；与口播主题（
            <code className="sf-text-secondary">input_prompt</code>）无关。
          </p>
          <pre className="sf-code-block max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border p-3 font-mono text-[12px] leading-relaxed">
            {JSON.stringify(obj, null, 2)}
          </pre>
        </div>
      );
    } catch {
      return <LongText text={raw} />;
    }
  }
  if (t.startsWith(DECK_MASTER_SRC_MARKER)) {
    const id = t.slice(DECK_MASTER_SRC_MARKER.length).trim();
    return (
      <p className="text-[13px] sf-text-primary">
        旧版母版来源标记，源项目 ID：<code className="text-emerald-400/90">{id || '—'}</code>
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-amber-500/90">非标准格式，可能为历史数据；仍非主题口播正文。</p>
      <LongText text={raw} />
    </div>
  );
}

function LongText({ text }: { text: string }) {
  if (!text.trim()) return <span className="sf-text-muted">—</span>;
  return (
    <pre className="sf-code-block max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-[12px] leading-relaxed">
      {text}
    </pre>
  );
}

/** 与 ManualWorkflowDialogs 口播分段布局一致，只读；outline 来自 GET /api/projects/:id */
function NarrationScriptColumn({ outline }: { outline: unknown[] }) {
  const [showBrief, setShowBrief] = useState(false);
  const pages = useMemo(() => {
    if (!Array.isArray(outline)) return [];
    return outlineToPages(outline as OutlineNodeApi[]);
  }, [outline]);
  const plainNoBrief = useMemo(() => buildNarrationPlainText(pages, false), [pages]);
  const plainWithBrief = useMemo(() => buildNarrationPlainText(pages, true), [pages]);
  const hasBrief = useMemo(() => scriptPagesHaveBrief(pages), [pages]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:max-h-[min(64vh,560px)]">
      <div className="mb-3 flex shrink-0 flex-col gap-2 border-b border-[var(--sf-border-base)] pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-lg font-semibold sf-text-primary">口播台词</h4>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs sf-text-secondary">
            <input
              type="checkbox"
              checked={showBrief}
              onChange={(e) => setShowBrief(e.target.checked)}
              className="h-3.5 w-3.5 appearance-none rounded border border-[var(--sf-input-border)] bg-[var(--sf-input-bg)] checked:border-purple-500 checked:bg-purple-500 text-purple-500 focus:ring-purple-500/40"
            />
            显示概括
          </label>
          <CopyTextButton text={plainNoBrief} label="复制口播全文" iconOnly={false} />
          {hasBrief ? <CopyTextButton text={plainWithBrief} label="复制（含概括）" iconOnly={false} /> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {pages.length === 0 ? (
          <p className="text-sm sf-text-muted">暂无 page/step 口播结构（可能尚未结构化或大纲为空）。</p>
        ) : (
          pages.map((pg, pi) => (
            <div
              key={pg.page_node_id}
              className="sf-nested-surface space-y-3 rounded-xl border p-3"
            >
              <div className="text-xs font-medium sf-text-muted">大标题 {pi + 1}</div>
              <div className="sf-nested-surface-strong rounded-lg border px-3 py-2 text-sm font-medium sf-text-primary">
                {pg.main_title.trim() || '（未命名大标题）'}
              </div>
              {pg.segments.map((s) => (
                <div
                  key={s.step_node_id}
                  className="ml-0 space-y-2 border-l-2 border-purple-500/30 pl-3 sm:ml-2"
                >
                  <div className="text-xs sf-text-muted">小标题</div>
                  <div className="sf-nested-surface-muted rounded-lg border px-3 py-2 text-sm sf-text-primary">
                    {s.subtitle.trim() || '—'}
                  </div>
                  <div className="text-xs sf-text-muted">口播正文</div>
                  <div className="sf-nested-surface-muted whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm leading-relaxed sf-text-primary">
                    {s.narration_text.trim() || '—'}
                  </div>
                  {showBrief ? (
                    <>
                      <div className="text-xs sf-text-muted">概括（可选）</div>
                      <div className="whitespace-pre-wrap rounded-lg border border-[var(--sf-border-base)] bg-[var(--sf-nested-surface-muted)] px-3 py-2 text-sm leading-relaxed sf-text-secondary">
                        {(s.narration_brief || '').trim() || '—'}
                      </div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export interface ProjectDetailsModalProps {
  open: boolean;
  onClose: () => void;
  projectId: number | null;
}

const TABS: { id: TabId; label: string; icon: typeof Info }[] = [
  { id: 'overview', label: '项目概览', icon: Info },
  { id: 'prompt_input', label: '主题素材', icon: FileText },
  { id: 'prompt_config', label: '生成配置', icon: FileText },
  { id: 'prompt_script', label: '口播台词', icon: FileText },
  { id: 'style', label: '演示与样式', icon: Palette },
  { id: 'status', label: '状态与成片', icon: Activity },
  { id: 'workflow', label: '工作流引擎', icon: Cpu },
  { id: 'resources', label: '资源与结构', icon: Layers },
];

export function ProjectDetailsModal({ open, onClose, projectId }: ProjectDetailsModalProps) {
  const [data, setData] = useState<ProjectFullDetailApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const load = useCallback(async () => {
    if (projectId == null || !Number.isFinite(projectId)) return;
    setLoading(true);
    setError(null);
    try {
      const json = await apiFetch<ProjectFullDetailApi>(`/api/projects/${projectId}`);
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open || projectId == null) return;
    void load();
  }, [open, projectId, load]);

  useEffect(() => {
    if (open) setActiveTab('overview');
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const p = data?.project;
  const wf = data?.workflow;
  const workflowEntries = wf
    ? Object.entries(wf).sort(([a], [b]) => a.localeCompare(b))
    : [];

  const presetLabel = p
    ? DECK_STYLE_LABELS[p.deck_style_preset ?? ''] ?? p.deck_style_preset ?? ''
    : '';

  function renderTabContent() {
    if (!p || !data) return null;
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            <Section title="基本信息">
              <Row label="项目 ID" value={String(p.id)} />
              <Row label="名称" value={p.name} />
              <Row label="拥有者用户 ID" value={String(p.owner_user_id)} />
              <Row label="共享给所有用户可编辑" value={formatValue(p.is_shared)} />
              <Row
                label={
                  <div>
                    <div>服务端元数据</div>
                    <div className="mt-0.5 text-[11px] font-normal sf-text-muted">
                      projects.description
                    </div>
                  </div>
                }
                value={renderDescriptionColumn(p.description)}
                copyText={p.description ?? ''}
              />
              <Row label="创建时间" value={formatValue(p.created_at)} />
              <Row label="更新时间" value={formatValue(p.updated_at)} />
            </Section>
            <Section title="母版与导出选项">
              <Row
                label="演示母版来源项目 ID"
                value={
                  p.deck_master_source_project_id != null
                    ? String(p.deck_master_source_project_id)
                    : '—'
                }
              />
              {/* 片头/片尾暂不在详情中展示；后端仍可在 description __sfmeta 中保留 */}
              {/* <Row label="导出含片头" value={formatValue(p.include_intro)} /> */}
              {/* <Row label="片头样式 ID" value={formatValue(p.intro_style_id)} /> */}
              {/* <Row label="导出含片尾" value={formatValue(p.include_outro)} /> */}
            </Section>
          </div>
        );
      case 'prompt_input':
        return (
          <div className="space-y-6">
            <Section title="主题素材（input_prompt）">
              <div className="px-3 py-2.5">
                <LongText text={p.input_prompt ?? ''} />
              </div>
            </Section>
          </div>
        );
      case 'prompt_config':
        return (
          <div className="space-y-6">
            <Section title="主题与生成配置">
              <Row
                label="口播目标体量（秒）"
                value={
                  p.target_narration_seconds != null
                    ? String(p.target_narration_seconds)
                    : '—'
                }
              />
              <Row label="文本结构化模式" value={formatValue(p.text_structure_mode)} />
              <Row label="手动流程已确认口播分段" value={formatValue(p.manual_outline_confirmed)} />
              <Row label="文案成功后自动跑后续步骤" value={formatValue(p.pipeline_auto_advance)} />
              <Row label="TTS 音色（项目覆盖）" value={formatValue(p.tts_voice_type)} />
              <Row label="实际生效音色" value={formatValue(p.tts_voice_effective)} />
            </Section>
          </div>
        );
      case 'prompt_script':
        return (
          <div className="min-h-0 min-w-0 rounded-xl border border-[var(--sf-border-base)] bg-[var(--sf-nested-surface-muted)] p-4">
            <div className="min-h-0 lg:max-h-[min(64vh,560px)]">
              <NarrationScriptColumn outline={data.outline ?? []} />
            </div>
          </div>
        );
      case 'style': {
        const styleBundle = [
          `页面尺寸: ${p.deck_page_size}`,
          `风格预设: ${presetLabel} (${p.deck_style_preset})`,
          `用户风格提示词:\n${p.deck_style_user_hint || ''}`,
          `AI 风格说明（摘要）:\n${p.deck_style_prompt_text || ''}`,
          `样式包已就绪: ${formatValue(p.deck_style_ready)}`,
          `样式版本: ${p.deck_style_version}`,
          `主题名称: ${p.deck_style_theme_name ?? '—'}`,
        ].join('\n\n');
        return (
          <div className="space-y-6">
            <div className="flex justify-end">
              <CopyTextButton text={styleBundle} label="复制本页全部" />
            </div>
            <Section title="演示与样式">
              <Row label="页面尺寸" value={formatValue(p.deck_page_size)} copyText={p.deck_page_size} />
              <Row
                label="风格预设"
                value={`${presetLabel}（${p.deck_style_preset}）`}
                copyText={`${presetLabel} (${p.deck_style_preset})`}
              />
              <Row
                label="风格预设 slug"
                value={formatValue(p.deck_style_preset)}
                copyText={p.deck_style_preset}
              />
              <Row
                label="用户风格提示词"
                value={<LongText text={p.deck_style_user_hint ?? ''} />}
                copyText={p.deck_style_user_hint ?? ''}
              />
              <Row
                label="AI 风格说明（摘要）"
                value={<LongText text={p.deck_style_prompt_text ?? ''} />}
                copyText={p.deck_style_prompt_text ?? ''}
              />
              <Row
                label="样式包已就绪"
                value={formatValue(p.deck_style_ready)}
                copyText={p.deck_style_ready ? '是' : '否'}
              />
              <Row
                label="样式版本"
                value={String(p.deck_style_version)}
                copyText={String(p.deck_style_version)}
              />
              <Row
                label="主题名称"
                value={formatValue(p.deck_style_theme_name)}
                copyText={
                  (p.deck_style_theme_name ?? '').trim()
                    ? (p.deck_style_theme_name as string).trim()
                    : undefined
                }
              />
            </Section>
          </div>
        );
      }
      case 'status':
        return (
          <div className="space-y-6">
            <Section title="运行状态">
              <Row label="项目 status" value={formatValue(p.status)} />
              <Row label="演示 deck_status" value={formatValue(p.deck_status)} />
              <Row
                label="演示错误 deck_error"
                value={
                  p.deck_error?.trim() ? <LongText text={p.deck_error} /> : '—'
                }
              />
            </Section>
            <Section title="流水线里程碑（pipeline）">
              <Row label="文案已写入大纲" value={formatValue(data.pipeline.outline)} />
              <Row label="配音完成" value={formatValue(data.pipeline.audio)} />
              <Row label="演示页就绪" value={formatValue(data.pipeline.deck)} />
              <Row label="已成功导出成片" value={formatValue(data.pipeline.video)} />
            </Section>
            <Section title="成片与导出链接">
              <Row label="最近导出成功时间" value={formatValue(data.video_exported_at)} />
              <Row
                label="内容素材最近变更时间"
                value={formatValue(data.video_source_updated_at ?? null)}
              />
              <Row
                label="latest_export_url"
                value={
                  data.latest_export_url ? (
                    <code className="break-all text-[12px] text-emerald-400/90">
                      {data.latest_export_url}
                    </code>
                  ) : (
                    '—'
                  )
                }
              />
            </Section>
          </div>
        );
      case 'workflow':
        return (
          <div className="space-y-6">
            <Section title="工作流引擎（workflow）">
              {workflowEntries.length === 0 ? (
                <Row label="—" value="无数据" />
              ) : (
                workflowEntries.map(([k, v]) => (
                  <Fragment key={k}>
                    <Row
                      label={k}
                      value={
                        v === null || v === undefined ? (
                          '—'
                        ) : typeof v === 'object' ? (
                          <pre className="sf-code-block max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border p-2 text-[11px]">
                            {JSON.stringify(v, null, 2)}
                          </pre>
                        ) : (
                          String(v)
                        )
                      }
                    />
                  </Fragment>
                ))
              )}
            </Section>
          </div>
        );
      case 'resources':
        return (
          <div className="space-y-6">
            <Section title="资源与结构">
              <Row label="幻灯片（playlist）条数" value={String(data.slides?.length ?? 0)} />
              <Row label="大纲树节点总数" value={String(countOutlineNodes(data.outline))} />
            </Section>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="sf-modal-backdrop-medium absolute inset-0 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-details-title"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="sf-dialog-shell relative flex h-[80vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sf-modal-header-bar flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h2 id="project-details-title" className="truncate text-lg font-semibold sf-text-primary">
                项目详情{p ? `：${p.name}` : ''}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              <div className="sf-modal-sidebar flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r p-4">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const disabled = loading || !!error || !data;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && setActiveTab(tab.id)}
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                        disabled
                          ? 'cursor-not-allowed border-transparent sf-text-muted opacity-50'
                          : isActive
                            ? 'border-purple-500/30 bg-purple-500/10 text-purple-300 light:border-violet-200 light:bg-violet-50 light:text-violet-700'
                            : 'border-transparent sf-text-secondary hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="sf-modal-content-scroll min-w-0 flex-1 overflow-y-auto p-8">
                {loading && (
                  <div className="flex items-center justify-center gap-2 py-16 sf-text-secondary">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">加载中…</span>
                  </div>
                )}
                {!loading && error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200 light:bg-red-50 light:text-red-800">
                    {error}
                  </p>
                )}
                {!loading && !error && data && p && (
                  <div
                    className={
                      activeTab === 'prompt_script'
                        ? 'w-full max-w-none'
                        : 'max-w-2xl space-y-4'
                    }
                  >
                    {activeTab !== 'prompt_script' ? (
                      <h3 className="text-xl font-medium sf-text-primary">
                        {TABS.find((t) => t.id === activeTab)?.label}
                      </h3>
                    ) : null}
                    {renderTabContent()}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
