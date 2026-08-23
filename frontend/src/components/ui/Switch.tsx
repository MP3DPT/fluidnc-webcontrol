interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  size?: 'sm';
  /** 'success' turns the track (and label, already green by default) green instead of the usual primary blue. */
  tone?: 'primary' | 'success';
  /** Where the label sits relative to the track - 'end' (default) matches the settings-list convention used elsewhere; 'start' reads label-then-switch, left to right. */
  labelPosition?: 'start' | 'end';
}

/**
 * A track+thumb toggle - a bare checkbox's checked state is too subtle to
 * read at a glance (no colour/symbol difference beyond a tiny native
 * checkmark). Still a real <input type="checkbox"> under the hood for
 * keyboard/screen-reader support; only the visual is replaced.
 */
export function Switch({ checked, onChange, label, size, tone = 'primary', labelPosition = 'end' }: SwitchProps) {
  const track = (
    <span className="switch-track">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-thumb" />
    </span>
  );
  const labelEl = label && <span className="switch-label">{label}</span>;

  return (
    <label
      className={`switch-row${checked ? ' switch-on' : ''}${size === 'sm' ? ' switch-sm' : ''}${tone === 'success' ? ' switch-success' : ''}`}
    >
      {labelPosition === 'start' ? (
        <>
          {labelEl}
          {track}
        </>
      ) : (
        <>
          {track}
          {labelEl}
        </>
      )}
    </label>
  );
}
