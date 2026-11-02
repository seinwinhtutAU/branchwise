// ── Little pictures for the route map, drawn around (0, 0) ──────────────────────

/** The supplier is a factory: a saw-tooth roof and a chimney. */
export function FactoryGlyph(): React.JSX.Element {
  return (
    <g>
      <rect x="7" y="-14" width="5" height="10" fill="#fff" />
      <path d="M-13 12 V-3 L-4 -8 V-3 L5 -8 V-3 L13 -3 V12 Z" fill="#fff" />
      <g fill="var(--color-journey-supplier)">
        <rect x="-9" y="2" width="4" height="4" />
        <rect x="-2" y="2" width="4" height="4" />
        <rect x="5" y="2" width="4" height="4" />
      </g>
    </g>
  );
}

export function PinGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <g fill={color}>
      <path d="M0 -12 a9 9 0 0 1 9 9 c0 7 -9 15 -9 15 c0 0 -9 -8 -9 -15 a9 9 0 0 1 9 -9 z" />
      <circle cx="0" cy="-3" r="3.4" fill="var(--color-bg-base)" />
    </g>
  );
}

/** A receiving gate is a warehouse: a low roof over a roll-up door. `door` is what shows
 *  through it (the colour of the circle behind). */
export function WarehouseGlyph({
  color,
  door,
}: {
  color: string;
  door: string;
}): React.JSX.Element {
  return (
    <g>
      <path d="M-14 12 V-3 L0 -10 L14 -3 V12 Z" fill={color} />
      <rect x="-8" y="0" width="16" height="12" fill={door} />
      <path
        d="M-8 3.5 H8 M-8 7 H8 M-8 10.5 H8"
        stroke={color}
        strokeWidth="1.3"
      />
    </g>
  );
}

export function TruckGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <g fill={color}>
      <rect x="-9" y="-6" width="11" height="9" rx="1.5" />
      <path d="M3 -3 H7 L10 0 V3 H3 Z" />
      <circle
        cx="-4"
        cy="4"
        r="2.2"
        fill="var(--color-bg-base)"
        stroke={color}
        strokeWidth="1.4"
      />
      <circle
        cx="6"
        cy="4"
        r="2.2"
        fill="var(--color-bg-base)"
        stroke={color}
        strokeWidth="1.4"
      />
    </g>
  );
}

export function PackageGlyph({ color }: { color: string }): React.JSX.Element {
  return (
    <g fill={color}>
      <path d="M-9 -4 L0 -9 L9 -4 V7 L0 11 L-9 7 Z" />
      <path
        d="M-9 -4 L0 1 L9 -4 M0 1 V11"
        fill="none"
        stroke="var(--color-bg-base)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** A small rounded label sitting on the map. */
export function Bubble({
  x,
  y,
  text,
  fill,
  stroke,
  color,
}: {
  x: number;
  y: number;
  text: string;
  fill: string;
  stroke: string;
  color: string;
}): React.JSX.Element {
  const width = Math.max(40, text.length * 5.7 + 10);
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - 9}
        width={width}
        height={18}
        rx={9}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.75}
      />
      <text
        x={x}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={10}
        fill={color}
        fontWeight={500}
      >
        {text}
      </text>
    </g>
  );
}
