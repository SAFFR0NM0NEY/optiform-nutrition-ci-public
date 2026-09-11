import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  assertChallengeWorkoutSource,
  assertParticipantPair,
  assertPrivateEvidence,
  assertPrivateParticipant,
  assertSafeEvidence,
  assertSafeParticipant,
} from './integrity.js';

const creatorId = 'creator-a',
  challengeId = 'challenge-a';
const participantId = 'creator-challenge-participant-00000000-0000-4000-8000-000000000001';
const uid = 'uid-a',
  joinedAt = Timestamp.fromMillis(10),
  completedAt = Timestamp.fromMillis(2000);
const modernWorkout = (override: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  recordOrigin: 'athlete-client',
  sourceSessionSchemaVersion: 5,
  workoutId: 'workout-a',
  ownerUid: uid,
  startedAt: Timestamp.fromMillis(1000),
  completedAt,
  pausedDurationSeconds: 0,
  groups: [],
  exercises: [
    {
      id: 'entry-a',
      order: 1,
      createdAt: new Date(1000).toISOString(),
      exercise: {
        source: 'system',
        exerciseId: 'exercise-a',
        name: 'Exercise A',
        trackingProfile: { primaryMetric: 'reps', supportedMetrics: ['reps', 'load'] },
        trainingClassification: 'resistance',
        equipment: ['bodyweight'],
      },
      sets: [
        {
          id: 'set-a',
          order: 1,
          status: 'completed',
          role: 'working',
          values: { reps: 10 },
          execution: { kind: 'standard' },
          createdAt: new Date(1000).toISOString(),
          updatedAt: new Date(2000).toISOString(),
          completedAt: new Date(2000).toISOString(),
        },
      ],
    },
  ],
  ...override,
});
const context = (contractVersion: string) => ({
  contractVersion,
  programSource: contractVersion.endsWith('v1')
    ? 'athlete'
    : contractVersion.endsWith('v2')
      ? 'creator-entitled'
      : 'gym-program',
  enrollmentId: contractVersion.endsWith('v1')
    ? 'enrollment-a'
    : contractVersion.endsWith('v2')
      ? 'creator-enrollment-a'
      : 'gym-program-enrollment-a',
  programName: 'Programme',
  sessionLabel: 'Session',
  weekNumber: 1,
  dayOfWeek: 1,
  sessionKey: 'w1-d1',
  scheduledDateLocal: '2026-09-07',
  ...(contractVersion.endsWith('v1') ? { programId: 'program-a', programVersionId: 'v1' } : {}),
  ...(contractVersion.endsWith('v2')
    ? {
        listingId: 'listing-a',
        creatorId,
        publicationVersionId: 'version-a',
        deliveryDayId: 'day-a',
      }
    : {}),
  ...(contractVersion.endsWith('v3')
    ? {
        gymId: 'gym-a',
        gymProgramId: 'gym-program-a',
        publicationVersionId: 'version-a',
        deliveryDayId: 'day-a',
      }
    : {}),
});
const safeParticipant = (override: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  contractVersion: 'creator-membership-challenge-participation-v1',
  creatorId,
  challengeId,
  participantId,
  status: 'active',
  displayName: 'Athlete One',
  joinedAt,
  ...override,
});
const privateParticipant = (override: Record<string, unknown> = {}) => ({
  ...safeParticipant(),
  participantUid: uid,
  ...override,
});
const safeEvidence = (override: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  contractVersion: 'creator-membership-challenge-evidence-v1',
  creatorId,
  challengeId,
  evidenceId: `${participantId}_0`,
  participantId,
  dayIndex: 0,
  pointValue: 1,
  ...override,
});
const privateEvidence = (override: Record<string, unknown> = {}) => ({
  ...safeEvidence(),
  participantUid: uid,
  sourceWorkoutId: 'workout-a',
  sourceCompletedAt: completedAt,
  createdAt: Timestamp.fromMillis(3000),
  ...override,
});

describe('creator challenge completed workout integrity', () => {
  it.each([1, 2] as const)('accepts canonical V%s records', (schemaVersion) => {
    const workout: Record<string, unknown> = modernWorkout({
      schemaVersion,
      sourceSessionSchemaVersion: schemaVersion === 1 ? 3 : 4,
    });
    delete workout.programContext;
    if (schemaVersion === 1) {
      delete workout.pausedDurationSeconds;
      delete workout.groups;
      const entry = (workout.exercises as Array<Record<string, unknown>>)[0];
      const exercise = entry.exercise as Record<string, unknown>;
      delete exercise.source;
      const set = (entry.sets as Array<Record<string, unknown>>)[0];
      delete set.execution;
    }
    expect(() => assertChallengeWorkoutSource(workout, 'workout-a', uid, 0, 3000)).not.toThrow();
  });
  it('accepts canonical V3 without optional programme context', () => {
    expect(assertChallengeWorkoutSource(modernWorkout(), 'workout-a', uid, 0, 3000).workoutId).toBe(
      'workout-a',
    );
  });
  it.each([
    'workout-program-provenance-v1',
    'workout-program-provenance-v2',
    'workout-program-provenance-v3',
  ])('accepts canonical %s context', (version) => {
    expect(() =>
      assertChallengeWorkoutSource(
        modernWorkout({ programContext: context(version) }),
        'workout-a',
        uid,
        0,
        3000,
      ),
    ).not.toThrow();
  });
  it.each([
    { programContext: { contractVersion: 'workout-program-provenance-v2' } },
    { programContext: context('workout-program-provenance-v9') },
    { programContext: { ...context('workout-program-provenance-v2'), gymId: 'hybrid' } },
    { unexpected: true },
    { ownerUid: 'uid-b' },
    { workoutId: 'wrong' },
  ])('rejects malformed source %#', (override) => {
    expect(() =>
      assertChallengeWorkoutSource(modernWorkout(override), 'workout-a', uid, 0, 3000),
    ).toThrow('challenge-workout-source-invalid');
  });
});

describe('creator challenge projection integrity', () => {
  it('validates exact active and withdrawn participant pairs', () => {
    const control = assertPrivateParticipant(privateParticipant(), creatorId, challengeId, uid);
    const safe = assertSafeParticipant(safeParticipant(), participantId, creatorId, challengeId);
    expect(() => assertParticipantPair(control, safe)).not.toThrow();
    expect(() =>
      assertSafeParticipant(
        safeParticipant({ extra: true }),
        participantId,
        creatorId,
        challengeId,
      ),
    ).toThrow();
    expect(() =>
      assertSafeParticipant(
        safeParticipant({ status: 'withdrawn', displayName: '', withdrawnAt: Timestamp.now() }),
        participantId,
        creatorId,
        challengeId,
      ),
    ).not.toThrow();
    expect(() =>
      assertSafeParticipant(
        safeParticipant({
          status: 'withdrawn',
          displayName: 'retained',
          withdrawnAt: Timestamp.now(),
        }),
        participantId,
        creatorId,
        challengeId,
      ),
    ).toThrow();
  });
  it('validates exact private and safe evidence shapes and identities', () => {
    expect(
      assertPrivateEvidence(privateEvidence(), `${participantId}_0`, creatorId, challengeId)
        .sourceWorkoutId,
    ).toBe('workout-a');
    expect(
      assertSafeEvidence(safeEvidence(), `${participantId}_0`, creatorId, challengeId).pointValue,
    ).toBe(1);
    expect(() =>
      assertPrivateEvidence(
        privateEvidence({ extra: true }),
        `${participantId}_0`,
        creatorId,
        challengeId,
      ),
    ).toThrow();
    expect(() =>
      assertSafeEvidence(
        safeEvidence({ sourceWorkoutId: 'leak' }),
        `${participantId}_0`,
        creatorId,
        challengeId,
      ),
    ).toThrow();
    expect(() =>
      assertSafeEvidence(safeEvidence(), 'arbitrary-document', creatorId, challengeId),
    ).toThrow();
  });
});
