type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// A plain right-angle bracket (viewfinder/crop-corner style) - deliberately
// not an arrow icon. An arrow implies "move in this direction"; these
// buttons instead mean "go to this specific corner", and a directional
// arrow was reported as confusing for that (see ParkCluster).
const PATHS: Record<Corner, string> = {
  'top-left': 'M4 11 L4 4 L11 4',
  'top-right': 'M20 11 L20 4 L13 4',
  'bottom-left': 'M4 13 L4 20 L11 20',
  'bottom-right': 'M20 13 L20 20 L13 20',
};

export function CornerBracket({ corner, size = 16 }: { corner: Corner; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[corner]} />
    </svg>
  );
}
