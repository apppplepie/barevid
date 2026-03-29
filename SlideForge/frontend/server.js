import express from 'express';
import path from 'path';
import {Readable} from 'stream';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');
const port = Number.parseInt(process.env.PORT || '3000', 10);
const backendTarget = (process.env.API_PROXY_TARGET || 'http://127.0.0.1:8000').replace(/\/$/, '');

const app = express();

app.disable('x-powered-by');

function copyUpstreamHeaders(upstreamHeaders, res) {
  for (const [key, value] of upstreamHeaders.entries()) {
    const lower = key.toLowerCase();
    if (lower === 'connection' || lower === 'transfer-encoding') continue;
    res.setHeader(key, value);
  }
}

async function proxyToBackend(req, res) {
  const upstreamUrl = `${backendTarget}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (key.toLowerCase() === 'host') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('x-forwarded-host', req.headers.host || '');
  headers.set('x-forwarded-proto', req.protocol);
  headers.set('x-forwarded-for', req.ip || '');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
    });
    res.status(upstream.status);
    copyUpstreamHeaders(upstream.headers, res);
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    console.error('proxy request failed', error);
    res.status(502).json({detail: 'upstream backend unavailable'});
  }
}

app.use(['/api', '/media'], (req, res) => {
  void proxyToBackend(req, res);
});

app.use(express.static(distDir, {index: false, maxAge: '1h'}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`slideforge frontend listening on ${port}`);
});
