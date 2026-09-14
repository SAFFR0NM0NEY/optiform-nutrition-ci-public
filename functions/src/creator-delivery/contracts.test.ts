import { describe, expect, it } from 'vitest';
import { projectCreatorDelivery } from './contracts.js';

const uid = 'PRIVATE-UID';
const programId = 'program-private-source';
const versionId = 'v1';
const canonical = new Map([
  [
    'squat',
    {
      id: 'squat',
      name: 'Back Squat',
      source: 'system',
      status: 'published',
      trackingProfile: { primaryMetric: 'reps', supportedMetrics: ['reps', 'load'] },
      trainingClassification: 'resistance',
      equipment: ['barbell'],
    },
  ],
  [
    'row',
    {
      id: 'row',
      name: 'Barbell Row',
      source: 'system',
      status: 'published',
      trackingProfile: { primaryMetric: 'reps', supportedMetrics: ['reps', 'load'] },
      trainingClassification: 'resistance',
      equipment: ['barbell'],
    },
  ],
]);

const exercise = (id: string, order: number) => ({
  exercisePlanId: `pex-PRIVATE-PLAN-${order}`,
  order,
  exercise: {
    source: 'system',
    exerciseId: id,
    name: 'FORGED NAME',
    trackingProfile: { primaryMetric: 'reps', supportedMetrics: ['reps', 'load'] },
    trainingClassification: 'mixed',
    equipment: [],
  },
  note: `PRIVATE-EXERCISE-NOTE-${order}`,
  instructionText: `PRIVATE-INSTRUCTION-${order}`,
  instructionUrl: `https://private.example/${order}`,
  setPlans: [
    {
      setPlanId: `pset-PRIVATE-WARMUP-${order}`,
      order: 1,
      role: 'warmup',
      executionPlan: { kind: 'standard', additionalSegmentCount: 0 },
      prescription: { metrics: { reps: { kind: 'exact', value: 5 } }, segmentTargets: [] },
    },
    {
      setPlanId: `pset-PRIVATE-WORKING-${order}`,
      order: 2,
      role: 'working',
      executionPlan: {
        kind: 'standard',
        additionalSegmentCount: 0,
        tempo: { eccentricSeconds: 2, bottomPauseSeconds: 0, concentric: 'X', topPauseSeconds: 1 },
      },
      prescription: {
        metrics: {
          reps: { kind: 'range', minimum: 5, maximum: 8 },
          load: { kind: 'exact', value: 20 },
        },
        effort: { scale: 'rpe', target: { kind: 'exact', value: 8 } },
        segmentTargets: [],
      },
    },
  ],
  progression: {
    kind: 'double-progression',
    repRange: { minimum: 5, maximum: 8 },
    loadIncrementKg: 2.5,
    startingLoadKg: 20,
  },
});

const source = () => ({
  publicationVersionId: 'publication-1',
  listingId: 'listing-1',
  creatorId: 'creator-1',
  versionNumber: 1,
  ownerUid: uid,
  sourceProgramId: programId,
  sourceVersionId: versionId,
  preview: { title: 'Strength', description: 'A plan', durationWeeks: 1 },
  bundle: {
    index: {
      schemaVersion: 1,
      contractVersion: 'training-programs-v1',
      ownerUid: uid,
      programId,
      source: 'athlete',
      name: 'Strength',
      currentVersionId: 'v2',
      currentVersionNumber: 2,
      status: 'active',
      createdAt: 'PRIVATE-INDEX-CREATED',
      updatedAt: 'PRIVATE-INDEX-UPDATED',
    },
    version: {
      schemaVersion: 1,
      contractVersion: 'training-programs-v1',
      ownerUid: uid,
      programId,
      versionId,
      versionNumber: 1,
      name: 'Strength',
      description: 'A plan',
      note: 'PRIVATE-PROGRAMME-NOTE',
      durationWeeks: 1,
      createdAt: 'PRIVATE-VERSION-CREATED',
    },
    days: [
      {
        schemaVersion: 1,
        contractVersion: 'training-programs-v1',
        ownerUid: uid,
        programId,
        versionId,
        dayId: 'w1-d1',
        weekNumber: 1,
        dayOfWeek: 1,
        weekKind: 'standard',
        label: 'Day one',
        note: 'PRIVATE-DAY-NOTE',
        exercises: [exercise('squat', 1), exercise('row', 2)],
        groups: [
          {
            groupPlanId: 'PRIVATE-GROUP-ID',
            type: 'superset',
            memberExercisePlanIds: ['pex-PRIVATE-PLAN-1', 'pex-PRIVATE-PLAN-2'],
            startWorkingSetOrder: 2,
            roundCount: 3,
          },
        ],
        createdAt: 'PRIVATE-DAY-CREATED',
      },
    ],
  },
});

const project = (mutate?: (value: ReturnType<typeof source>) => void) => {
  const value = structuredClone(source());
  mutate?.(value);
  return projectCreatorDelivery({ ...value, canonical });
};

describe('creator programme delivery projection', () => {
  it('validates a historical, complex P28 source and reconstructs canonical snapshots deterministically', () => {
    const first = project();
    expect(project()).toEqual(first);
    expect(first.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.days[0].exercises).toMatchObject([
      {
        deliveryExerciseId: 'exercise-1',
        exercise: { name: 'Back Squat', equipment: ['barbell'] },
      },
      {
        deliveryExerciseId: 'exercise-2',
        exercise: { name: 'Barbell Row', equipment: ['barbell'] },
      },
    ]);
    expect(first.days[0].groups[0]).toMatchObject({
      deliveryGroupId: 'group-1',
      memberDeliveryExerciseIds: ['exercise-1', 'exercise-2'],
    });
  });

  it('removes every private/source sentinel', () => {
    const serialized = JSON.stringify(project());
    for (const sentinel of [
      'PRIVATE-UID',
      'program-private-source',
      'PRIVATE-INDEX',
      'PRIVATE-VERSION',
      'w1-d1',
      'PRIVATE-DAY',
      'pex-PRIVATE',
      'pset-PRIVATE',
      'PRIVATE-GROUP',
      'PRIVATE-EXERCISE',
      'PRIVATE-INSTRUCTION',
      'private.example',
      'PRIVATE-PROGRAMME',
    ])
      expect(serialized).not.toContain(sentinel);
  });

  it.each([
    [
      'wrong contract',
      (v: ReturnType<typeof source>) => {
        v.bundle.version.contractVersion = 'wrong';
      },
    ],
    [
      'malformed dayId',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].dayId = 'bad';
      },
    ],
    [
      'invalid week kind',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].weekKind = 'recovery';
      },
    ],
    [
      'invalid set role',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].exercises[0].setPlans[0].role = 'feeder';
      },
    ],
    [
      'invalid execution kind',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].exercises[0].setPlans[0].executionPlan.kind = 'cluster';
      },
    ],
    [
      'invalid segment count',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].exercises[0].setPlans[0].executionPlan.additionalSegmentCount = 1;
      },
    ],
    [
      'unsupported metric',
      (v: ReturnType<typeof source>) => {
        const prescription = v.bundle.days[0].exercises[0].setPlans[0].prescription as unknown as {
          metrics: Record<string, unknown>;
        };
        prescription.metrics = {
          time: { kind: 'exact', value: 30 },
        };
      },
    ],
    [
      'malformed effort',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].exercises[0].setPlans[1].prescription.effort = {
          scale: 'rpe',
          target: { kind: 'exact', value: 11 },
        };
      },
    ],
    [
      'invalid progression',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].exercises[0].progression.loadIncrementKg = 0.3;
      },
    ],
    [
      'one-member superset',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].groups[0].memberExercisePlanIds = ['pex-PRIVATE-PLAN-1'];
      },
    ],
    [
      'unknown group member',
      (v: ReturnType<typeof source>) => {
        v.bundle.days[0].groups[0].memberExercisePlanIds[1] = 'pex-unknown';
      },
    ],
    [
      'duplicate day',
      (v: ReturnType<typeof source>) => {
        v.bundle.days.push(structuredClone(v.bundle.days[0]));
      },
    ],
  ])('rejects malformed P28 source: %s', (_name, mutate) => {
    expect(() => project(mutate)).toThrow('source-structure-invalid');
  });

  it('rejects custom, unknown, and unpublished exercises', () => {
    expect(() =>
      project((value) => {
        value.bundle.days[0].exercises[0].exercise.source = 'athlete-custom';
      }),
    ).toThrow('custom-exercise-denied');
    const missing = new Map(canonical);
    missing.delete('squat');
    expect(() => projectCreatorDelivery({ ...source(), canonical: missing })).toThrow(
      'canonical-exercise-unavailable',
    );
    const unpublished = new Map(canonical);
    unpublished.set('squat', { ...canonical.get('squat')!, status: 'draft' });
    expect(() => projectCreatorDelivery({ ...source(), canonical: unpublished })).toThrow(
      'canonical-exercise-unavailable',
    );
  });
});
