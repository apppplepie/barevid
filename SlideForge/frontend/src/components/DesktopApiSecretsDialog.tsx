import { useState, useEffect, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderOpen, FileEdit } from 'lucide-react';

type DesktopApiSecretsDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function DesktopApiSecretsDialog({
  open,
  onClose,
}: DesktopApiSecretsDialogProps) {
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [doubaoTtsAppId, setDoubaoTtsAppId] = useState('');
  const [doubaoTtsAccessToken, setDoubaoTtsAccessToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const api = window.electronAPI;
    if (!api?.getApiSecrets) return;
    setSavedHint(null);
    setLoading(true);
    void api
      .getApiSecrets()
      .then((s) => {
        setDeepseekApiKey(s.deepseekApiKey);
        setDoubaoTtsAppId(s.doubaoTtsAppId);
        setDoubaoTtsAccessToken(s.doubaoTtsAccessToken);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const api = window.electronAPI;
    if (!api?.setApiSecrets) return;
    setLoading(true);
    setSavedHint(null);
    try {
      await api.setApiSecrets({
        deepseekApiKey,
        doubaoTtsAppId,
        doubaoTtsAccessToken,
      });
      setSavedHint(
        '已保存到应用数据目录。安装包内的捆绑后端会自动重启以加载新密钥；若仍异常可完全退出应用后再开。若你使用本机 uvicorn 跑 SlideForge/backend，请改该目录 .env 并重启 uvicorn。',
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 light:bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-api-secrets-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 light:border-slate-200 bg-zinc-950 light:bg-white shadow-xl light:shadow-slate-200/60">
        <div className="flex items-center justify-between border-b border-zinc-800 light:border-slate-200 px-4 py-3">
          <h2
            id="desktop-api-secrets-title"
            className="text-sm font-medium text-zinc-200 light:text-slate-800"
          >
            API 密钥与语音服务
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-sf-muted transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-200 light:hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <p className="text-xs leading-relaxed text-sf-muted space-y-2">
            <span className="block">
              对应环境变量{' '}
              <code className="rounded bg-zinc-900/80 light:bg-slate-100 px-1 py-0.5 text-[11px]">
                DEEPSEEK_API_KEY
              </code>
              、
              <code className="rounded bg-zinc-900/80 light:bg-slate-100 px-1 py-0.5 text-[11px]">
                DOUBAO_TTS_APP_ID
              </code>
              、
              <code className="rounded bg-zinc-900/80 light:bg-slate-100 px-1 py-0.5 text-[11px]">
                DOUBAO_TTS_ACCESS_TOKEN
              </code>
              。也可在用户数据目录直接编辑{' '}
              <code className="rounded bg-zinc-900/80 light:bg-slate-100 px-1 py-0.5 text-[11px]">
                api-secrets.env
              </code>
              。
            </span>
            <span className="block rounded-md border border-amber-500/25 bg-amber-950/20 px-2 py-2 text-amber-100/95 light:border-amber-600/30 light:bg-amber-50/90 light:text-amber-950">
              <strong className="font-medium">请确认你改的是「当前实际在跑」的那套后端：</strong>
              本机用{' '}
              <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] light:bg-black/10">
                uvicorn
              </code>{' '}
              跑仓库里的 FastAPI（常见{' '}
              <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] light:bg-black/10">
                127.0.0.1:8000
              </code>
              ）时，密钥必须写在仓库内{' '}
              <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] light:bg-black/10">
                SlideForge/backend/.env
              </code>
              ，并<strong>重启 uvicorn 进程</strong>；仅重启 Electron 或只改此处<strong>不会</strong>更新该后端。
              安装包里<strong>捆绑的 barevid-api</strong>（常见{' '}
              <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] light:bg-black/10">
                127.0.0.1:18080
              </code>
              ）才会使用此处保存的密钥 /{' '}
              <code className="rounded bg-black/25 px-1 py-0.5 text-[11px] light:bg-black/10">
                api-secrets.env
              </code>
              ，改完后需<strong>完全退出并重启桌面应用</strong>。
            </span>
          </p>
          {savedHint ? (
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-200/95">
              {savedHint}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 light:text-slate-500">
              DeepSeek API Key
            </label>
            <input
              type="password"
              autoComplete="off"
              value={deepseekApiKey}
              onChange={(e) => setDeepseekApiKey(e.target.value)}
              placeholder="sk-…"
              className="w-full rounded-lg border border-zinc-800 light:border-slate-200 bg-zinc-900 light:bg-slate-50 px-3 py-2 text-sm text-zinc-100 light:text-slate-900 focus:border-purple-500/50 focus:outline-none placeholder:text-sf-placeholder"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 light:text-slate-500">
              豆包 TTS App ID
            </label>
            <input
              type="password"
              autoComplete="off"
              value={doubaoTtsAppId}
              onChange={(e) => setDoubaoTtsAppId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 light:border-slate-200 bg-zinc-900 light:bg-slate-50 px-3 py-2 text-sm text-zinc-100 light:text-slate-900 focus:border-purple-500/50 focus:outline-none placeholder:text-sf-placeholder"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 light:text-slate-500">
              豆包 TTS Access Token
            </label>
            <input
              type="password"
              autoComplete="off"
              value={doubaoTtsAccessToken}
              onChange={(e) => setDoubaoTtsAccessToken(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 light:border-slate-200 bg-zinc-900 light:bg-slate-50 px-3 py-2 text-sm text-zinc-100 light:text-slate-900 focus:border-purple-500/50 focus:outline-none placeholder:text-sf-placeholder"
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 light:border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => void window.electronAPI?.openSecretsEnvFile?.()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 light:border-slate-300 bg-zinc-900/80 light:bg-slate-50 px-3 py-2 text-xs font-medium text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100"
            >
              <FileEdit className="h-3.5 w-3.5" />
              打开 api-secrets.env
            </button>
            <button
              type="button"
              onClick={() => void window.electronAPI?.revealUserDataFolder?.()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 light:border-slate-300 bg-zinc-900/80 light:bg-slate-50 px-3 py-2 text-xs font-medium text-zinc-200 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开应用数据目录
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 light:border-slate-300 px-4 py-2 text-sm text-zinc-300 light:text-slate-700 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100"
            >
              关闭
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
