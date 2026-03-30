const AUTH_TOKEN_KEY = 'neoncast_auth_token';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_BASE}${path}`;
}

export function getStoredAuthToken(): string | null {
  try {
    const t = localStorage.getItem(AUTH_TOKEN_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredAuthToken(token: string | null): void {
  try {
    if (token && token.trim()) {
      localStorage.setItem(AUTH_TOKEN_KEY, token.trim());
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getAuthBearerToken(): string | null {
  return getStoredAuthToken();
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

type ValidationIssue = {
  type?: string;
  loc?: unknown;
  msg?: string;
  ctx?: Record<string, unknown>;
};

function lastLocField(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const last = loc[loc.length - 1];
  return typeof last === 'string' ? last : null;
}

function formatValidationIssue(issue: ValidationIssue): string {
  const field = lastLocField(issue.loc);
  const t = issue.type ?? '';
  const ctx = issue.ctx ?? {};
  const minLen = typeof ctx.min_length === 'number' ? ctx.min_length : undefined;
  const maxLen = typeof ctx.max_length === 'number' ? ctx.max_length : undefined;

  const fieldLabel =
    field === 'username' ? '用户名' : field === 'password' ? '密码' : field ? field : '内容';

  if (t === 'string_too_short' && minLen != null) {
    return `${fieldLabel}至少需要 ${minLen} 个字符`;
  }
  if (t === 'string_too_long' && maxLen != null) {
    return `${fieldLabel}不能超过 ${maxLen} 个字符`;
  }
  if (t === 'missing' || t === 'value_error.missing') {
    return `请填写${fieldLabel}`;
  }
  const msg = (issue.msg || '').trim();
  if (msg) return msg;
  return `${fieldLabel}不符合要求`;
}

/** 将 FastAPI/Pydantic 的 detail 转为用户可读中文（避免整段 JSON 出现在界面上） */
export function formatApiDetailForUser(detail: unknown): string {
  if (detail == null || detail === '') return '请求失败，请稍后重试';
  if (typeof detail === 'string') {
    const s = detail.trim();
    return s || '请求失败，请稍后重试';
  }
  if (Array.isArray(detail)) {
    const parts = detail
      .filter((x): x is ValidationIssue => Boolean(x) && typeof x === 'object')
      .map(formatValidationIssue);
    const unique = [...new Set(parts.filter(Boolean))];
    return unique.length ? unique.join('；') : '请求参数有误';
  }
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (Array.isArray(d.detail)) return formatApiDetailForUser(d.detail);
    if ('loc' in d || 'type' in d) return formatValidationIssue(d as ValidationIssue);
  }
  return '请求失败，请稍后重试';
}

export function getUserFacingErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) {
    const m = err.message;
    if (
      m === 'Failed to fetch' ||
      m.includes('NetworkError') ||
      m.includes('Load failed') ||
      m.includes('network')
    ) {
      return '网络异常，请检查网络或稍后重试';
    }
    return m;
  }
  const s = String(err).trim();
  return s || '操作失败，请稍后重试';
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = getStoredAuthToken();
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.detail ?? json;
    const msg =
      formatApiDetailForUser(detail) ||
      (typeof res.status === 'number' ? `请求失败（${res.status}）` : '请求失败');
    throw new ApiError(msg, res.status, detail);
  }
  return json as T;
}
