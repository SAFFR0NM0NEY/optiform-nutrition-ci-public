import { describe, expect, it } from 'vitest';
import {
  IMPORT_CSV_FORMAT,
  canonicalDigest,
  canonicalizeImport,
  contentClaimId,
  importedWorkoutId,
  parseCommitRequest,
  parsePreviewRequest,
  parseRollbackRequest,
  recordDigest,
  type ImportWorkout,
} from './contracts.js';

const now = new Date('2026-09-10T12:00:00.000Z');
const workout: ImportWorkout = {
  datasetId: 'source:2026',
  sourceWorkoutId: 'one',
  startedAt: '2026-09-09T08:00:00.000Z',
  completedAt: '2026-09-09T09:00:00.000Z',
  exercises: [
    {
      order: 1,
      sourceExerciseId: 'bench',
      exerciseName: 'Bench Press',
      sets: [{ order: 1, role: 'working', values: { reps: 8, load: 80 } }],
    },
  ],
};

describe('workout history import Functions contracts', () => {
  it('accepts exact canonical preview and commit payloads', () => {
    const preview = parsePreviewRequest(
      { sourceFormat: IMPORT_CSV_FORMAT, workouts: [workout] },
      now,
    );
    const digest = canonicalDigest(preview.workouts);
    expect(
      parseCommitRequest({ ...preview, expectedCanonicalDigestSha256: digest }, now),
    ).toMatchObject({
      expectedCanonicalDigestSha256: digest,
    });
    expect(parseRollbackRequest({ batchId: 'batch-safe' })).toEqual({ batchId: 'batch-safe' });
  });

  it.each([
    { sourceFormat: IMPORT_CSV_FORMAT, workouts: [workout], ownerUid: 'injected' },
    { sourceFormat: 'csv-v2', workouts: [workout] },
    {
      sourceFormat: IMPORT_CSV_FORMAT,
      workouts: [{ ...workout, completedAt: '2099-01-01T00:00:00.000Z' }],
    },
    { sourceFormat: IMPORT_CSV_FORMAT, workouts: [{ ...workout, extra: true }] },
    { sourceFormat: IMPORT_CSV_FORMAT, workouts: [{ ...workout, exercises: [] }] },
  ])('rejects invalid or non-exact preview payload %#', (input) => {
    expect(() => parsePreviewRequest(input, now)).toThrow('invalid-request');
  });

  it('derives stable distinct source identity and content identity', () => {
    const renamed = { ...workout, datasetId: 'other', sourceWorkoutId: 'renamed' };
    expect(importedWorkoutId(renamed)).not.toBe(importedWorkoutId(workout));
    expect(recordDigest(renamed)).toBe(recordDigest(workout));
    expect(contentClaimId('a', recordDigest(workout))).not.toBe(
      contentClaimId('b', recordDigest(workout)),
    );
    expect(canonicalDigest([renamed])).not.toBe(canonicalDigest([workout]));
  });

  it('canonicalizes exercise, set, metric and workout order deterministically', () => {
    const second = { ...workout, sourceWorkoutId: 'two' };
    const canonical = canonicalizeImport([second, workout]);
    expect(canonical.map((item) => item.sourceWorkoutId)).toEqual(['one', 'two']);
    expect(Object.keys(canonical[0].exercises[0].sets[0].values)).toEqual(['reps', 'load']);
  });

  it('accepts 200 workouts and rejects 201', () => {
    const workouts = Array.from({ length: 200 }, (_, index) => ({
      ...workout,
      sourceWorkoutId: `workout-${String(index).padStart(3, '0')}`,
    }));
    expect(
      parsePreviewRequest({ sourceFormat: IMPORT_CSV_FORMAT, workouts }, now).workouts,
    ).toHaveLength(200);
    expect(() =>
      parsePreviewRequest(
        {
          sourceFormat: IMPORT_CSV_FORMAT,
          workouts: [...workouts, { ...workout, sourceWorkoutId: 'workout-201' }],
        },
        now,
      ),
    ).toThrow('invalid-request');
  });

  it('rejects a normalized payload above the 5,000-row/set import bound', () => {
    const workouts = Array.from({ length: 200 }, (_, workoutIndex) => ({
      ...workout,
      sourceWorkoutId: `workout-${workoutIndex}`,
      exercises: [
        {
          ...workout.exercises[0],
          sets: Array.from({ length: 26 }, (_, setIndex) => ({
            order: setIndex + 1,
            role: 'working' as const,
            values: { reps: 1 },
          })),
        },
      ],
    }));
    expect(() => parsePreviewRequest({ sourceFormat: IMPORT_CSV_FORMAT, workouts }, now)).toThrow(
      'invalid-request',
    );
  });
});
