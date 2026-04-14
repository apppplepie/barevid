/**
 * 启动/停止安装包内捆绑的 FastAPI（PyInstaller 生成的 barevid-api.exe）。
 * 与 scripts/work.ps1 一致使用 uvicorn，但通过环境变量注入 SQLite 与导出相关配置。
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { app } from 'electron';

/** 与主进程约定的本机 API 端口（勿与常见 8000 冲突） */
export const BUNDLED_API_PORT = 18080;

export interface BundledBackendHandle {
  kill: () => void;
}

function sqliteUrlForPath(absDbPath: string): string {
  const norm = absDbPath.replace(/\\/g, '/');
  // 与 engine 注释一致：绝对路径用 sqlite+aiosqlite:///<path>（含 Unix / 与 Windows C:/）
  return `sqlite+aiosqlite:///${norm}`;
}

export function resolveBundledBackendExe(): string | null {
  if (process.env.BAREVID_SKIP_BUNDLED_BACKEND === '1') {
    return null;
  }
  const name = process.platform === 'win32' ? 'barevid-api.exe' : 'barevid-api';
  const p = path.join(process.resourcesPath ?? '', 'barevid-api', name);
  if (fs.existsSync(p)) {
    return p;
  }
  return null;
}

function httpGetJson(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`HTTP ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/** 轮询直到 /api/health 可用 */
export async function waitForBundledApiReady(
  port: number,
  opts?: { timeoutMs?: number; intervalMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const intervalMs = opts?.intervalMs ?? 400;
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await httpGetJson(url, 3000);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(
    `捆绑后端在 ${timeoutMs}ms 内未就绪（${String(lastErr)}）`
  );
}

export interface StartBundledBackendParams {
  /** Electron 本地 Express 端口（供 EXPORT_FRONTEND_URL） */
  expressPort: number;
  /** 与后端 EXPORT_WORKER_TOKEN 一致 */
  exportWorkerToken: string;
  apiPort?: number;
}

/**
 * 启动子进程；调用方应在 bootstrap 中先选定 expressPort，再传此处。
 */
export function startBundledBackend(
  exePath: string,
  params: StartBundledBackendParams
): BundledBackendHandle {
  const apiPort = params.apiPort ?? BUNDLED_API_PORT;
  const userData = app.getPath('userData');
  const dbFile = path.join(userData, 'slideforge.db');
  const storageRoot = path.join(userData, 'storage');
  fs.mkdirSync(storageRoot, { recursive: true });

  const databaseUrl = sqliteUrlForPath(dbFile);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const feOrigin = `http://127.0.0.1:${params.expressPort}`;

  const env = {
    ...process.env,
    BAREVID_API_PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    STORAGE_ROOT: storageRoot,
    EXPORT_API_URL: apiOrigin,
    EXPORT_PUBLIC_BASE_URL: apiOrigin,
    EXPORT_FRONTEND_URL: feOrigin,
    EXPORT_WORKER_TOKEN: params.exportWorkerToken,
    SLIDEFORGE_WORKER_KEY: params.exportWorkerToken,
    SLIDEFORGE_PUBLIC_BASE_URL: apiOrigin,
  };

  const child = cp.spawn(exePath, [], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logLine = (buf: Buffer, stream: 'stdout' | 'stderr') => {
    const s = buf.toString().trimEnd();
    if (!s) return;
    console.log(`[barevid-api ${stream}]`, s);
  };
  child.stdout?.on('data', (d) => logLine(d, 'stdout'));
  child.stderr?.on('data', (d) => logLine(d, 'stderr'));

  child.on('error', (err) => {
    console.error('[barevid-api] spawn error', err);
  });

  return {
    kill: () => {
      if (child.pid && process.platform === 'win32') {
        cp.exec(`taskkill /pid ${child.pid} /T /F`, () => {});
      } else {
        child.kill('SIGTERM');
      }
    },
  };
}
