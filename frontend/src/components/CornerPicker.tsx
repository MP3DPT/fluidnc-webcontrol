type Side = 'home' | 'far';

interface Props {
  x: Side;
  y: Side;
  onChange: (x: Side, y: Side) => void;
}

/**
 * 2x2 corner picker for Park's X/Y target - visually the same language as
 * the Surfacing/Facing plugin's own origin picker (bottom-left first,
 * active dot filled), but a plain React component here since this lives in
 * the main app, not a plugin's sandboxed iframe. The (home, home) corner -
 * literally machine (0,0), wherever the homing switches are - is marked
 * with a small "H" so it reads as a fixed reference point, not just an
 * arbitrary 4th option.
 */
export function CornerPicker({ x, y, onChange }: Props) {
  const positions: { x: Side; y: Side; col: number; row: number }[] = [
    { x: 'home', y: 'far', col: 1, row: 1 },
    { x: 'far', y: 'far', col: 2, row: 1 },
    { x: 'home', y: 'home', col: 1, row: 2 },
    { x: 'far', y: 'home', col: 2, row: 2 },
  ];

  return (
    <div className="corner-picker">
      {positions.map((pos) => {
        const isHome = pos.x === 'home' && pos.y === 'home';
        const isActive = pos.x === x && pos.y === y;
        return (
          <button
            key={`${pos.x}-${pos.y}`}
            type="button"
            className={`corner-dot${isHome ? ' corner-dot-home' : ''}${isActive ? ' active' : ''}`}
            style={{ gridColumn: pos.col, gridRow: pos.row }}
            title={isHome ? 'Machine home (0,0)' : `${pos.x === 'far' ? 'Far' : 'Home'} X, ${pos.y === 'far' ? 'far' : 'home'} Y`}
            onClick={() => onChange(pos.x, pos.y)}
          />
        );
      })}
    </div>
  );
}
