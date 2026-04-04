import { useEffect, useState } from 'react';
import { LayoutGrid, LayoutTemplate, Loader2, Sparkles, X } from 'lucide-react';
import { ApiError, apiFetch } from '../api';
import { TtsVoiceSelect } from './TtsVoiceSelect';
import {
  TTS_VOICE_PRESETS_FALLBACK,
  mergeTtsVoicePresetsFromServer,
} from '../utils/ttsVoicePresets';
import { type OutlineNodeApi, outlineToPages } from '../utils/outlineScriptPages';

type ProjectDetailForManual = {
  project: {
    input_prompt?: string | null;
    text_structure_mode?: string | null;
    deck_style_user_hint?: string | null;
    tts_voice_type?: string | null;
  };
  outline: OutlineNodeApi[];
};

type ProjectDetailForDeckPages = {
  project: { deck_style_prompt_text?: string | null };
};

export function ManualTextPrepDialog(props: {
  open: boolean;
  projectId: number;
  initialRaw: string;
  initialMode: 'polish' | 'verbatim_split';
  onClose: () => void;
  onQueued: () => void;
  /** 已确认并交由后台执行时（本弹窗不负责跑流程），用于收起工作流面板等 */
  onConfirmHandoff?: () => void;
}) {
  const { open, projectId, initialRaw, initialMode, onClose, onQueued, onConfirmHandoff } =
    props;
  const [raw, setRaw] = useState(initialRaw);
  const [mode, setMode] = useState<'polish' | 'verbatim_split'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRaw(initialRaw);
    setMode(initialMode);
    setErr(null);
  }, [open, initialRaw, initialMode]);

  if (!open) return null;

  const submit = async () => {
    const t = raw.trim();
    if (!t) {
      setErr('原文不能为空');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          input_prompt: t,
          text_structure_mode: mode,
        }),
      });
      await apiFetch(`/api/projects/${projectId}/workflow/text/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      onConfirmHandoff?.();
      onQueued();
      onClose();
    } catch (e) {
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="manual-text-prep-title" className="text-base font-semibold text-zinc-100 sf-text-primary">
            确认素材与生成方式
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto px-4 py-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            可编辑下方原文。选择「AI 整理口播」会按播客风格改写；「仅分段」则尽量保留原文用字，只做标题、分段与概括（仍由模型切块，需人工在下一步核对）。
          </p>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            disabled={busy}
            rows={12}
            className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('polish')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                mode === 'polish'
                  ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              AI 整理口播
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('verbatim_split')}
              className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                mode === 'verbatim_split'
                  ? 'border-amber-500/50 bg-amber-500/10 text-zinc-100'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              仅分段（保留原文）
            </button>
          </div>
          {err ? (
            <p className="text-sm text-red-300" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
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
  onClose: () => void;
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
    onClose,
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

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void apiFetch<ProjectDetailForManual>(`/api/projects/${projectId}`)
      .then((d) => {
        if (cancelled) return;
        setPages(outlineToPages(d.outline || []));
        const vt = d.project?.tts_voice_type;
        setSelectedTtsVoice(typeof vt === 'string' && vt.trim() ? vt.trim() : '');
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
      try {
        await apiFetch(`/api/projects/${projectId}/workflow/audio/run`, {
          method: 'POST',
          headers: jsonPost(),
          body: '{}',
        });
        onAudioChainComplete?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onNextStepError?.(`分段已保存，但自动开始配音失败：${msg}`);
      }
      onClose();
    } catch (e) {
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
      aria-labelledby="manual-outline-title"
    >
      <div className="flex max-h-[92vh] min-h-[min(70vh,520px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="manual-outline-title" className="text-base font-semibold text-zinc-100">
            确认口播分段
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible flex min-h-[360px] flex-1 flex-col space-y-6 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex min-h-[min(48vh,400px)] flex-1 flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
              <p className="text-sm text-zinc-500">正在加载口播分段…</p>
            </div>
          ) : (
            <>
              <div className="space-y-2 rounded-xl border border-zinc-800/90 bg-zinc-900/30 p-3">
                <label className="text-xs font-medium text-zinc-500">配音音色</label>
                <p className="text-xs leading-relaxed text-zinc-500">
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
              <div key={p.page_node_id} className="space-y-3 rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-3">
                <label className="block text-xs font-medium text-zinc-500">
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
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                />
                {p.segments.map((s, si) => (
                  <div
                    key={s.step_node_id}
                    className="ml-0 space-y-2 border-l-2 border-purple-500/30 pl-3 sm:ml-2"
                  >
                    <label className="text-xs text-zinc-500">小标题（必填）</label>
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
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                    <label className="text-xs text-zinc-500">口播正文（必填）</label>
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
                      className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                    <label className="text-xs text-zinc-500">概括（必填）</label>
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
                      className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                    />
                  </div>
                ))}
              </div>
            ))}
            </>
          )}
          {err ? (
            <p className="text-sm text-red-300" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            disabled={busy || loading}
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
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
  /** 刷新列表/工程状态 */
  onDone: () => void;
  /** 母版已成功写入后：打开「生成场景页」弹窗（不自动启动页面生成） */
  onProceedToDeckPages?: () => void;
}) {
  const {
    open,
    projectId,
    initialHint,
    initialDeckStylePreset,
    initialDeckMasterSourceProjectId,
    onClose,
    onDone,
    onProceedToDeckPages,
  } = props;
  const [deckMasterMode, setDeckMasterMode] = useState<'self' | 'reuse'>('self');
  const [selectedStyle, setSelectedStyle] = useState<string>('none');
  const [deckStyleUserHint, setDeckStyleUserHint] = useState('');
  const [deckMasterSourceRaw, setDeckMasterSourceRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  const finishMasterSuccess = () => {
    // 先打开「确认风格 / 生成场景页」弹窗，再刷新列表；不在此处收起流程面板（母版与下游场景页解耦）。
    onProceedToDeckPages?.();
    onDone();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      if (deckMasterMode === 'reuse') {
        const srcId = parsedCopyMasterId!;
        await apiFetch(`/api/projects/${projectId}/copy-deck-style-from`, {
          method: 'POST',
          headers: jsonPost(),
          body: JSON.stringify({ source_project_id: srcId }),
        });
        finishMasterSuccess();
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
        finishMasterSuccess();
      }
    } catch (e) {
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
      aria-labelledby="manual-deck-master-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2
            id="manual-deck-master-title"
            className="text-base font-semibold text-zinc-100"
          >
            生成演示母版
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible max-h-[calc(90vh-8rem)] space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
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
                    ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_16px_-8px_rgba(168,85,247,0.45)]'
                    : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
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
                        disabled={busy}
                        className={`shrink-0 rounded-xl border px-3 py-2.5 text-left text-sm transition-all disabled:opacity-50 ${
                          on
                            ? 'border-purple-500/50 bg-purple-500/10 text-zinc-100 shadow-[0_0_20px_-8px_rgba(168,85,247,0.5)]'
                            : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/60 hover:text-zinc-200'
                        }`}
                      >
                        <span className="block font-medium leading-snug">{opt.title}</span>
                        {opt.subtitle ? (
                          <span className="mt-0.5 block text-xs text-zinc-500">{opt.subtitle}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="manual-deck-style-user-hint"
                    className="text-xs font-medium text-zinc-400"
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
                  <span className="text-xs font-medium text-zinc-400">源项目 ID</span>
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
                    className="min-w-[6rem] max-w-[10rem] rounded-xl border border-zinc-700/80 bg-zinc-950/90 px-3 py-2 text-center font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/55 focus:outline-none focus:ring-2 focus:ring-violet-500/25 disabled:cursor-not-allowed disabled:border-zinc-800/50 disabled:bg-zinc-950/40 disabled:text-zinc-600"
                  />
                </div>
                {copyMasterInvalid ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    须填写正整数项目 ID。
                  </p>
                ) : reuseSameAsCurrent ? (
                  <p className="text-xs text-amber-200/95" role="alert">
                    源项目不能为本项目。
                  </p>
                ) : reuseMasterNeedsId ? (
                  <p className="text-xs text-zinc-500" role="status">
                    请填写有效的源项目 ID 后即可确认。
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">
                    将使用项目 {parsedCopyMasterId} 的演示母版外观。
                  </p>
                )}
              </>
            )}
          </div>
          {err ? (
            <p className="text-sm text-red-300" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
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
  /** 工程详情已同步时的风格说明，打开瞬间预填，避免先空后闪 */
  initialDeckStylePromptText?: string | null;
  onClose: () => void;
  onDone: () => void;
  /** 已确认并交由后台生成场景页时，用于收起工作流面板等 */
  onConfirmHandoff?: () => void;
  /** 后端判定各页已就绪、未新启动作业时（避免误报「已启动」） */
  onAlreadyComplete?: () => void;
  /** 已成功启动批量场景生成后立刻调用（顶栏将场景页标为进行中，防重复点击） */
  onGenerationStarted?: () => void;
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
  } = props;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stylePromptText, setStylePromptText] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setDetailErr(null);
    // 仅在打开/切换工程时用父级已同步的文案预填；不把 initial 放进依赖，避免轮询更新工程时冲掉用户正在编辑的内容
    setStylePromptText((initialDeckStylePromptText ?? '').trim());
    setDetailLoading(true);
    void apiFetch<ProjectDetailForDeckPages>(`/api/projects/${projectId}`)
      .then((data) => {
        setStylePromptText((data.project?.deck_style_prompt_text ?? '').trim());
      })
      .catch((e) => {
        setDetailErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setDetailLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 预填只在 open/projectId 变化时采用当时的 initial
  }, [open, projectId]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
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
      onGenerationStarted?.();
      onConfirmHandoff?.();
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = typeof e.detail === 'string' ? e.detail : '';
        if (d.includes('所有演示页均已生成成功') || d.includes('无需重新生成')) {
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
      <div className="flex max-h-[90vh] min-h-[min(72vh,560px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700/90 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2
            id="manual-deck-pages-title"
            className="text-base font-semibold text-zinc-100"
          >
            生成场景页
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scrollbar-visible flex min-h-[320px] flex-1 flex-col space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300">
              <Sparkles className="h-3.5 w-3.5 text-purple-400/90" />
              AI 风格说明（生成大页前可改）
              {detailLoading ? (
                <span className="inline-flex items-center gap-1 text-xs font-normal text-zinc-500">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  同步中
                </span>
              ) : null}
            </label>
            <p className="text-xs leading-relaxed text-zinc-500">
              以下内容来自风格表中的{' '}
              <span className="font-mono text-zinc-400">style_prompt_text</span>
              ，与演示母版步骤写入的结果一致。可按需微调后再确认；将先保存到服务器，再启动各页生成。
            </p>
            <div className="space-y-2">
              <label
                htmlFor="manual-deck-pages-style-prompt"
                className="text-xs font-medium text-zinc-400"
              >
                风格说明正文
              </label>
              <div className="relative min-h-[14rem]">
                <textarea
                  id="manual-deck-pages-style-prompt"
                  rows={10}
                  value={stylePromptText}
                  onChange={(e) => setStylePromptText(e.target.value)}
                  disabled={busy || detailLoading || Boolean(detailErr)}
                  placeholder="若母版刚生成完毕，说明会显示在此处；也可自行补充或粘贴风格要求。"
                  className="min-h-[14rem] w-full resize-y rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-3 py-2.5 text-sm leading-relaxed text-zinc-100 shadow-inner placeholder:text-zinc-600 focus:border-purple-500/45 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:cursor-wait disabled:opacity-60"
                />
                {detailLoading ? (
                  <div
                    className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/45 backdrop-blur-[1px]"
                    aria-hidden
                  >
                    <Loader2 className="h-8 w-8 animate-spin text-purple-400/80" />
                  </div>
                ) : null}
              </div>
            </div>
            {detailErr ? (
              <p className="text-sm text-amber-200/95" role="alert">
                无法加载项目详情：{detailErr}
              </p>
            ) : null}
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-300 pt-1">
              <LayoutGrid className="h-3.5 w-3.5 text-purple-400/90" />
              批量生成各页 HTML
            </label>
            <p className="text-xs text-zinc-500 leading-relaxed">
              确认后将按当前母版与上方风格说明，为大纲中的每一大页生成演示 HTML。
            </p>
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/50 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-zinc-400">
                确认后任务在后台执行，进行中时顶栏为「进行中」；若各页已就绪则无需重复启动。完成后显示「已完成」；期间可关闭本窗口。
              </p>
            </div>
          </div>
          {err ? (
            <p className="text-sm text-red-300" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || detailLoading || Boolean(detailErr)}
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
