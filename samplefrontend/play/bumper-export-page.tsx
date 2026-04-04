import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { apiFetch, apiUrl } from '../api';
import { renderBumperIntro, renderBumperOutro } from './bumper-intro-registry';
import './play-page.css';

/**
 * 导出专用片头/片尾占位页：与放映页相同 viewport 下由 Playwright 录制。
 * 片头：projects.description 里 __sfmeta 只存 intro_style_id（数字），不存 HTML；实际画面由 bumper-intro-registry 按 id 渲染。
 * 片尾：优先全屏播放 storage/logo/logo.mp4（经 /media/logo/logo.mp4）；缺失或加载失败时回退为白底黑字 HTML（见 renderBumperOutro）。成片音轨见 export_video.py + logo/logo.mp3。
 * URL: /play/:projectId/bumper/:kind?export=1&clean=1&durationMs=3000
 */
export default function BumperExportPage() {
  const { projectId, kind } = useParams<{ projectId: string; kind: string }>();
  const [searchParams] = useSearchParams();
  const [outroVideoFailed, setOutroVideoFailed] = useState(false);
  /** null：仍在拉取 /api/projects，避免先用空串渲染出「未命名项目」再跳变 */
  const [bumperProjectName, setBumperProjectName] = useState<string | null>(null);
  const [introStyleId, setIntroStyleId] = useState(1);

  const exporting =
    searchParams.get('export') === '1' || searchParams.get('export') === 'true';

  const durationMs = useMemo(() => {
    const raw = Number(searchParams.get('durationMs') || searchParams.get('duration_ms'));
    if (!Number.isFinite(raw)) return 3000;
    return Math.min(300_000, Math.max(500, Math.round(raw)));
  }, [searchParams]);

  const label = kind === 'outro' ? '片尾' : '片头';
  const isOutro = kind === 'outro';
  const explicitOutroVideo = (searchParams.get('outroVideo') || '').trim();
  const outroVideoSrc = useMemo(
    () => (isOutro ? apiUrl(explicitOutroVideo || '/media/logo/logo.mp4') : ''),
    [explicitOutroVideo, isOutro],
  );
  const showOutroVideo = isOutro && !outroVideoFailed;
  const isIntro = kind === 'intro';

  useEffect(() => {
    if (!isIntro && !isOutro) return;
    if (!projectId) {
      setBumperProjectName('');
      return;
    }
    let cancelled = false;
    setBumperProjectName(null);
    (async () => {
      try {
        const data = await apiFetch<{
          project: { name: string; intro_style_id?: number };
        }>(`/api/projects/${projectId}`);
        if (cancelled) return;
        setBumperProjectName(data.project?.name ?? '');
        if (isIntro) {
          const sid = data.project?.intro_style_id;
          setIntroStyleId(typeof sid === 'number' && sid >= 1 ? sid : 1);
        }
      } catch {
        if (!cancelled) {
          setBumperProjectName('');
          if (isIntro) setIntroStyleId(1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isIntro, isOutro, projectId]);

  useEffect(() => {
    if (!exporting) return;
    let cancelled = false;
    let timeoutId: number | undefined;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      const w = window as Window & {
        __SLIDEFORGE_EXPORT_STARTED_AT_MS?: number;
        __SLIDEFORGE_EXPORT_DONE_AT_MS?: number;
      };
      w.__SLIDEFORGE_EXPORT_STARTED_AT_MS = Math.round(performance.now());
      delete w.__SLIDEFORGE_EXPORT_DONE_AT_MS;
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        w.__SLIDEFORGE_EXPORT_DONE_AT_MS = Math.round(performance.now());
      }, durationMs);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [exporting, durationMs]);

  return (
    <div
      className="sf-play-route-root sf-play-present sf-play-clean sf-play-export"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        background: showOutroVideo
          ? '#000'
          : isOutro
            ? '#ffffff'
            : isIntro
              ? '#ffffff'
              : 'var(--sf-bumper-mid-bg)',
        color:
          isOutro && !showOutroVideo
            ? '#0f172a'
            : isIntro
              ? '#0f172a'
              : 'var(--sf-bumper-mid-fg)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* 满足 export_video.py 中 Playwright 就绪检测：.sf-play-main-body + .sf-controls audio */}
      <div
        className="sf-play-main-body sf-export-bumper-body"
        style={{
          position: 'relative',
          flex: 1,
          minHeight: '100vh',
          width: '100%',
          textAlign: 'center',
          ...(showOutroVideo
            ? { padding: 0, display: 'block' }
            : {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 1rem',
                boxSizing: 'border-box',
                ...(isOutro || isIntro ? { background: '#ffffff' } : {}),
              }),
        }}
      >
        {showOutroVideo ? (
          <video
            src={outroVideoSrc}
            className="sf-bumper-outro-video"
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onError={() => setOutroVideoFailed(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : null}
        {!showOutroVideo && isIntro && bumperProjectName !== null
          ? renderBumperIntro(introStyleId, { projectName: bumperProjectName })
          : null}
        {!showOutroVideo && isOutro && bumperProjectName !== null ? (
          <>
            <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.2em', color: '#94a3b8' }}>
              SLIDEFORGE
            </p>
            {renderBumperOutro({ projectName: bumperProjectName })}
          </>
        ) : null}
        {!showOutroVideo && !isIntro && !isOutro ? (
          <>
            <p style={{ margin: 0, fontSize: '0.75rem', letterSpacing: '0.2em', color: '#64748b' }}>
              SLIDEFORGE
            </p>
            <h1 style={{ margin: '0.75rem 0 0', fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', fontWeight: 600 }}>
              {label}
            </h1>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem', color: '#94a3b8' }}>
              可在本页替换为品牌 HTML / 嵌入视频
            </p>
          </>
        ) : null}
      </div>
      <div className="sf-controls" aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        <audio />
      </div>
    </div>
  );
}
