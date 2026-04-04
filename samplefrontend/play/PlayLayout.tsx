import { Link, Outlet, useLocation } from "react-router-dom";
import { useMemo } from "react";
import "./play-layout.css";
import "./play-theme-light.css";

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

  const hideChrome = flags.clean || flags.exporting;

  return (
    <div
      className={`sf-play-app${flags.exporting ? " sf-play-layout--export" : ""}${hideChrome ? " sf-play-layout--chrome-hidden" : ""}`}
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
