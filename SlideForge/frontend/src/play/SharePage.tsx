/**
 * SharePage.tsx
 * 公开分享放映页：/share/:token
 * 无需登录，通过 token 获取 manifest，手动翻页放映。
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PlayManifest } from './types/slide';
import { SlidePlayer } from './components/SlidePlayer';
import { flattenManifestForPlayer } from './utils/flattenManifest';
import './play-page.css';

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [manifest, setManifest] = useState<PlayManifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setErr('无效的分享链接');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);

    void (async () => {
      try {
        const res = await fetch(`${apiBase()}/api/share/${token}/manifest`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { detail?: string };
          throw new Error(body.detail ?? `请求失败 (${res.status})`);
        }
        const json = await res.json() as PlayManifest;
        if (!cancelled) setManifest(json);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

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
        <p className="sf-play-msg">没有可放映的内容。</p>
      </div>
    );
  }

  return (
    <div className="sf-play-route-root sf-play-present">
      <SlidePlayer
        deckTitle={manifest.title}
        slide={flattened}
        autoPlay={false}
        manualMode={true}
        showNativeCaption={false}
        exportMode={false}
      />
    </div>
  );
}
