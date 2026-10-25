function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function colorForName(name) {
  const h = hash(String(name));
  const hue = h % 360;
  const sat = 55 + ((h >>> 9) % 16); // 55..70
  const light = 45 + ((h >>> 17) % 11); // 45..55
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

const SKIN = '#f2c79b';
const R = (x, y, w, h, fill) => <rect x={x} y={y} width={w} height={h} fill={fill} />;

const baseProps = {
  viewBox: '0 -2 16 18',
  width: 32,
  height: 36,
  shapeRendering: 'crispEdges',
  'aria-hidden': 'true',
  focusable: 'false',
};

export function AgentSprite({ color, pose = 'idle' }) {
  const working = pose === 'working';
  return (
    <svg {...baseProps} data-testid="agent-sprite" data-pose={working ? 'working' : 'idle'}>
      {R(5, 1, 6, 2, '#3b2412')}
      {R(5, 3, 6, 3, SKIN)}
      {R(6, 4, 1, 1, '#111')}
      {R(9, 4, 1, 1, '#111')}
      {R(4, 6, 8, 5, color)}
      {working ? (
        <>
          {/* arms reaching forward, legs bent seated */}
          {R(3, 8, 1, 2, SKIN)}
          {R(12, 8, 1, 2, SKIN)}
          {R(4, 10, 2, 1, SKIN)}
          {R(10, 10, 2, 1, SKIN)}
          {R(4, 11, 8, 2, '#2b3a6b')}
          {R(4, 13, 2, 1, '#111')}
          {R(10, 13, 2, 1, '#111')}
        </>
      ) : (
        <>
          {/* arms hanging, standing legs */}
          {R(3, 7, 1, 3, SKIN)}
          {R(12, 7, 1, 3, SKIN)}
          {R(5, 11, 2, 3, '#2b3a6b')}
          {R(9, 11, 2, 3, '#2b3a6b')}
          {R(5, 14, 2, 1, '#111')}
          {R(9, 14, 2, 1, '#111')}
        </>
      )}
    </svg>
  );
}

export function MayorSprite() {
  return (
    <svg {...baseProps} data-testid="mayor-sprite">
      {R(5, 0, 6, 1, '#111')}
      {R(6, -2, 4, 2, '#111')}
      {R(5, 1, 6, 2, '#777')}
      {R(5, 3, 6, 3, SKIN)}
      {R(6, 4, 1, 1, '#111')}
      {R(9, 4, 1, 1, '#111')}
      {R(4, 6, 8, 5, '#2a2a5a')}
      {R(7, 6, 2, 4, '#d4af37')}
      {R(3, 7, 1, 3, SKIN)}
      {R(12, 7, 1, 3, SKIN)}
      {R(5, 11, 2, 3, '#111')}
      {R(9, 11, 2, 3, '#111')}
    </svg>
  );
}

export function Desk() {
  return (
    <svg viewBox="0 0 16 10" width={32} height={20} shapeRendering="crispEdges" aria-hidden="true" focusable="false" data-testid="desk">
      {R(1, 3, 14, 2, '#8a5a2b')}
      {R(1, 5, 2, 4, '#5e3b1a')}
      {R(13, 5, 2, 4, '#5e3b1a')}
      {R(5, 0, 6, 3, '#222')}
      {R(6, 1, 4, 1, '#7fd')}
    </svg>
  );
}
