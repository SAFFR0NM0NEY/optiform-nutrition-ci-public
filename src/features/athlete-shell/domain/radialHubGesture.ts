export const RADIAL_HOLD_MS = 360;
export const RADIAL_PREHOLD_TOLERANCE = 10;
export const RADIAL_NEUTRAL_RADIUS = 46;
export const RADIAL_HIT_RADIUS = 24;
// Destination order is shared by rendering and hold-slide hit testing.
export const RADIAL_DESTINATION_ANGLES = [90, 115, 65, 40, 140, 165, 15] as const;
export type RadialPlacement = 'left' | 'center' | 'right';
export type RadialInteractionMode = 'tap' | 'hold-slide';
export type Point = { x: number; y: number };
export type RadialDestinationGeometry = { id: string; center: Point; hitRadius: number };
export type RadialLayout = {
  hubCenter: Point;
  radius: number;
  fanWidth: number;
  destinations: RadialDestinationGeometry[];
};
export type GestureState =
  | { phase: 'idle'; candidateId: null }
  | { phase: 'pressing'; pointerId: number; origin: Point; startedAt: number; candidateId: null }
  | {
      phase: 'active';
      pointerId: number;
      origin: Point;
      startedAt: number;
      candidateId: string | null;
    };

export const idleGesture = (): GestureState => ({ phase: 'idle', candidateId: null });
export function beginGesture(pointerId: number, point: Point, now: number): GestureState {
  return { phase: 'pressing', pointerId, origin: point, startedAt: now, candidateId: null };
}
export function activateGesture(state: GestureState, now: number): GestureState {
  return state.phase === 'pressing' && now - state.startedAt >= RADIAL_HOLD_MS
    ? { ...state, phase: 'active' }
    : state;
}
export function moveGesture(state: GestureState, point: Point, layout: RadialLayout): GestureState {
  if (state.phase === 'pressing')
    return distance(state.origin, point) > RADIAL_PREHOLD_TOLERANCE ? idleGesture() : state;
  if (state.phase !== 'active') return state;
  return { ...state, candidateId: hitTestDestination(point, layout) };
}
export function releaseGesture(state: GestureState, point: Point, layout: RadialLayout) {
  if (state.phase === 'pressing') return { state: idleGesture(), action: 'tap' as const };
  if (state.phase !== 'active') return { state, action: 'none' as const };
  const candidateId = hitTestDestination(point, layout);
  return candidateId
    ? { state: idleGesture(), action: 'select' as const, candidateId }
    : { state: idleGesture(), action: 'cancel' as const };
}
export function cancelGesture(): GestureState {
  return idleGesture();
}

export function calculateRadialLayout(
  width: number,
  height: number,
  placement: RadialPlacement,
  destinationIds: string[],
  safe = { left: 0, right: 0, bottom: 0 },
): RadialLayout {
  const edge = 8;
  const availableWidth = width - safe.left - safe.right;
  // Move entire 48px targets inside the existing fan arc.
  const boundaryRadius = Math.min(
    152,
    Math.max(128, availableWidth * 0.36),
    (availableWidth - 2 * (edge + 28)) / (2 * Math.cos((15 * Math.PI) / 180)),
  );
  // At the existing minimum 25-degree separation, 111px clears 48px circles.
  const radius = Math.max(boundaryRadius - 12, 111);
  const extent = boundaryRadius * Math.cos((15 * Math.PI) / 180) + 28;
  const minX = safe.left + edge + extent;
  const maxX = width - safe.right - edge - extent;
  const desired =
    placement === 'left' ? width * 0.32 : placement === 'right' ? width * 0.68 : width / 2;
  const hubX = minX <= maxX ? clamp(desired, minX, maxX) : width / 2;
  const hubCenter = { x: hubX, y: height - safe.bottom - 40 };
  const fanWidth = Math.min(
    2 * (boundaryRadius + 28),
    2 * (hubX - safe.left - 4),
    2 * (width - safe.right - hubX - 4),
  );
  return {
    hubCenter,
    radius,
    fanWidth,
    destinations: destinationIds.map((id, index) => {
      const radians = ((RADIAL_DESTINATION_ANGLES[index] ?? 90) * Math.PI) / 180;
      return {
        id,
        hitRadius: RADIAL_HIT_RADIUS,
        center: {
          x: hubX + Math.cos(radians) * radius,
          y: hubCenter.y - Math.sin(radians) * radius,
        },
      };
    }),
  };
}

export function hitTestDestination(point: Point, layout: RadialLayout): string | null {
  if (distance(point, layout.hubCenter) <= RADIAL_NEUTRAL_RADIUS) return null;
  return (
    layout.destinations
      .map((item, index) => ({ item, index, distance: distance(point, item.center) }))
      .filter(({ item, distance }) => distance <= item.hitRadius)
      .sort((a, b) => a.distance - b.distance || a.index - b.index)[0]?.item.id ?? null
  );
}

// Clip only the invisible pointer surface to its nearest-centre cell. Intersected
// with a circle in CSS, this gives native links the same policy as hold-slide.
export function destinationHitPolygon(target: RadialDestinationGeometry, layout: RadialLayout) {
  const radius = target.hitRadius;
  let polygon = [
    { x: -radius, y: -radius },
    { x: radius, y: -radius },
    { x: radius, y: radius },
    { x: -radius, y: radius },
  ];
  for (const other of layout.destinations) {
    if (other.id === target.id) continue;
    const dx = other.center.x - target.center.x;
    const dy = other.center.y - target.center.y;
    const limit = (dx * dx + dy * dy) / 2;
    const side = (point: Point) => point.x * dx + point.y * dy - limit;
    const clipped: Point[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const sa = side(a);
      const sb = side(b);
      if (sa <= 0) clipped.push(a);
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
        const fraction = sa / (sa - sb);
        clipped.push({ x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) });
      }
    }
    polygon = clipped;
  }
  return polygon.map(({ x, y }) => ({
    x: ((x + radius) / (2 * radius)) * 100,
    y: ((y + radius) / (2 * radius)) * 100,
  }));
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
