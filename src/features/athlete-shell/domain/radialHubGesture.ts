export const RADIAL_HOLD_MS = 360;
export const RADIAL_PREHOLD_TOLERANCE = 10;
export const RADIAL_NEUTRAL_RADIUS = 46;
export const RADIAL_HIT_RADIUS = 24;
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
  const edge = 12;
  const radius = Math.min(128, Math.max(112, width * 0.328));
  const extent = radius * Math.cos((25 * Math.PI) / 180) + RADIAL_HIT_RADIUS;
  const minX = safe.left + edge + extent;
  const maxX = width - safe.right - edge - extent;
  const desired =
    placement === 'left' ? width * 0.32 : placement === 'right' ? width * 0.68 : width / 2;
  const hubX = minX <= maxX ? clamp(desired, minX, maxX) : width / 2;
  const hubCenter = { x: hubX, y: height - safe.bottom - 40 };
  const fanWidth = Math.min(
    width * 0.875,
    342,
    2 * (hubX - safe.left),
    2 * (width - safe.right - hubX),
  );
  const angles = [90, 111.67, 68.33, 46.67, 133.33, 155, 25];
  return {
    hubCenter,
    radius,
    fanWidth,
    destinations: destinationIds.map((id, index) => {
      const radians = ((angles[index] ?? 90) * Math.PI) / 180;
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
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
