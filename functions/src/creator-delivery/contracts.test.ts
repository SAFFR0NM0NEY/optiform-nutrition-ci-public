import { describe, expect, it } from 'vitest';
import { projectCreatorDelivery } from './contracts.js';

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
]);
const source = (exerciseSource = 'system') => ({
  publicationVersionId: 'publication-1',
  listingId: 'listing-1',
  creatorId: 'creator-1',
  versionNumber: 1,
  preview: { title: 'Strength', description: 'A plan', durationWeeks: 1 },
  bundle: {
    version: { ownerUid: 'PRIVATE-UID', programId: 'PRIVATE-PROGRAM-ID' },
    days: [
      {
        ownerUid: 'PRIVATE-UID',
        programId: 'PRIVATE-PROGRAM-ID',
        versionId: 'PRIVATE-VERSION-ID',
        dayId: 'PRIVATE-DAY-ID',
        weekNumber: 1,
        dayOfWeek: 1,
        weekKind: 'standard',
        label: 'Day one',
        note: 'PRIVATE-DAY-NOTE',
        exercises: [
          {
            exercisePlanId: 'PRIVATE-PLAN-ID',
            order: 1,
            exercise: {
              source: exerciseSource,
              exerciseId: 'squat',
              name: 'FORGED NAME',
              trackingProfile: {},
              trainingClassification: 'mixed',
              equipment: [],
            },
            note: 'PRIVATE-EXERCISE-NOTE',
            instructionText: 'PRIVATE-INSTRUCTION',
            instructionUrl: 'https://private.example',
            setPlans: [
              {
                setPlanId: 'PRIVATE-SET-ID',
                order: 1,
                role: 'working',
                executionPlan: { kind: 'standard' },
                prescription: { metrics: { reps: { kind: 'exact', value: 5 } } },
              },
            ],
            progression: {
              kind: 'double-progression',
              repRange: { minimum: 5, maximum: 8 },
              loadIncrementKg: 2.5,
            },
          },
        ],
        groups: [
          {
            groupPlanId: 'PRIVATE-GROUP-ID',
            type: 'superset',
            memberExercisePlanIds: ['PRIVATE-PLAN-ID'],
            startWorkingSetOrder: 1,
            roundCount: 3,
          },
        ],
      },
    ],
  },
});

describe('creator programme delivery projection', () => {
  it('is deterministic, reconstructs canonical snapshots, and preserves safe structure', () => {
    const first = projectCreatorDelivery({ ...source(), canonical });
    const second = projectCreatorDelivery({ ...source(), canonical });
    expect(second).toEqual(first);
    expect(first.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.days[0].exercises[0]).toMatchObject({
      deliveryExerciseId: 'exercise-1',
      exercise: { name: 'Back Squat', equipment: ['barbell'] },
      setPlans: [{ deliverySetId: 'set-1' }],
      progression: { kind: 'double-progression' },
    });
    expect(first.days[0].groups[0]).toMatchObject({
      deliveryGroupId: 'group-1',
      memberDeliveryExerciseIds: ['exercise-1'],
    });
  });

  it('removes every private/source sentinel', () => {
    const serialized = JSON.stringify(projectCreatorDelivery({ ...source(), canonical }));
    for (const sentinel of [
      'PRIVATE-UID',
      'PRIVATE-PROGRAM-ID',
      'PRIVATE-VERSION-ID',
      'PRIVATE-DAY-ID',
      'PRIVATE-DAY-NOTE',
      'PRIVATE-PLAN-ID',
      'PRIVATE-SET-ID',
      'PRIVATE-GROUP-ID',
      'PRIVATE-EXERCISE-NOTE',
      'PRIVATE-INSTRUCTION',
      'private.example',
    ])
      expect(serialized).not.toContain(sentinel);
  });

  it('rejects custom, unknown, and unpublished exercises', () => {
    expect(() => projectCreatorDelivery({ ...source('athlete-custom'), canonical })).toThrow(
      'custom-exercise-denied',
    );
    expect(() => projectCreatorDelivery({ ...source(), canonical: new Map() })).toThrow(
      'canonical-exercise-unavailable',
    );
    const unpublished = new Map(canonical);
    unpublished.set('squat', { ...canonical.get('squat')!, status: 'draft' });
    expect(() => projectCreatorDelivery({ ...source(), canonical: unpublished })).toThrow(
      'canonical-exercise-unavailable',
    );
  });
});
