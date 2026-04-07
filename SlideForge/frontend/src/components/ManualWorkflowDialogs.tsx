import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, LayoutTemplate, Loader2, Sparkles, X } from 'lucide-react';
import { ApiError, apiFetch } from '../api';
import { TtsVoiceSelect } from './TtsVoiceSelect';
import {
  TTS_VOICE_PRESETS_FALLBACK,
  mergeTtsVoicePresetsFromServer,
} from '../utils/ttsVoicePresets';
import {
  type OutlineNodeApi,
  outlineToPages,
} from '../utils/outlineScriptPages';

type ProjectDetailForManual = {
  project: {
    input_prompt?: string | null;
    text_structure_mode?: string | null;
    deck_style_user_hint?: string | null;
    tts_voice_type?: string | null;
    deck_style_prompt_text?: string | null;
  };
  outline: OutlineNodeApi[];
};

export function ManualTextPrepDialog(props: {
  open: boolean;
  projectId: number;
  initialRaw: string;
  initialMode: 'polish' | 'verbatim_split';
  onClose: () => void;
  /** 点击确认后立刻调用（乐观标文本步为进行中）；请求失败时配合 onKickoffFailed */
  onQueued: () => void;
  /** PATCH/排队失败时收回乐观态 */
  onKickoffFailed?: () => void;
  /** 已确认并交由后台执行时（本弹窗不负责跑流程），用于收起工作流面板等 */
  onConfirmHandoff?: () => void;
}) {
  const {
    open,
    projectId,
    initialRaw,
    initialMode,
    onClose,
    onQueued,
    onKickoffFailed,
    onConfirmHandoff,
  } = props;
  const [raw, setRaw] = useState(initialRaw);
  const [mode, setMode] = useState<'polish' | 'verbatim_split'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 打开时用 GET 详情拉 input_prompt；列表接口不带正文，父级往往几秒后才合并到 currentProject */
  const [detailLoading, setDetailLoading] = useState(false);
  const textKickoffInFlightRef = useRef(false);

  useEffect(() => {
    if (open) return;
    if (!textKickoffInFlightRef.current) return;
    textKickoffInFlightRef.current = false;
    onKickoffFailed?.();
  }, [open, onKickoffFailed]);

  useEffect(() => {
    if (!open) return;
    setRaw(initialRaw);
    setMode(initialMode);
    setErr(null);
  }, [open, initialRaw, initialMode]);

  useEffect(() => {
    if (!open || !Number.isFinite(projectId) || projectId <= 0) return;
    let cancelled = false;
    setDetailLoading(true);
    void apiFetch<ProjectDetailForManual>(`/api/projects/${projectId}`)
      .then((d) => {
        if (cancelled) return;
        const ip = d.project?.input_prompt;
        if (ip != null) setRaw(String(ip));
        const tsm = (d.project?.text_structure_mode || '').trim().toLowerCase();
        setMode(tsm === 'verbatim_split' ? 'verbatim_split' : 'polish');
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  const submit = async () => {
    const t = raw.trim();
    if (!t) {
      setErr('原文不能为空');
      return;
    }
    setBusy(true);
    setErr(null);
    onQueued();
    textKickoffInFlightRef.current = true;
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          input_prompt: t,
        }),
      });
      await apiFetch(`/api/projects/${projectId}/workflow/text/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      textKickoffInFlightRef.current = false;
      onConfirmHandoff?.();
      onClose();
    } catch (e) {
      textKickoffInFlightRef.current = false;
      onKickoffFailed?.();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sf-modal-backdrop-dense fixed inset-0 z-[140] flex items-center justify-center p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="manual-text-prep-title"
    >
      <div className="sf-dialog-shell max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between border-b border-[var(--sf-border-base)] px-4 py-3">
          <h2 id="manual-text-prep-title" className="text-base font-semibold sf-text-primary">
            确认素材与生成方式
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs sf-text-muted leading-relaxed">
            可编辑下方原文。选择「AI 整理口播」会按播客风格改写；「仅分段」则尽量保留原文用字，只做标题、分段与概括（仍由模型切块，需人工在下一步核对）。
          </p>
          <div className="relative">
            {detailLoading && !raw.trim() ? (
              <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--sf-border-base)] bg-[var(--sf-surface-elevated)]/80 py-16 text-sm sf-text-secondary">
                <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden />
                <span>正在加载主题原文…</span>
              </div>
            ) : null}
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              disabled={busy || detailLoading}
              rows={12}
              className="sf-input-control w-full resize-y rounded-xl border px-3 py-2.5 text-sm placeholder:opacity-80 disabled:opacity-60"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || detailLoading}
              onClick={() => setMode('polish')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                mode === 'polish'
                  ? 'border-purple-500/50 bg-purple-500/10 sf-text-primary'
                  : 'border-[var(--sf-border-base)] sf-text-secondary hover:border-[var(--sf-chip-neutral-hover-border)]'
              }`}
            >
              AI 整理口播
            </button>
            <button
              type="button"
              disabled={busy || detailLoading}
              onClick={() => setMode('verbatim_split')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                mode === 'verbatim_split'
                  ? 'border-amber-500/50 bg-amber-500/10 sf-text-primary'
                  : 'border-[var(--sf-border-base)] sf-text-secondary hover:border-[var(--sf-chip-neutral-hover-border)]'
              }`}
            >
              仅分段（保留原文）
            </button>
          </div>
          {err ? (
            <p className="text-sm text-red-300 light:text-red-800" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sf-border-base)] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-[var(--sf-border-base)] px-4 py-2 text-sm sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || detailLoading}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认并开始生成
          </button>
        </div>
      </div>
    </div>
  );
}

const jsonPost = (): HeadersInit => ({
  'Content-Type': 'application/json',
});

/** 与 Home 创建表单、backend DECK_STYLE_PRESETS 一致 */
const STYLE_PRESETS = [
  { value: 'aurora_glass', title: '极光玻璃', subtitle: '' },
  { value: 'minimal_tech', title: '极简科技', subtitle: '' },
  { value: 'dark_neon', title: '暗黑霓虹', subtitle: '' },
  { value: 'editorial_luxury', title: '杂志高级感', subtitle: '' },
  { value: 'futuristic_hud', title: '未来 HUD', subtitle: '' },
] as const;

function validateManualOutlinePages(
  pages: ReturnType<typeof outlineToPages>,
): string | null {
  for (let pi = 0; pi < pages.length; pi++) {
    const p = pages[pi]!;
    if (!(p.main_title || '').trim()) {
      return `第 ${pi + 1} 页大标题不能为空`;
    }
    if (!p.segments.length) {
      return `第 ${pi + 1} 页须至少包含一个小节`;
    }
    for (let si = 0; si < p.segments.length; si++) {
      const s = p.segments[si]!;
      if (!(s.subtitle || '').trim()) {
        return `第 ${pi + 1} 页第 ${si + 1} 节小标题不能为空`;
      }
      if (!(s.narration_text || '').trim()) {
        return `第 ${pi + 1} 页第 ${si + 1} 节口播正文不能为空`;
      }
      if (!(s.narration_brief || '').trim()) {
        return `第 ${pi + 1} 页第 ${si + 1} 节概括不能为空`;
      }
    }
  }
  return null;
}

export function ManualOutlineConfirmDialog(props: {
  open: boolean;
  projectId: number;
  /** 来自父级已同步的 GET /api/projects/:id outline，有则打开即展示，无需再等请求 */
  initialOutline?: OutlineNodeApi[] | null;
  initialTtsVoiceType?: string | null;
  onClose: () => void;
  /** 点击确认后立刻乐观标音频步为进行中 */
  onAudioWorkflowKickoff?: () => void;
  /** 保存分段或后续配音请求失败时收回乐观态 */
  onAudioWorkflowKickoffFailed?: () => void;
  /** 口播分段已写入库后刷新（早于配音接口返回） */
  onConfirmed: () => void;
  /** 自动调用整稿配音接口且成功返回后（与 onConfirmed 配合） */
  onAudioChainComplete?: () => void;
  /** 分段已保存但自动提交配音失败时提示（可再到顶栏重试音频） */
  onNextStepError?: (message: string) => void;
  /** 分段已确认并交由后台配音时，用于收起工作流面板等 */
  onConfirmHandoff?: () => void;
}) {
  const {
    open,
    projectId,
    initialOutline = null,
    initialTtsVoiceType = null,
    onClose,
    onAudioWorkflowKickoff,
    onAudioWorkflowKickoffFailed,
    onConfirmed,
    onAudioChainComplete,
    onNextStepError,
    onConfirmHandoff,
  } = props;
  const [pages, setPages] = useState<ReturnType<typeof outlineToPages>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [voicePresets, setVoicePresets] = useState<
    { value: string; label: string }[]
  >([]);
  const [voicePresetsLoading, setVoicePresetsLoading] = useState(false);
  const [selectedTtsVoice, setSelectedTtsVoice] = useState('');
  const initialOutlineRef = useRef(initialOutline);
  const initialTtsRef = useRef(initialTtsVoiceType);
  initialOutlineRef.current = initialOutline;
  initialTtsRef.current = initialTtsVoiceType;
  const audioKickoffInFlightRef = useRef(false);

  useEffect(() => {
    if (open) return;
    if (!audioKickoffInFlightRef.current) return;
    audioKickoffInFlightRef.current = false;
    onAudioWorkflowKickoffFailed?.();
  }, [open, onAudioWorkflowKickoffFailed]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setErr(null);
    const vt0 = (initialTtsRef.current ?? '').trim();
    setSelectedTtsVoice(vt0);
    const seed = outlineToPages(initialOutlineRef.current ?? []);
    if (seed.length > 0) {
      setPages(seed);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setPages([]);
    setLoading(true);
    void apiFetch<ProjectDetailForManual>(`/api/projects/${projectId}`)
      .then((d) => {
        if (cancelled) return;
        setPages(outlineToPages(d.outline || []));
        const vt = d.project?.tts_voice_type;
        setSelectedTtsVoice(
          typeof vt === 'string' && vt.trim() ? vt.trim() : vt0,
        );
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !loading) return;
    const seed = outlineToPages(initialOutline ?? []);
    if (seed.length === 0) return;
    setPages(seed);
    setSelectedTtsVoice((initialTtsVoiceType ?? '').trim());
    setLoading(false);
  }, [open, loading, initialOutline, initialTtsVoiceType]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVoicePresetsLoading(true);
    void apiFetch<{ presets: { value: string; label: string }[] }>(
      '/api/tts/voice-presets',
    )
      .then((r) => {
        if (!cancelled) {
          setVoicePresets(mergeTtsVoicePresetsFromServer(r.presets));
        }
      })
      .catch(() => {
        if (!cancelled) setVoicePresets(TTS_VOICE_PRESETS_FALLBACK);
      })
      .finally(() => {
        if (!cancelled) setVoicePresetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!pages.length) {
      setErr('没有可提交的大纲');
      return;
    }
    const validationErr = validateManualOutlinePages(pages);
    if (validationErr) {
      setErr(validationErr);
      return;
    }
    setBusy(true);
    onAudioWorkflowKickoff?.();
    audioKickoffInFlightRef.current = true;
    setErr(null);
    try {
      const pagesPayload = pages.map((p) => ({
        page_node_id: p.page_node_id,
        main_title: p.main_title.trim(),
        segments: p.segments.map((s) => ({
          step_node_id: s.step_node_id,
          subtitle: s.subtitle.trim(),
          narration_text: s.narration_text.trim(),
          narration_brief: (s.narration_brief || '').trim(),
        })),
      }));
      const vt = selectedTtsVoice.trim();
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tts_voice_type: vt || null }),
      });
      await apiFetch(`/api/projects/${projectId}/manual/confirm-outline`, {
        method: 'POST',
        headers: jsonPost(),
        body: JSON.stringify({ pages: pagesPayload }),
      });
      onConfirmHandoff?.();
      onConfirmed();
      setBusy(false);
      audioKickoffInFlightRef.current = false;
      onClose();
      // 配音接口可能耗时很长；先关弹窗，避免确定后长时间无法点叉关闭。
      void (async () => {
        try {
          await apiFetch(`/api/projects/${projectId}/workflow/audio/run`, {
            method: 'POST',
            headers: jsonPost(),
            body: '{}',
          });
          onAudioChainComplete?.();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          onAudioWorkflowKickoffFailed?.();
          onNextStepError?.(`分段已保存，但自动开始配音失败：${msg}`);
        }
      })();
    } catch (e) {
      audioKickoffInFlightRef.current = false;
      onAudioWorkflowKickoffFailed?.();
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="sf-modal-backdrop-dense fixed inset-0 z-[140] flex items-center justify-center p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="manual-outline-title"
    >
      <div className="sf-dialog-shell flex max-h-[92vh] min-h-[min(70vh,520px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between border-b border-[var(--sf-border-base)] px-4 py-3">
          <h2 id="manual-outline-title" className="text-base font-semibold sf-text-primary">
            确认口播分段
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible flex min-h-[360px] flex-1 flex-col space-y-6 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex min-h-[min(48vh,400px)] flex-1 flex-col items-center justify-center gap-3 sf-text-secondary">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
              <p className="text-sm sf-text-muted">正在加载口播分段…</p>
            </div>
          ) : (
            <>
              <div className="sf-nested-surface space-y-2 rounded-xl border p-3">
                <label className="text-xs font-medium sf-text-muted">配音音色</label>
                <p className="text-xs leading-relaxed sf-text-muted">
                  开始整稿配音前可在此修改。选「默认」表示不覆盖项目音色，与服务器环境配置一致。
                </p>
                <TtsVoiceSelect
                  options={voicePresets}
                  value={selectedTtsVoice}
                  onChange={setSelectedTtsVoice}
                  disabled={busy}
                  loading={voicePresetsLoading}
                />
              </div>
              {pages.map((p, pi) => (
              <div key={p.page_node_id} className="sf-nested-surface space-y-3 rounded-xl border p-3">
                <label className="block text-xs font-medium sf-text-muted">
                  大标题 {pi + 1}（必填）
                </label>
                <input
                  value={p.main_title}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPages((prev) =>
                      prev.map((x, i) => (i === pi ? { ...x, main_title: v } : x)),
                    );
                  }}
                  disabled={busy}
                  className="sf-input-control w-full rounded-lg border px-3 py-2 text-sm"
                />
                {p.segments.map((s, si) => (
                  <div
                    key={s.step_node_id}
                    className="ml-0 space-y-2 border-l-2 border-purple-500/30 pl-3 sm:ml-2"
                  >
                    <label className="text-xs sf-text-muted">小标题（必填）</label>
                    <input
                      value={s.subtitle}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPages((prev) =>
                          prev.map((x, i) => {
                            if (i !== pi) return x;
                            const segs = x.segments.map((y, j) =>
                              j === si ? { ...y, subtitle: v } : y,
                            );
                            return { ...x, segments: segs };
                          }),
                        );
                      }}
                      disabled={busy}
                      className="sf-input-control w-full rounded-lg border px-3 py-2 text-sm"
                    />
                    <label className="text-xs sf-text-muted">口播正文（必填）</label>
                    <textarea
                      value={s.narration_text}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPages((prev) =>
                          prev.map((x, i) => {
                            if (i !== pi) return x;
                            const segs = x.segments.map((y, j) =>
                              j === si ? { ...y, narration_text: v } : y,
                            );
                            return { ...x, segments: segs };
                          }),
                        );
                      }}
                      disabled={busy}
                      rows={4}
                      className="sf-input-control w-full resize-y rounded-lg border px-3 py-2 text-sm"
                    />
                    <label className="text-xs sf-text-muted">概括（必填）</label>
                    <textarea
                      value={s.narration_brief || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPages((prev) =>
                          prev.map((x, i) => {
                            if (i !== pi) return x;
                            const segs = x.segments.map((y, j) =>
                              j === si ? { ...y, narration_brief: v.trim() === '' ? null : v } : y,
                            );
                            return { ...x, segments: segs };
                          }),
                        );
                      }}
                      disabled={busy}
                      rows={2}
                      className="sf-input-control w-full resize-y rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                ))}
              </div>
            ))}
            </>
          )}
          {err ? (
            <p className="text-sm text-red-300 light:text-red-800" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sf-border-base)] px-4 py-3">
          <button
            type="button"
            disabled={busy || loading}
            onClick={onClose}
            className="rounded-xl border border-[var(--sf-border-base)] px-4 py-2 text-sm sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
          >
            稍后
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认并保存（开始配音）
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManualDeckMasterDialog(props: {
  open: boolean;
  projectId: number;
  initialHint: string;
  initialDeckStylePreset: string;
  initialDeckMasterSourceProjectId: number | null;
  onClose: () => void;
  /** 点击确认后立刻乐观标母版步为进行中 */
  onKickoffOptimistic?: () => void;
  /** 请求失败时收回乐观态 */
  onKickoffFailed?: () => void;
  /** 刷新列表/工程状态 */
  onDone: () => void;
}) {
  const {
    open,
    projectId,
    initialHint,
    initialDeckStylePreset,
    initialDeckMasterSourceProjectId,
    onClose,
    onKickoffOptimistic,
    onKickoffFailed,
    onDone,
  } = props;
  const [deckMasterMode, setDeckMasterMode] = useState<'self' | 'reuse'>('self');
  const [selectedStyle, setSelectedStyle] = useState<string>('none');
  const [deckStyleUserHint, setDeckStyleUserHint] = useState('');
  const [deckMasterSourceRaw, setDeckMasterSourceRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deckMasterKickoffInFlightRef = useRef(false);

  useEffect(() => {
    if (open) return;
    if (!deckMasterKickoffInFlightRef.current) return;
    deckMasterKickoffInFlightRef.current = false;
    onKickoffFailed?.();
  }, [open, onKickoffFailed]);

  useEffect(() => {
    if (!open) return;
    setDeckStyleUserHint(initialHint);
    setErr(null);
    if (initialDeckMasterSourceProjectId != null) {
      setDeckMasterMode('reuse');
      setDeckMasterSourceRaw(String(initialDeckMasterSourceProjectId));
      setSelectedStyle('none');
    } else {
      setDeckMasterMode('self');
      setDeckMasterSourceRaw('');
      const p = (initialDeckStylePreset || 'none').trim() || 'none';
      const valid = STYLE_PRESETS.some((x) => x.value === p);
      setSelectedStyle(valid ? p : 'none');
    }
  }, [open, initialHint, initialDeckStylePreset, initialDeckMasterSourceProjectId]);

  if (!open) return null;

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
  const reuseSameAsCurrent =
    deckMasterMode === 'reuse' &&
    parsedCopyMasterId != null &&
    parsedCopyMasterId === projectId;

  const canSubmit =
    !busy &&
    !copyMasterInvalid &&
    (deckMasterMode === 'self' || (!reuseMasterNeedsId && !reuseSameAsCurrent));

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    onKickoffOptimistic?.();
    deckMasterKickoffInFlightRef.current = true;
    setErr(null);
    try {
      if (deckMasterMode === 'reuse') {
        const srcId = parsedCopyMasterId!;
        await apiFetch(`/api/projects/${projectId}/copy-deck-style-from`, {
          method: 'POST',
          headers: jsonPost(),
          body: JSON.stringify({ source_project_id: srcId }),
        });
      } else {
        const preset = selectedStyle === 'none' ? 'none' : selectedStyle;
        const hintTrim = deckStyleUserHint.trim();
        await apiFetch(`/api/projects/${projectId}/deck-style`, {
          method: 'PATCH',
          body: JSON.stringify({
            deck_style_preset: preset,
            deck_style_user_hint: hintTrim || null,
          }),
        });
        await apiFetch(`/api/projects/${projectId}/generate-deck-style`, {
          method: 'POST',
          headers: jsonPost(),
          body: '{}',
        });
      }
      // 仅刷新工程状态；不自动打开「生成场景页」弹窗（避免回退重做母版时被带到下游步骤）。
      onDone();
      deckMasterKickoffInFlightRef.current = false;
      setBusy(false);
      onClose();
    } catch (e) {
      deckMasterKickoffInFlightRef.current = false;
      onKickoffFailed?.();
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="sf-modal-backdrop-dense fixed inset-0 z-[140] flex items-center justify-center p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="manual-deck-master-title"
    >
      <div className="sf-dialog-shell max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between border-b border-[var(--sf-border-base)] px-4 py-3">
          <h2
            id="manual-deck-master-title"
            className="text-base font-semibold sf-text-primary"
          >
            生成演示母版
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium sf-text-primary">
              <LayoutTemplate className="h-3.5 w-3.5 text-purple-400/90" />
              演示母版
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (busy || deckMasterMode === 'self') return;
                  setDeckMasterMode('self');
                  setDeckMasterSourceRaw('');
                  const p = (initialDeckStylePreset || 'none').trim() || 'none';
                  const valid = STYLE_PRESETS.some((x) => x.value === p);
                  setSelectedStyle(valid ? p : 'none');
                  setDeckStyleUserHint(initialHint);
                }}
                disabled={busy}
                className={`rounded-xl border px-3 py-2 text-sm transition-all disabled:opacity-50 ${
                  deckMasterMode === 'self'
                    ? 'border-purple-500/50 bg-purple-500/10 sf-text-primary shadow-[0_0_16px_-8px_rgba(168,85,247,0.45)]'
                    : 'border-[var(--sf-border-base)] bg-[var(--sf-nested-surface-muted)] sf-text-secondary hover:border-[var(--sf-chip-neutral-hover-border)] hover:bg-[var(--sf-nested-surface)] hover:text-[var(--sf-text-primary)]'
                }`}
              >
                自己设计
              </button>
              <button
                type="button"
                onClick={() => {
                  if (busy || deckMasterMode === 'reuse') return;
                  setDeckMasterMode('reuse');
                  setSelectedStyle('none');
                  setDeckStyleUserHint('');
                }}
                disabled={busy}
                className={`rounded-xl border px-3 py-2 text-sm transition-all disabled:opacity-50 ${
                  deckMasterMode === 'reuse'
                    ? 'border-violet-500/50 bg-violet-500/10 sf-text-primary shadow-[0_0_16px_-8px_rgba(139,92,246,0.4)]'
                    : 'border-[var(--sf-border-base)] bg-[var(--sf-nested-surface-muted)] sf-text-secondary hover:border-[var(--sf-chip-neutral-hover-border)] hover:bg-[var(--sf-nested-surface)] hover:text-[var(--sf-text-primary)]'
                }`}
              >
                复用母版
              </button>
            </div>
            {deckMasterMode === 'self' ? (
              <>
                <p className="text-xs sf-text-muted">
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
                        disabled={busy}
                        className={`shrink-0 rounded-xl border px-3 py-2.5 text-left text-sm transition-all disabled:opacity-50 ${
                          on
                            ? 'border-purple-500/50 bg-purple-500/10 sf-text-primary shadow-[0_0_20px_-8px_rgba(168,85,247,0.5)]'
                            : 'border-[var(--sf-border-base)] bg-[var(--sf-nested-surface-muted)] sf-text-secondary hover:border-[var(--sf-chip-neutral-hover-border)] hover:bg-[var(--sf-nested-surface)] hover:text-[var(--sf-text-primary)]'
                        }`}
                      >
                        <span className="block font-medium leading-snug">{opt.title}</span>
                        {opt.subtitle ? (
                          <span className="mt-0.5 block text-xs sf-text-muted">{opt.subtitle}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="manual-deck-style-user-hint"
                    className="text-xs font-medium sf-text-secondary"
                  >
                    自定义风格提示词（选填）
                  </label>
                  <textarea
                    id="manual-deck-style-user-hint"
                    rows={3}
                    value={deckStyleUserHint}
                    onChange={(e) => setDeckStyleUserHint(e.target.value)}
                    disabled={busy}
                    placeholder="例如：主色用深蓝、偏商务、少用渐变……"
                    className="sf-input-control w-full resize-y rounded-xl border px-3 py-2.5 text-sm shadow-inner placeholder:opacity-80 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50"
                  />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs sf-text-muted">
                  从已有工程引用已就绪的演示母版（与源项目共用同一条样式记录，不另存副本），不再调用模型。须填写源项目数字 ID，且源项目母版已就绪。
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium sf-text-secondary">源项目 ID</span>
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
                    disabled={busy}
                    aria-label="复用母版源项目 ID"
                    className="sf-input-control min-w-[6rem] max-w-[10rem] rounded-xl border px-3 py-2 text-center font-mono text-sm placeholder:opacity-80 focus:border-violet-500/55 focus:outline-none focus:ring-2 focus:ring-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                {copyMasterInvalid ? (
                  <p className="text-xs text-amber-200/95 light:text-amber-900" role="alert">
                    须填写正整数项目 ID。
                  </p>
                ) : reuseSameAsCurrent ? (
                  <p className="text-xs text-amber-200/95 light:text-amber-900" role="alert">
                    源项目不能为本项目。
                  </p>
                ) : reuseMasterNeedsId ? (
                  <p className="text-xs sf-text-muted" role="status">
                    请填写有效的源项目 ID 后即可确认。
                  </p>
                ) : (
                  <p className="text-xs sf-text-muted">
                    将使用项目 {parsedCopyMasterId} 的演示母版外观。
                  </p>
                )}
              </>
            )}
          </div>
          {err ? (
            <p className="text-sm text-red-300 light:text-red-800" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sf-border-base)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[var(--sf-border-base)] px-4 py-2 text-sm sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            确认生成
          </button>
        </div>
      </div>
    </div>
  );
}

export function ManualDeckPagesDialog(props: {
  open: boolean;
  projectId: number;
  /** 父级已合并详情时的风格说明（列表接口无此字段）；弹窗打开后仍会 GET 详情拉取最新，避免空白等待 */
  initialDeckStylePromptText?: string | null;
  onClose: () => void;
  onDone: () => void;
  /** 已确认并交由后台生成场景页时，用于收起工作流面板等 */
  onConfirmHandoff?: () => void;
  /** 后端判定各页已就绪、未新启动作业时（避免误报「已启动」） */
  onAlreadyComplete?: () => void;
  /** 点击确认后立刻调用（顶栏将场景页标为进行中，防重复点击） */
  onGenerationStarted?: () => void;
  /** 保存或启动失败、或 409 无需生成时收回乐观态 */
  onGenerationKickoffFailed?: () => void;
}) {
  const {
    open,
    projectId,
    initialDeckStylePromptText,
    onClose,
    onDone,
    onConfirmHandoff,
    onAlreadyComplete,
    onGenerationStarted,
    onGenerationKickoffFailed,
  } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stylePromptText, setStylePromptText] = useState('');
  const [styleDetailLoading, setStyleDetailLoading] = useState(false);
  const initialPromptRef = useRef(initialDeckStylePromptText);
  initialPromptRef.current = initialDeckStylePromptText;
  const styleDirtyRef = useRef(false);
  const deckPagesKickoffInFlightRef = useRef(false);

  useEffect(() => {
    if (open) return;
    if (!deckPagesKickoffInFlightRef.current) return;
    deckPagesKickoffInFlightRef.current = false;
    onGenerationKickoffFailed?.();
  }, [open, onGenerationKickoffFailed]);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    styleDirtyRef.current = false;
    // 父级若已合并详情则先显示；不把 initial 列入依赖，避免轮询刷新时冲掉正在编辑的内容
    setStylePromptText((initialPromptRef.current ?? '').trim());
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !Number.isFinite(projectId) || projectId <= 0) return;
    let cancelled = false;
    setStyleDetailLoading(true);
    void apiFetch<ProjectDetailForManual>(`/api/projects/${projectId}`)
      .then((d) => {
        if (cancelled) return;
        if (!styleDirtyRef.current) {
          const t = d.project?.deck_style_prompt_text;
          setStylePromptText(t != null ? String(t).trim() : '');
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setStyleDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    onGenerationStarted?.();
    deckPagesKickoffInFlightRef.current = true;
    setErr(null);
    try {
      await apiFetch(`/api/projects/${projectId}/deck-style-prompt-text`, {
        method: 'PATCH',
        headers: jsonPost(),
        body: JSON.stringify({
          deck_style_prompt_text: stylePromptText.trim(),
        }),
      });
      await apiFetch(`/api/projects/${projectId}/workflow/demo/run`, {
        method: 'POST',
        headers: jsonPost(),
        body: '{}',
      });
      deckPagesKickoffInFlightRef.current = false;
      onConfirmHandoff?.();
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = typeof e.detail === 'string' ? e.detail : '';
        if (d.includes('所有演示页均已生成成功') || d.includes('无需重新生成')) {
          deckPagesKickoffInFlightRef.current = false;
          onGenerationKickoffFailed?.();
          onConfirmHandoff?.();
          if (onAlreadyComplete) {
            onAlreadyComplete();
          } else {
            onDone();
          }
          onClose();
          return;
        }
      }
      deckPagesKickoffInFlightRef.current = false;
      onGenerationKickoffFailed?.();
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sf-modal-backdrop-dense fixed inset-0 z-[140] flex items-center justify-center p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="manual-deck-pages-title"
    >
      <div className="sf-dialog-shell flex max-h-[90vh] min-h-[min(72vh,560px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border">
        <div className="flex items-center justify-between border-b border-[var(--sf-border-base)] px-4 py-3">
          <h2
            id="manual-deck-pages-title"
            className="text-base font-semibold sf-text-primary"
          >
            生成场景页
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible flex min-h-[320px] flex-1 flex-col space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium sf-text-primary">
              <Sparkles className="h-3.5 w-3.5 text-purple-400/90 light:text-purple-600" />
              AI 风格说明（生成大页前可改）
            </label>
            <p className="text-xs leading-relaxed sf-text-muted">
              以下内容来自风格表中的{' '}
              <span className="font-mono sf-text-secondary">style_prompt_text</span>
              ，与演示母版步骤写入的结果一致。可按需微调后再确认；将先保存到服务器，再启动各页生成。
            </p>
            <div className="space-y-2">
              <label
                htmlFor="manual-deck-pages-style-prompt"
                className="text-xs font-medium sf-text-secondary"
              >
                风格说明正文
              </label>
              <div className="relative min-h-[14rem]">
                {styleDetailLoading && !stylePromptText.trim() ? (
                  <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--sf-border-base)] bg-[var(--sf-surface-elevated)]/80 py-16 text-sm sf-text-secondary">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" aria-hidden />
                    <span>正在加载风格说明…</span>
                  </div>
                ) : null}
                <textarea
                  id="manual-deck-pages-style-prompt"
                  rows={10}
                  value={stylePromptText}
                  onChange={(e) => {
                    styleDirtyRef.current = true;
                    setStylePromptText(e.target.value);
                  }}
                  disabled={busy || (styleDetailLoading && !stylePromptText.trim())}
                  placeholder="若母版刚生成完毕，说明会显示在此处；也可自行补充或粘贴风格要求。"
                  className="sf-input-control min-h-[14rem] w-full resize-y rounded-xl border px-3 py-2.5 text-sm leading-relaxed shadow-inner placeholder:opacity-80 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:cursor-wait disabled:opacity-60"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 pt-1 text-sm font-medium sf-text-primary">
              <LayoutGrid className="h-3.5 w-3.5 text-purple-400/90 light:text-purple-600" />
              批量生成各页 HTML
            </label>
            <p className="text-xs leading-relaxed sf-text-muted">
              确认后将按当前母版与上方风格说明，为大纲中的每一大页生成演示 HTML。
            </p>
            <div className="sf-nested-surface-muted rounded-xl border px-3 py-2.5">
              <p className="text-xs leading-relaxed sf-text-secondary">
                确认后任务在后台执行，进行中时顶栏为「进行中」；若各页已就绪则无需重复启动。完成后显示「已完成」；期间可关闭本窗口。
              </p>
            </div>
          </div>
          {err ? (
            <p className="text-sm text-red-300 light:text-red-800" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sf-border-base)] px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-[var(--sf-border-base)] px-4 py-2 text-sm sf-text-secondary transition-colors hover:bg-[var(--sf-chip-neutral-hover-bg)] hover:text-[var(--sf-text-primary)]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || styleDetailLoading}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            保存风格说明并生成
          </button>
        </div>
      </div>
    </div>
  );
}
