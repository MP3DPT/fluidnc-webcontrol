interface AxisValue {
  label: string;
  value: number | null;
  precision?: number;
}

interface Props {
  axes: AxisValue[];
  unit?: string;
  /** 'lg' for the primary work-position readout; 'sm' for a denser secondary line (e.g. machine coordinates). */
  size?: 'sm' | 'lg';
}

/**
 * The one place machine coordinates get rendered - tabular-nums monospace
 * so digits don't visually jump as values update, with the axis letter as
 * a small label above the number (spec: "the numbers should immediately
 * attract the eye").
 */
export function CoordinateDisplay({ axes, unit = 'mm', size = 'lg' }: Props) {
  return (
    <div className={`coord-display coord-display-${size}`}>
      {axes.map((axis) => (
        <div className="coord-axis" key={axis.label}>
          <span className="coord-axis-label">{axis.label}</span>
          <span className="coord-axis-value">
            {axis.value === null ? '—' : axis.value.toFixed(axis.precision ?? 3)}
            {axis.value !== null && size === 'lg' && <span className="coord-axis-unit">{unit}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
