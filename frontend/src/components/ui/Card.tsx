import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Card renders as a <section> by default; pass 'div' when nesting inside another section-like landmark. */
  as?: 'section' | 'div';
}

export function Card({ children, className, as = 'section' }: CardProps) {
  const Tag = as;
  return <Tag className={`card${className ? ` ${className}` : ''}`}>{children}</Tag>;
}

interface CardHeaderProps {
  children: ReactNode;
  /** Optional right-aligned slot (e.g. toolbar buttons like [Fit] [Reset]). */
  actions?: ReactNode;
}

export function CardHeader({ children, actions }: CardHeaderProps) {
  return (
    <div className="card-header">
      <div className="card-title">{children}</div>
      {actions && <div className="card-header-actions">{actions}</div>}
    </div>
  );
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card-content${className ? ` ${className}` : ''}`}>{children}</div>;
}
