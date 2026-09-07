import { describe, expect, it } from 'vitest';
import {
  aggregateGymParticipation,
  assertGymAnalyticsCapacity,
  gymAnalyticsEventId,
  gymAnalyticsParticipantKey,
  projectGymWorkoutAnalyticsEvent,
} from './contracts.js';

const workout = (override: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  recordOrigin: 'athlete-client',
  sourceSessionSchemaVersion: 5,
  ownerUid: 'uid-a',
  workoutId: 'RAW_WORKOUT_777',
  completedAt: '1999-01-01T00:00:00.000Z',
  exercises: [{ note: 'PRIVATE-NOTE', sets: [{ load: 999, reps: 99 }] }],
  programContext: {
    contractVersion: 'workout-program-provenance-v3',
    programSource: 'gym-program',
    gymId: 'gym-a',
    gymProgramId: 'program-a',
    publicationVersionId: 'version-a',
    enrollmentId: 'PRIVATE-ENROLLMENT',
    sessionKey: 'w1-d1',
    weekNumber: 1,
    dayOfWeek: 1,
  },
  ...override,
});

describe('P38F analytics event contracts', () => {
  it('projects valid V3 from trusted event time without private sentinels', () => {
    const event = projectGymWorkoutAnalyticsEvent({
      uid: 'uid-a',
      workoutId: 'RAW_WORKOUT_777',
      workout: workout(),
      recordedAt: new Date('2026-09-07T12:00:00Z'),
    });
    expect(event?.recordedDateUtc).toBe('2026-09-07');
    const serialized = JSON.stringify(event);
    for (const privateValue of [
      'uid-a',
      'RAW_WORKOUT_777',
      'PRIVATE-ENROLLMENT',
      'PRIVATE-NOTE',
      '999',
    ])
      expect(serialized).not.toContain(privateValue);
  });
  it('ignores V1, V2, no-context, wrong-owner and malformed V3 records', () => {
    const project = (candidate: unknown) =>
      projectGymWorkoutAnalyticsEvent({
        uid: 'uid-a',
        workoutId: 'RAW_WORKOUT_777',
        workout: candidate,
        recordedAt: new Date(),
      });
    expect(project({ ...workout(), schemaVersion: 1 })).toBeNull();
    expect(
      project({
        ...workout(),
        programContext: { contractVersion: 'workout-program-provenance-v2' },
      }),
    ).toBeNull();
    expect(project({ ...workout(), programContext: undefined })).toBeNull();
    expect(project({ ...workout(), ownerUid: 'uid-b' })).toBeNull();
    expect(
      project({
        ...workout(),
        programContext: { ...(workout().programContext as object), gymId: 'bad/id' },
      }),
    ).toBeNull();
  });
  it('uses stable event IDs and gym-scoped participant identities', () => {
    expect(gymAnalyticsEventId('u', 'w')).toBe(gymAnalyticsEventId('u', 'w'));
    expect(gymAnalyticsParticipantKey('gym-a', 'uid-a')).not.toBe(
      gymAnalyticsParticipantKey('gym-b', 'uid-a'),
    );
  });
  it('suppresses four, exposes five, deduplicates sessions and sorts rows', () => {
    const entries = (count: number, program = 'p') =>
      Array.from({ length: count }, (_, index) => ({
        participantKey: `k${index}`,
        sessionCompletionKey: index < 2 ? 'same' : `s${index}`,
        gymProgramId: program,
      }));
    expect(aggregateGymParticipation(entries(4), new Map()).trainingActivity).toEqual({
      status: 'suppressed',
      minimumCohort: 5,
    });
    expect(
      aggregateGymParticipation(entries(5), new Map([['p', 'Alpha']])).trainingActivity,
    ).toEqual({ status: 'available', distinctParticipants: 5, sessionsRecorded: 4 });
    const mixed = aggregateGymParticipation(
      [...entries(5, 'a'), ...entries(2, 'b')],
      new Map([
        ['a', 'Zulu'],
        ['b', 'Alpha'],
      ]),
    );
    expect(mixed.programActivity.map((row) => [row.gymProgramId, row.status])).toEqual([
      ['a', 'available'],
      ['b', 'suppressed'],
    ]);
  });
  it('allows 5,000 events and fails closed at 5,001', () => {
    expect(() => assertGymAnalyticsCapacity(5_000, 1_000)).not.toThrow();
    expect(() => assertGymAnalyticsCapacity(5_001, 1_000)).toThrow('analytics-capacity-review');
    expect(() => assertGymAnalyticsCapacity(5_000, 1_001)).toThrow('analytics-capacity-review');
  });
});
