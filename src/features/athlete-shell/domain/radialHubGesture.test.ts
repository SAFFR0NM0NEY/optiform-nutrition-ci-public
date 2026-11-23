import {
  activateGesture,
  beginGesture,
  calculateRadialLayout,
  cancelGesture,
  hitTestDestination,
  idleGesture,
  moveGesture,
  RADIAL_HIT_RADIUS,
  RADIAL_HOLD_MS,
  releaseGesture,
} from './radialHubGesture';

const ids = ['home', 'train', 'muscles', 'progress', 'profile', 'nutrition', 'challenges'];
const layout = calculateRadialLayout(390, 800, 'center', ids);

describe('P25 radial hold-slide gesture', () => {
  it('keeps quick tap distinct and activates only after the hold threshold', () => {
    const pressing = beginGesture(1, layout.hubCenter, 0);
    expect(activateGesture(pressing, RADIAL_HOLD_MS - 1).phase).toBe('pressing');
    expect(releaseGesture(pressing, layout.hubCenter, layout).action).toBe('tap');
    expect(activateGesture(pressing, RADIAL_HOLD_MS).phase).toBe('active');
  });
  it('cancels pre-hold movement beyond tolerance', () => {
    expect(moveGesture(beginGesture(1, { x: 0, y: 0 }, 0), { x: 11, y: 0 }, layout)).toEqual(
      idleGesture(),
    );
  });
  it('highlights and updates the active destination', () => {
    const active = activateGesture(beginGesture(1, layout.hubCenter, 0), RADIAL_HOLD_MS);
    const first = moveGesture(active, layout.destinations[0].center, layout);
    expect(first.candidateId).toBe(ids[0]);
    expect(moveGesture(first, layout.destinations[1].center, layout).candidateId).toBe(ids[1]);
  });
  it('selects once only on release and clears stale state', () => {
    const active = activateGesture(beginGesture(1, layout.hubCenter, 0), RADIAL_HOLD_MS);
    const result = releaseGesture(active, layout.destinations[0].center, layout);
    expect(result).toMatchObject({ action: 'select', candidateId: ids[0], state: idleGesture() });
    expect(releaseGesture(result.state, layout.destinations[0].center, layout).action).toBe('none');
  });
  it('cancels release outside, neutral-zone, pointer cancellation and capture loss', () => {
    const active = activateGesture(beginGesture(1, layout.hubCenter, 0), RADIAL_HOLD_MS);
    expect(releaseGesture(active, { x: 0, y: 0 }, layout).action).toBe('cancel');
    expect(hitTestDestination(layout.hubCenter, layout)).toBeNull();
    expect(cancelGesture()).toEqual(idleGesture());
    expect(cancelGesture()).toEqual(idleGesture());
  });
});

describe.each([320, 360, 390, 412, 430, 1024])('P25 radial geometry at %ipx', (width) => {
  it.each(['left', 'center', 'right'] as const)(
    'keeps %s placement targets bounded and deterministic',
    (placement) => {
      const result = calculateRadialLayout(width, 800, placement, ids, {
        left: 8,
        right: 8,
        bottom: 16,
      });
      for (const destination of result.destinations) {
        expect(destination.hitRadius).toBe(RADIAL_HIT_RADIUS);
        expect(destination.center.x - destination.hitRadius).toBeGreaterThanOrEqual(8);
        expect(destination.center.x + destination.hitRadius).toBeLessThanOrEqual(width - 8);
        expect(hitTestDestination(destination.center, result)).toBe(destination.id);
      }
      expect(result.hubCenter.x - result.fanWidth / 2).toBeGreaterThanOrEqual(8);
      expect(result.hubCenter.x + result.fanWidth / 2).toBeLessThanOrEqual(width - 8);
      for (let index = 1; index < result.destinations.length; index += 1) {
        const first = result.destinations[index - 1].center;
        const second = result.destinations[index].center;
        expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(
          2 * RADIAL_HIT_RADIUS,
        );
      }
      const first = result.destinations[0];
      const second = result.destinations[1];
      const boundary = {
        x: (first.center.x + second.center.x) / 2,
        y: (first.center.y + second.center.y) / 2,
      };
      const boundaryHit = hitTestDestination(boundary, result);
      expect(hitTestDestination(boundary, result)).toBe(boundaryHit);
      expect(hitTestDestination(result.hubCenter, result)).toBeNull();
    },
  );
});

it.each([320, 360, 390, 430])(
  'bounds the full label width and all target pairs at %ipx',
  (width) => {
    for (const placement of ['left', 'center', 'right'] as const) {
      const result = calculateRadialLayout(width, 568, placement, ids);
      for (const destination of result.destinations) {
        expect(destination.center.x - 28).toBeGreaterThanOrEqual(8);
        expect(destination.center.x + 28).toBeLessThanOrEqual(width - 8);
        expect(destination.center.y - RADIAL_HIT_RADIUS).toBeGreaterThan(0);
        for (const other of result.destinations.filter((item) => item.id !== destination.id)) {
          expect(
            Math.hypot(
              destination.center.x - other.center.x,
              destination.center.y - other.center.y,
            ),
          ).toBeGreaterThan(2 * RADIAL_HIT_RADIUS);
        }
      }
    }
  },
);
