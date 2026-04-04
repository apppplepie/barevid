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

/** 开发/脚本直连后端时仍可显式使用；前端默认不再自动附带。 */
export const LEGACY_DEV_TOKEN = 'legacy';

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
    const detailText =
      typeof detail === 'string'
        ? detail.trim()
        : detail == null
          ? ''
          : JSON.stringify(detail);
    const msg = detailText || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, detail);
  }
  return json as T;
}
