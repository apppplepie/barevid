/**
 * server.ts
 * 在 Electron 主进程里跑一个本地 HTTP server：
 *  - 静态文件服务：serve SlideForge/frontend/dist（SPA fallback 到 index.html）
 *  - API 代理：/api/* 和 /media/* 透传到云端后端
 *  - 导出拦截：POST /api/projects/:id/export-video 由本地 worker 接管
 *
 * 返回实际监听的端口号。
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express, { Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { ExportManager } from './export';

/** 代理目标只能是 origin，若误写成 http://host:port/api 会导致路径变成 /api/api/... */
function normalizeBackendProxyTarget(raw: string): string {
  const s = (raw || '').trim();
  if (!s) {
    return 'http://127.0.0.1:8000';
  }
  try {
    const withProto = s.includes('://') ? s : `http://${s}`;
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s;
  }
}

/** 前端 dist 目录（打包后在 extraResources/frontend，开发时在源码目录） */
function getFrontendDist(): string {
  const bundled = path.join(process.resourcesPath ?? '', 'frontend');
  if (fs.existsSync(bundled)) return bundled;

  // 开发时：相对于本文件位置找
  return path.resolve(__dirname, '../../SlideForge/frontend/dist');
}

/** 与 FastAPI `GET /api/projects/:id` 一致，供本地导出响应带上 pipeline，避免前端把阶段状态清空 */
async function fetchProjectPipelineStages(
  apiOrigin: string,
  projectId: number,
  authorization: string
): Promise<{
  outline: boolean;
  audio: boolean;
  deck: boolean;
  video: boolean;
}> {
  const fallback = {
    outline: true,
    audio: true,
    deck: true,
    video: false,
  };
  const auth = authorization.trim();
  if (!auth) return fallback;
  try {
    const url = `${apiOrigin.replace(/\/$/, '')}/api/projects/${projectId}`;
    const r = await fetch(url, {
      headers: {
        Authorization: auth,
        Accept: 'application/json',
      },
    });
    if (!r.ok) return fallback;
    const data = (await r.json()) as { pipeline?: Record<string, unknown> };
    const pl = data.pipeline;
    if (!pl || typeof pl !== 'object') return fallback;
    return {
      outline: Boolean(pl.outline),
      audio: Boolean(pl.audio),
      deck: Boolean(pl.deck),
      video: Boolean(pl.video),
    };
  } catch {
    return fallback;
  }
}

export interface LocalServer {
  port: number;
  close: () => Promise<void>;
}

export interface StartLocalServerOptions {
  /** 若指定，在此端口监听本地 Express（否则随机端口） */
  listenPort?: number;
}

export async function startLocalServer(
  backendUrl: string,
  exportManager: ExportManager,
  opts?: StartLocalServerOptions
): Promise<LocalServer> {
  const expressApp = express();

  const distDir = getFrontendDist();
  const proxyTarget = normalizeBackendProxyTarget(backendUrl);

  // ── 1. 拦截导出请求，交给本地 ExportManager ──────────────────────────────
  //    勿对全部 /api 使用 express.json()：会消费请求体，导致后续代理转发 POST（注册/登录等）时 body 为空并卡死。
  //    POST /api/projects/:pid/export-video
  expressApp.post(
    '/api/projects/:pid/export-video',
    express.json(),
    async (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const body = req.body as Record<string, unknown>;
      const authorization =
        typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : '';

      const pipeline = await fetchProjectPipelineStages(
        proxyTarget,
        pid,
        authorization
      );

      const jobId = exportManager.enqueue(pid, body, { authorization });
      // 与 SlideForge ExportVideoResponse 对齐，否则前端会把 pipeline 当成全 false
      res.json({
        output_url: '',
        action: 'queued',
        pipeline,
        export_job_id: jobId,
        video_exported_at: null,
      });
    }
  );

  //    GET /api/projects/:pid/export-video/status
  expressApp.get(
    '/api/projects/:pid/export-video/status',
    (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const status = exportManager.getStatus(pid);
      if (!status) {
        res.status(404).json({ error: 'no export job for this project' });
        return;
      }
      res.json(status);
    }
  );

  //    GET /api/projects/:pid/export-video/download  （导出完成后下载本地文件）
  expressApp.get(
    '/api/projects/:pid/export-video/download',
    (req: Request, res: Response) => {
      const pid = Number(req.params.pid);
      const filePath = exportManager.getOutputPath(pid);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).json({ error: '文件不存在或导出未完成' });
        return;
      }
      res.download(filePath);
    }
  );

  // ── 2. 其余 /api 和 /media 代理到后端 ─────────────────────────────────────
  // 注意：不能用 app.use('/api', proxy) 挂载 —— Express 会剥掉 /api，导致转发成 /auth/... 而非 /api/auth/...，FastAPI 返回 404。
  expressApp.use(
    createProxyMiddleware({
      target: proxyTarget,
      changeOrigin: true,
      pathFilter: ['/api', '/media'],
      on: {
        error(_err, _req, res) {
          const r = res as http.ServerResponse;
          if (r.headersSent) return;
          r.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
          r.end(
            JSON.stringify({
              detail:
                `无法连接后端 ${proxyTarget}。请确认 FastAPI 已在本机运行（未捆绑 exe 时一般为 uvicorn 127.0.0.1:8000），` +
                '且「后端 URL」不要填成与 Electron 页面相同的端口。',
            })
          );
        },
      },
    })
  );

  // ── 3. 静态前端文件 + SPA fallback ──────────────────────────────────────
  if (fs.existsSync(distDir)) {
    expressApp.use(express.static(distDir));

    // 所有未匹配路由返回 index.html（history routing）
    expressApp.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    expressApp.get('*', (_req: Request, res: Response) => {
      res.status(503).send(
        `前端尚未构建。请先运行 npm run build:frontend。<br>期望路径：${distDir}`
      );
    });
  }

  // ── 4. 监听端口（可指定，便于与捆绑 API 的 EXPORT_FRONTEND_URL 对齐）────────
  const port =
    typeof opts?.listenPort === 'number' && opts.listenPort > 0
      ? opts.listenPort
      : await getFreePort();
  const server = http.createServer(expressApp);

  await new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  return {
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('无法获取随机端口'));
        return;
      }
      srv.close(() => resolve(addr.port));
    });
  });
}
