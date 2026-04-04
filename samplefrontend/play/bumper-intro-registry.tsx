import type { ReactNode } from 'react';

/** 与后端 project_meta.DEFAULT_INTRO_STYLE_ID、__sfmeta.intro_style_id 对齐（库中仅存样式 id，非 HTML）。 */
export const DEFAULT_INTRO_STYLE_ID = 1;

export type BumperIntroRenderProps = {
  projectName: string;
};

function IntroStyle01HeroTitle({ projectName }: BumperIntroRenderProps) {
  const name = projectName.trim() || '未命名项目';
  return (
    <h1
      style={{
        margin: 0,
        fontSize: 'clamp(1.75rem, 5.5vw, 3.25rem)',
        fontWeight: 700,
        lineHeight: 1.15,
        maxWidth: 'min(92vw, 38rem)',
        color: '#0f172a',
      }}
    >
      {name}
    </h1>
  );
}

const REGISTRY: Record<number, (p: BumperIntroRenderProps) => ReactNode> = {
  1: (p) => <IntroStyle01HeroTitle {...p} />,
};

/** 片尾无 logo.mp4（或加载失败）时的默认画面：白底黑字，与片头同为纯 HTML。 */
export function renderBumperOutro({ projectName }: BumperIntroRenderProps): ReactNode {
  const name = projectName.trim();
  return (
    <>
      <p
        style={{
          margin: 0,
          fontSize: '0.7rem',
          letterSpacing: '0.28em',
          color: '#64748b',
          textTransform: 'uppercase',
        }}
      >
        感谢观看
      </p>
      <h1
        style={{
          margin: '1rem 0 0',
          fontSize: 'clamp(1.5rem, 4.5vw, 2.75rem)',
          fontWeight: 600,
          lineHeight: 1.2,
          maxWidth: 'min(92vw, 36rem)',
          color: '#0f172a',
        }}
      >
        {name || '演示已结束'}
      </h1>
    </>
  );
}

/** 按 id 渲染片头主体；未知 id 回退到样式 1。新增样式在此表注册即可。 */
export function renderBumperIntro(
  styleId: number,
  props: BumperIntroRenderProps,
): ReactNode {
  const id = Number.isFinite(styleId) && styleId >= 1 ? Math.floor(styleId) : DEFAULT_INTRO_STYLE_ID;
  const render = REGISTRY[id] ?? REGISTRY[DEFAULT_INTRO_STYLE_ID];
  return render(props);
}
