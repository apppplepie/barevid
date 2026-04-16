/**
 * checker.ts
 * 解析 ffmpeg / Python(worker) / Playwright 浏览器路径。
 * 不自动安装任何依赖；需要导出时由用户自行安装，导出前通过 getExportPrerequisiteError 提示。
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';

/** 用户可见路径用正斜杠，避免 Roaming\barevid 中的 \\b 被误当成转义 */
function pathForMessage(abs: string): string {
  return abs.replace(/\\/g, '/');
}

/**
 * Playwright 浏览器目录：
 * 1) 开发：仓库 electron/resources/playwright-browsers（与 fetch-playwright-browsers.ps1 一致）
 * 2) 安装包：resources/playwright-browsers
 * 3) 否则 appData/barevid/browsers（用户自行 playwright install）
 */
export function getBrowsersPath(): string {
  if (!app.isPackaged) {
    const devBundled = path.join(__dirname, '..', 'resources', 'playwright-browsers');
    if (fs.existsSync(devBundled)) {
      return devBundled;
    }
  }
  const res = process.resourcesPath;
  if (res) {
    const bundled = path.join(res, 'playwright-browsers');
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return path.join(app.getPath('appData'), 'barevid', 'browsers');
}

/** 在打包产物里找 ffmpeg.exe，找不到再找 PATH */
export function resolveFfmpeg(): string | null {
  const res = process.resourcesPath;
  if (res) {
    const bundled = path.join(res, 'ffmpeg.exe');
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }
  return tryWhich('ffmpeg');
}

/** 供导出子进程使用：与自检时相同的 PATH（含常见 Python 安装目录），避免 spawn 找不到解释器 */
export function getEnvWithPythonPathHints(): NodeJS.ProcessEnv {
  return envWithPythonPathHints();
}

/** 找 Python 可执行文件：bundled worker.exe > python3 > python（PATH 含常见安装目录） */
export function resolvePython(): string | null {
  const res = process.resourcesPath;
  if (res) {
    const workerExe = path.join(res, 'worker.exe');
    if (fs.existsSync(workerExe)) {
      return workerExe;
    }
  }

  const envAug = envWithPythonPathHints();
  if (process.platform === 'win32') {
    const win = resolvePythonWindows(envAug);
    if (win) return win;
  }
  return tryWhich('python3', envAug) ?? tryWhich('python', envAug);
}

/** Windows：`where python` 首条常为 Microsoft Store 占位（易导致子进程退出码 9009），须跳过并优先用 py -3 解析真实路径 */
function resolvePythonWindows(envAug: NodeJS.ProcessEnv): string | null {
  const pyLauncher = tryWhich('py', envAug);
  if (pyLauncher && fs.existsSync(pyLauncher)) {
    try {
      const out = cp.execSync(`"${pyLauncher}" -3 -c "import sys; print(sys.executable)"`, {
        encoding: 'utf-8',
        windowsHide: true,
        env: envAug,
        timeout: 12_000,
      });
      const line = out
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .pop();
      if (line && fs.existsSync(line)) {
        return path.normalize(line);
      }
    } catch {
      /* ignore */
    }
  }

  for (const name of ['python3', 'python']) {
    for (const candidate of tryWhichAll(name, envAug)) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      if (isWindowsStorePythonPlaceholder(candidate)) continue;
      return path.normalize(candidate);
    }
  }

  // 用户未把 python 加入 PATH（where python 为空）时，直接扫官方默认安装目录
  const guessed = guessPythonExeFromDefaultInstallLayout();
  if (guessed) return guessed;

  return null;
}

/** 与 `py -3 -c "print(sys.executable)"` 常见结果一致：%LocalAppData%\Programs\Python\Python3xx\python.exe */
function guessPythonExeFromDefaultInstallLayout(): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const base = path.join(local, 'Programs', 'Python');
  if (!fs.existsSync(base)) return null;
  try {
    const names = fs.readdirSync(base);
    const withExe = names
      .map((name) => path.join(base, name, 'python.exe'))
      .filter((p) => fs.existsSync(p));
    if (withExe.length === 0) return null;
    withExe.sort();
    return path.normalize(withExe[withExe.length - 1]);
  } catch {
    return null;
  }
}

function isWindowsStorePythonPlaceholder(abs: string): boolean {
  return /WindowsApps[/\\](python|python3)\.exe$/i.test(abs.replace(/\\/g, '/'));
}

function tryWhichAll(cmd: string, env?: NodeJS.ProcessEnv): string[] {
  try {
    const result = cp.execSync(process.platform === 'win32' ? `where ${cmd}` : `which -a ${cmd}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env ?? process.env,
    });
    return result
      .toString()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 检查 Playwright Chromium 是否已安装 */
export function isChromiumInstalled(): boolean {
  const browsersPath = getBrowsersPath();
  if (!fs.existsSync(browsersPath)) return false;

  // Playwright 在 browsers/ 下建形如 chromium-XXXX 的目录
  const entries = fs.readdirSync(browsersPath);
  return entries.some((e) => e.startsWith('chromium'));
}

/**
 * 导出前自检：缺 ffmpeg / 解释器 / Playwright Chromium 时返回说明（供用户自行安装）。
 * 不阻止应用启动。
 */
export function getExportPrerequisiteError(): string | null {
  if (!resolveFfmpeg()) {
    return (
      '未检测到 ffmpeg。\n' +
      '需要导出时请自行安装并加入系统 PATH（https://ffmpeg.org/download.html 等）。'
    );
  }
  if (!resolvePython()) {
    return (
      '未检测到 Python（且安装包内无 worker.exe），无法运行导出。\n' +
      '请使用官方安装包，或安装 Python 3.10+ 并加入 PATH。'
    );
  }
  if (!isChromiumInstalled()) {
    const dir = getBrowsersPath();
    const show = pathForMessage(dir);
    return (
      '未检测到 Playwright Chromium。\n' +
      `本应用使用的浏览器目录为：\n${show}\n\n` +
      '若使用官方安装包仍出现此提示，请重新完整构建（含 fetch-playwright-browsers）。\n' +
      '开发时可在仓库执行：electron/scripts/fetch-playwright-browsers.ps1\n\n' +
      '手动安装示例（PowerShell）：\n' +
      `  $env:PLAYWRIGHT_BROWSERS_PATH="${show}"\n` +
      '  pip install "playwright>=1.42,<1.43"\n' +
      '  py -3 -m playwright install chromium\n'
    );
  }
  return null;
}

// ── 内部工具 ──────────────────────────────────────────────────────────────────

function augmentPathFragment(existing: string | undefined): string {
  const parts: string[] = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const base = path.join(local, 'Programs', 'Python');
      if (fs.existsSync(base)) {
        try {
          for (const name of fs.readdirSync(base)) {
            parts.push(path.join(base, name));
            parts.push(path.join(base, name, 'Scripts'));
          }
        } catch {
          /* ignore */
        }
      }
    }
    const pf = process.env.ProgramFiles;
    if (pf) {
      parts.push(path.join(pf, 'Python312'));
      parts.push(path.join(pf, 'Python311'));
      parts.push(path.join(pf, 'Python310'));
    }
  }
  return [...parts, existing ?? ''].filter(Boolean).join(path.delimiter);
}

function envWithPythonPathHints(): NodeJS.ProcessEnv {
  const cur =
    process.env.Path || process.env.PATH || '';
  const merged = augmentPathFragment(cur);
  return {
    ...process.env,
    Path: merged,
    PATH: merged,
  };
}

function tryWhich(cmd: string, env?: NodeJS.ProcessEnv): string | null {
  try {
    const result = cp.execSync(
      process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env ?? process.env,
      }
    );
    return result.toString().trim().split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

