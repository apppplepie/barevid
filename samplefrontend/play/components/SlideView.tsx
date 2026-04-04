import type { ReactNode } from "react";
import "./slide-view.css";

export function SlideView({
  deckTitle,
  children,
  footer,
}: {
  deckTitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="sf-slide-view">
      <div className="sf-slide-container">
        <header className="sf-slide-deck-title">{deckTitle}</header>
        <div className="sf-slide-stage">{children}</div>
        {footer ? <footer className="sf-slide-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
