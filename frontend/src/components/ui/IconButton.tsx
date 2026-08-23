import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  'aria-label': string;
}

/** A square icon-only control (header actions, toolbar buttons) - consistent size/hover/focus regardless of where it's used. */
export function IconButton({ children, className, ...rest }: IconButtonProps) {
  return (
    <button className={`icon-button${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
