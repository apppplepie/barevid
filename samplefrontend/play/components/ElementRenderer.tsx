import type { StepAction } from "../types/slide";

const animClass: Record<string, string> = {
  "fade-in": "sf-anim-fade-in",
  "slide-up": "sf-anim-slide-up",
  "slide-left": "sf-anim-slide-left",
  "zoom-in": "sf-anim-zoom-in",
};

export function ElementRenderer({ action }: { action: StepAction }) {
  if (action.type !== "add" && action.type !== "update") return null;
  const anim =
    action.animation && animClass[action.animation]
      ? animClass[action.animation]
      : "";
  return (
    <div className={anim ? `sf-el ${anim}` : "sf-el"} data-target={action.target ?? ""}>
      {action.content ?? ""}
    </div>
  );
}
