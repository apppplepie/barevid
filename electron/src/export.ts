/**
 * export.ts
 * 管理本地视频导出任务。
 *
 * 每个导出任务：
 *   1. 调用 export_video.py（或打包后的 worker.exe）作为子进程
 *   2. 输出存到 ~/Videos/Barevid/ 目录
 *   3. 状态通过 getStatus() 轮询，完成后通知 renderer
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app, BrowserWindow, shell } from 'electron';
import { getBrowsersPath } from './checker';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface ExportJob {
  job_id: number;
  project_id: number;
  status: JobStatus;
  output_url?: string;   // 本地文件路径（done 时填）
  error_message?: string | null;
  started_at?: number;
  finished_at?: number;
  proc?: cp.ChildProcess;
}

let _nextJobId = 1;
const _jobs = new Map<number /* pid */, ExportJob>();

export class ExportManager {
  private ffmpegPath: string;
  private pythonOrWorker: string;
  private exportScript: string;
  private frontendUrl: string;
  private backendUrl: string;

  constructor(opts: {
    ffmpegPath: string;
    pythonOrWorker: string;
    exportScript: string;
    frontendUrl: string;
    backendUrl: string;
  }) {
    this.ffmpegPath = opts.ffmpegPath;
    this.pythonOrWorker = opts.pythonOrWorker;
    this.exportScript = opts.exportScript;
    this.frontendUrl = opts.frontendUrl;
    this.backendUrl = opts.backendUrl;
  }

  /** 把一个导出任务排入队列并立刻开始，返回 job_id */
  enqueue(projectId: number, params: Record<string, unknown>): number {
    // 同一项目已有运行中的任务，直接返回该 job
    const existing = _jobs.get(projectId);
    if (existing && (existing.status === 'queued' || existing.status === 'running')) {
      return existing.job_id;
    }

    const jobId = _nextJobId++;
    const job: ExportJob = {
      job_id: jobId,
      project_id: projectId,
      status: 'queued',
    };
    _jobs.set(projectId, job);

    // 异步启动，不 await
    this._run(job, params).catch((err) => {
      job.status = 'failed';
      job.error_message = String(err);
      job.finished_at = Date.now();
    });

    return jobId;
  }

  getStatus(projectId: number): ExportJob | undefined {
    const job = _jobs.get(projectId);
    if (!job) return undefined;

    // 不暴露内部 proc 给外部
    const { proc: _proc, ...safe } = job;
    return safe as ExportJob;
  }

  getOutputPath(projectId: number): string | undefined {
    return _jobs.get(projectId)?.output_url;
  }

  cancel(projectId: number): boolean {
    const job = _jobs.get(projectId);
    if (!job || !job.proc) return false;

    job.proc.kill('SIGTERM');
    job.status = 'cancelled';
    job.finished_at = Date.now();
    return true;
  }

  private async _run(
    job: ExportJob,
    _params: Record<string, unknown>
  ): Promise<void> {
    const outputDir = getOutputDir();
    fs.mkdirSync(outputDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(outputDir, `project_${job.project_id}_${ts}.mp4`);
    const browsersPath = getBrowsersPath();

    const isWorkerExe = this.pythonOrWorker.endsWith('worker.exe');
    const cmd = isWorkerExe ? this.pythonOrWorker : this.pythonOrWorker;
    const args = buildArgs({
      isWorkerExe,
      exportScript: this.exportScript,
      projectId: job.project_id,
      outputFile: outFile,
      frontendUrl: this.frontendUrl,
      backendUrl: this.backendUrl,
    });

    job.status = 'running';
    job.started_at = Date.now();

    await new Promise<void>((resolve, reject) => {
      const proc = cp.spawn(cmd, args, {
        env: {
          ...process.env,
          FFMPEG_PATH: this.ffmpegPath,
          PLAYWRIGHT_BROWSERS_PATH: browsersPath,
          // export_video.py 通过这个知道要读哪个 project
          SLIDEFORGE_EXPORT_AUTHORIZATION: '',
        },
        windowsHide: true,
      });

      job.proc = proc;

      proc.stdout?.on('data', (d) =>
        broadcastLog(job.project_id, d.toString())
      );
      proc.stderr?.on('data', (d) =>
        broadcastLog(job.project_id, d.toString())
      );

      proc.on('close', (code) => {
        job.finished_at = Date.now();
        delete job.proc;

        if (code === 0 && fs.existsSync(outFile)) {
          job.status = 'succeeded';
          job.output_url = outFile;
          // 导出完成：在文件管理器里高亮
          shell.showItemInFolder(outFile);
          notifyRenderer('export:done', { projectId: job.project_id, filePath: outFile });
          resolve();
        } else if (job.status !== 'cancelled') {
          job.status = 'failed';
          job.error_message = `export_video.py 退出码 ${code}`;
          notifyRenderer('export:failed', { projectId: job.project_id, error: job.error_message });
          reject(new Error(job.error_message));
        } else {
          resolve();
        }
      });

      proc.on('error', (err) => {
        job.status = 'failed';
        job.error_message = err.message;
        job.finished_at = Date.now();
        delete job.proc;
        reject(err);
      });
    });
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function getOutputDir(): string {
  return path.join(os.homedir(), 'Videos', 'Barevid');
}

function buildArgs(opts: {
  isWorkerExe: boolean;
  exportScript: string;
  projectId: number;
  outputFile: string;
  frontendUrl: string;
  backendUrl: string;
}): string[] {
  const scriptArgs = [
    '--project-id', String(opts.projectId),
    '--output', opts.outputFile,
    '--frontend-url', opts.frontendUrl,
    '--api-url', opts.backendUrl,
  ];

  // PyInstaller exe 不需要 "python export_video.py"，直接传子命令
  if (opts.isWorkerExe) {
    return ['export', ...scriptArgs];
  }
  return [opts.exportScript, ...scriptArgs];
}

/** 向所有 BrowserWindow 广播日志 */
function broadcastLog(projectId: number, line: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('export:log', { projectId, line });
  }
}

/** 向所有 BrowserWindow 发送通知 */
function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}
