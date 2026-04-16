const AUTH_TOKEN_KEY = 'neoncast_auth_token';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE) return p;
  // 避免 VITE_API_BASE_URL 以 /api 结尾时又拼 /api/... → /api/api/...
  if (API_BASE.endsWith('/api') && p.startsWith('/api/')) {
    return `${API_BASE}${p.slice(4)}`;
  }
  return `${API_BASE}${p}`;
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
  /** Pydantic v2 校验项的人类可读说明 */
  msg?: string;
  ctx?: Record<string, unknown>;
};

function lastLocField(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const last = loc[loc.length - 1];
  return typeof last === 'string' ? last : null;
}

function formatValidationIssue(issue: ValidationIssue): string {
  if (typeof issue.msg === 'string' && issue.msg.trim()) {
    return issue.msg.trim();
  }
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

/** HTTP 状态码兜底说明（当响应体无法解析出 detail 时） */
function formatHttpStatusHint(status: number): string {
  if (status === 401) return '未登录或登录已过期，请重新登录后再试。';
  if (status === 403) return '没有权限执行此操作（403）。';
  if (status === 404) return '请求的资源不存在（404）。';
  if (status === 409) {
    return '与当前数据或业务规则冲突（409）。常见于：项目数量已达上限，请先删除项目后再创建。';
  }
  if (status === 422) return '提交的数据未通过校验（422），请检查表单。';
  if (status === 429) return '请求过于频繁（429），请稍后再试。';
  if (status === 503) {
    return '服务暂时不可用（503），例如数据库繁忙，请稍后重试。';
  }
  if (status >= 500) {
    return `服务器内部错误（${status}）。这通常不是「超过项目个数」导致的；请查看后端日志或联系管理员。`;
  }
  return `请求失败（${status}）。`;
}

/** 将 FastAPI/Pydantic 的 detail 转为用户可读中文（避免整段 JSON 出现在界面上） */
export function formatApiDetailForUser(detail: unknown): string {
  if (detail == null || detail === '') return '';
  if (typeof detail === 'string') {
    return detail.trim();
  }
  if (typeof detail === 'number' || typeof detail === 'boolean') {
    return String(detail);
  }
  if (Array.isArray(detail)) {
    const parts = detail.map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (typeof o.msg === 'string' && o.msg.trim()) return o.msg.trim();
        if ('loc' in o || 'type' in o) return formatValidationIssue(o as ValidationIssue);
      }
      return '';
    });
    const unique = [...new Set(parts.filter(Boolean))];
    return unique.length ? unique.join('；') : '';
  }
  if (typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    if (Array.isArray(d.detail)) return formatApiDetailForUser(d.detail);
    if (typeof d.detail === 'string' && d.detail.trim()) return d.detail.trim();
    if (typeof d.message === 'string' && d.message.trim()) return d.message.trim();
    if ('loc' in d || 'type' in d) return formatValidationIssue(d as ValidationIssue);
  }
  return '';
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
  const rawText = await res.text();
  let parsed: Record<string, unknown> | unknown[] | null = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown> | unknown[];
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const detailFromBody =
      parsed && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).detail ?? parsed
        : parsed;
    let msg = formatApiDetailForUser(detailFromBody);
    if (!msg) {
      const snippet = rawText.trim().replace(/\s+/g, ' ').slice(0, 280);
      const looksHtml = /<!doctype|<html[\s>]/i.test(snippet);
      if (snippet && !looksHtml) {
        msg = snippet;
      } else {
        msg = formatHttpStatusHint(res.status);
      }
    }
    throw new ApiError(msg, res.status, detailFromBody);
  }

  if (parsed === null || parsed === undefined) {
    return {} as T;
  }
  return parsed as T;
}
