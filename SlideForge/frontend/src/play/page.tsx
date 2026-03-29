import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../api';
import type { PlayManifest } from './types/slide';
import { SlidePlayer } from './components/SlidePlayer';
import { flattenManifestForPlayer } from './utils/flattenManifest';
import './play-page.css';

export default function PlayPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [manifest, setManifest] = useState<PlayManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        <Link to="/" className="sf-play-back">
          返回首页
        </Link>
      </div>
    );
  }
  if (!manifest?.pages?.length || !flattened?.steps.length) {
    return (
      <div className="sf-play-route-root sf-play-center-msg">
        <p className="sf-play-msg">没有可放映的分段。</p>
        <Link to="/" className="sf-play-back">
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="sf-play-route-root sf-play-debug">
      <SlidePlayer
        deckTitle={manifest.title}
        slide={flattened}
        hideDeckNarrationChrome={false}
      />
    </div>
  );
}
