import { Link, Outlet, useLocation } from "react-router-dom";
import { useMemo } from "react";
import "./play-layout.css";

export function PlayLayout() {
  const location = useLocation();
  const flags = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return {
      clean:
        q.get("clean") === "1" || q.get("clean") === "true",
      exporting:
        q.get("export") === "1" || q.get("export") === "true",
    };
  }, [location.search]);

  /** 公开分享链接 /share/:token：与录屏导出页一致，全屏、无顶栏 */
  const sharePresentation = location.pathname.startsWith("/share/");

  const hideChrome = flags.clean || flags.exporting || sharePresentation;
  const exportLayout = flags.exporting || sharePresentation;

  return (
    <div
      className={`sf-play-app${exportLayout ? " sf-play-layout--export" : ""}${hideChrome ? " sf-play-layout--chrome-hidden" : ""}`}
    >
      {!hideChrome ? (
        <header className="sf-play-app-header">
          <span className="sf-play-app-title">放映</span>
          <Link to="/" className="sf-play-app-back">
            ← 返回
          </Link>
        </header>
      ) : null}
      <main className="sf-play-app-main">
        <Outlet />
      </main>
    </div>
  );
}
