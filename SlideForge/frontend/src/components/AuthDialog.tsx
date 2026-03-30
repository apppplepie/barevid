import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { apiFetch, getUserFacingErrorMessage, setStoredAuthToken } from '../api';

type AuthDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function AuthDialog({ open, onClose, onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const u = username.trim().toLowerCase();
    if (!u || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await apiFetch<{ token: string }>(path, {
        method: 'POST',
        body: JSON.stringify({ username: u, password }),
      });
      setStoredAuthToken(res.token);
      setPassword('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(getUserFacingErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="auth-dialog-title" className="text-sm font-medium text-zinc-200">
            {mode === 'login' ? '登录' : '注册'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          {error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">用户名</label>
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-purple-500/50 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500">密码</label>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-purple-500/50 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-purple-500 disabled:pointer-events-none disabled:opacity-50"
            >
              {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError(null);
              }}
              className="w-full rounded-md px-2 py-2 text-center text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
            >
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-600">
            登录后请求会携带你的会话令牌；未登录无法调用工程与项目接口。
          </p>
        </form>
      </div>
    </div>,
    document.body,
  );
}
