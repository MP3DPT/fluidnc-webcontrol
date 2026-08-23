interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  size?: 'sm';
}

/**
 * A track+thumb toggle - a bare checkbox's checked state is too subtle to
 * read at a glance (no colour/symbol difference beyond a tiny native
 * checkmark). Still a real <input type="checkbox"> under the hood for
 * keyboard/screen-reader support; only the visual is replaced.
 */
export function Switch({ checked, onChange, label, size }: SwitchProps) {
  return (
    <label className={`switch-row${checked ? ' switch-on' : ''}${size === 'sm' ? ' switch-sm' : ''}`}>
      <span className="switch-track">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-thumb" />
      </span>
      {label && <span className="switch-label">{label}</span>}
    </label>
  );
}
