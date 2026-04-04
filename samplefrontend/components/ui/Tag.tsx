import type { ReactNode } from 'react';

export type TagVariant =
  | 'neutral'
  | 'success'
  | 'ready'
  | 'info'
  | 'warning'
  | 'danger'
  | 'violet';

type TagProps = {
  variant?: TagVariant;
  className?: string;
  title?: string;
  children: ReactNode;
};

const TAG_VARIANT_CLASS: Record<TagVariant, string> = {
  neutral: 'sf-chip-neutral',
  success: 'sf-pipeline-chip sf-pipeline-video',
  ready: 'sf-pipeline-chip sf-pipeline-ready',
  info: 'sf-pipeline-chip sf-pipeline-queue',
  warning: 'sf-pipeline-chip sf-pipeline-busy',
  danger: 'sf-pipeline-chip sf-pipeline-failed',
  violet: 'sf-deck-master-badge sf-deck-master-reused',
};

export function Tag({
  variant = 'neutral',
  className = '',
  title,
  children,
}: TagProps) {
  const classes = [
    'inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium leading-tight',
    TAG_VARIANT_CLASS[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
