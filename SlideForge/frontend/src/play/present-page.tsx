import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import type { PlayManifest } from './types/slide';
import { SlidePlayer } from './components/SlidePlayer';
import { flattenManifestForPlayer } from './utils/flattenManifest';
import './play-page.css';

export default function PresentPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const [manifest, setManifest] = useState<PlayManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => new URLSearchParams(location.search), [location]);
  const autoPlay =
    query.get('autoplay') === '1' || query.get('autoplay') === 'true';
  const clean = query.get('clean') === '1' || query.get('clean') === 'true';
  const exporting =
    query.get('export') === '1' || query.get('export') === 'true';
  const forceTimelineClock =
    query.get('timelineClock') === '1' || query.get('timelineClock') === 'true';
  const showNativeCaption =
    !(query.get('nativeSub') === '0' || query.get('nativeSub') === 'false');

  useEffect(() => {
    const id = projectId ? Number(projectId) : NaN;
    if (!Number.isFinite(id)) {
      setErr('无效的项目 ID');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const json = await apiFetch<PlayManifest>(`/api/projects/${id}/play-manifest`);
        if (!cancelled) setManifest(json);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const flattened = useMemo(() => {
    if (!manifest?.pages?.length) return null;
    return flattenManifestForPlayer(manifest);
  }, [manifest]);

  if (loading) {
    return (
      <div className="sf-play-route-root sf-play-center-msg">
        <p className="sf-play-msg">加载放映数据…</p>
      </div>
    );
  }
  if (err) {
    return (
      <div className="sf-play-route-root sf-play-center-msg">
        <p className="sf-play-msg sf-play-err">{err}</p>
      </div>
    );
  }
  if (!manifest?.pages?.length || !flattened?.steps.length) {
    return (
      <div className="sf-play-route-root sf-play-center-msg">
        <p className="sf-play-msg">没有可放映的分段。</p>
      </div>
    );
  }

  return (
    <div
      className={`sf-play-route-root sf-play-present${
        clean ? ' sf-play-clean' : ''
      }${exporting ? ' sf-play-export' : ''}`}
    >
      <SlidePlayer
        deckTitle={manifest.title}
        slide={flattened}
        autoPlay={autoPlay}
        /** 导出默认改为音频驱动；必要时可用 ?timelineClock=1 回退旧行为 */
        useTimelineClock={forceTimelineClock}
        showNativeCaption={showNativeCaption}
        exportMode={exporting}
      />
    </div>
  );
}
