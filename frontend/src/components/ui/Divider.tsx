export function Divider({ className }: { className?: string }) {
  return <div className={`divider${className ? ` ${className}` : ''}`} />;
}
