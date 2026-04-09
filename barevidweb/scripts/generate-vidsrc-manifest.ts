/**
 * Scans public/vidsrc for video files and writes manifest.json.
 * Browsers cannot list directories — the app loads this manifest at runtime.
 * Each entry uses your file name as `file`; the UI shows the same base name (no extension).
 *
 * Run: npm run vidsrc:manifest — also runs before dev/build via predev/prebuild.
 * Docker (nginx 镜像): docker-entrypoint.sh 在启动时扫描挂载的 vidsrc 并写入 /run/barevid，
 * 由 nginx 提供 /vidsrc/manifest.json，无需在宿主机执行本脚本。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type VidsrcManifestVideo = { file: string };

export type VidsrcManifest = {
  generated: string;
  videos: VidsrcManifestVideo[];
};

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const vidsrcDir = path.join(projectRoot, 'public', 'vidsrc');
const outFile = path.join(vidsrcDir, 'manifest.json');

if (!fs.existsSync(vidsrcDir)) {
  fs.mkdirSync(vidsrcDir, { recursive: true });
}

const names = fs.readdirSync(vidsrcDir).filter((name) => {
  if (name === 'manifest.json' || name.startsWith('.')) return false;
  return VIDEO_EXT.test(name);
});

names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

const manifest: VidsrcManifest = {
  generated: new Date().toISOString(),
  videos: names.map((file) => ({ file })),
};

fs.writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[vidsrc] wrote ${names.length} video(s) -> ${path.relative(projectRoot, outFile)}`);
