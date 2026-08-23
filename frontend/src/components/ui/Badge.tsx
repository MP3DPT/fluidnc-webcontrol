import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  /** Adds a pulsing ring - reserve for states that need active attention (Running, Alarm). */
  pulse?: boolean;
  className?: string;
}

/** A labeled pill with a leading status dot - the one status-communication pattern used everywhere in the app. */
export function Badge({ tone = 'neutral', children, pulse, className }: BadgeProps) {
  return (
    <span className={`badge badge-${tone}${pulse ? ' badge-pulse' : ''}${className ? ` ${className}` : ''}`}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}
