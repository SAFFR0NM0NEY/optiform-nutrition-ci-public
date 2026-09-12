import { describe, expect, it } from 'vitest';
import {
  canonicalWorkoutImportPayload,
  parseWorkoutHistoryCsv,
  validateNormalizedWorkoutImport,
  WORKOUT_HISTORY_CSV_FORMAT,
  WORKOUT_HISTORY_CSV_HEADER,
  WORKOUT_IMPORT_MAX_FILE_BYTES,
} from './workoutHistoryImport';

const now = Date.parse('2026-09-10T12:00:00.000Z');
const header = WORKOUT_HISTORY_CSV_HEADER.join(',');
const row = (
  overrides: Partial<Record<(typeof WORKOUT_HISTORY_CSV_HEADER)[number], string>> = {},
) => {
  const value: Record<string, string> = {
    format_version: WORKOUT_HISTORY_CSV_FORMAT,
    dataset_id: 'strong-v1',
    workout_id: 'workout-1',
    started_at: '2026-09-09T10:00:00+02:00',
    completed_at: '2026-09-09T11:00:00+02:00',
    exercise_order: '1',
    exercise_id: 'source-bench',
    exercise_name: 'Bench Press',
    set_order: '1',
    set_role: 'working',
    reps: '8',
    load_kg: '80.5',
    time_seconds: '',
    distance_m: '',
    pace_min_per_km: '',
    rounds: '',
    ...overrides,
  };
  return WORKOUT_HISTORY_CSV_HEADER.map((key) => value[key]).join(',');
};
const csv = (...rows: string[]) => [header, ...rows].join('\n');

describe('workout history CSV parser', () => {
  it('normalizes a valid exact V1 file deterministically', () => {
    const first = parseWorkoutHistoryCsv(csv(row()), now);
    const second = parseWorkoutHistoryCsv(csv(row()), now);
    expect(first).toEqual(second);
    expect(first.valid && first.preview).toMatchObject({
      datasetId: 'strong-v1',
      rowCount: 1,
      exerciseCount: 1,
      setCount: 1,
      workouts: [
        {
          startedAt: '2026-09-09T08:00:00.000Z',
          completedAt: '2026-09-09T09:00:00.000Z',
        },
      ],
    });
  });

  it.each([
    ['UTF-8 BOM', `\ufeff${csv(row())}`],
    ['CRLF', csv(row()).replaceAll('\n', '\r\n')],
    ['quoted comma', csv(row({ exercise_name: '"Press, Barbell"' }))],
    ['escaped quote', csv(row({ exercise_name: '"Press ""strict"""' }))],
  ])('supports %s', (_name, value) => expect(parseWorkoutHistoryCsv(value, now).valid).toBe(true));

  it.each([
    ['wrong header', csv(row()).replace('format_version', 'format')],
    ['extra header', `${header},extra\n${row()},x`],
    ['malformed quote', csv(`${row().slice(0, -1)}"`)],
    ['wrong columns', csv('too,few')],
    ['empty dataset', csv(row({ dataset_id: '' }))],
    ['dataset mismatch', csv(row(), row({ dataset_id: 'other', set_order: '2' }))],
    ['control character', csv(row({ exercise_name: 'Bad\u0001name' }))],
    ['replacement character', csv(row({ exercise_name: 'Bad\ufffdname' }))],
    ['floating timestamp', csv(row({ started_at: '2026-09-09T10:00:00' }))],
    ['completed before start', csv(row({ completed_at: '2026-09-09T09:00:00+02:00' }))],
    ['future timestamp', csv(row({ completed_at: '2026-09-10T13:00:00Z' }))],
    ['noncontiguous exercise', csv(row({ exercise_order: '2' }))],
    ['noncontiguous set', csv(row({ set_order: '2' }))],
    ['empty metrics', csv(row({ reps: '', load_kg: '' }))],
    ['negative metric', csv(row({ reps: '', load_kg: '-1' }))],
    ['exponent metric', csv(row({ reps: '1e3', load_kg: '' }))],
    ['invalid role', csv(row({ set_role: 'drop' }))],
  ])('rejects %s', (_name, value) => expect(parseWorkoutHistoryCsv(value, now).valid).toBe(false));

  it.each(['=', '+', '-', '@'])('rejects %s spreadsheet prefixes in any cell', (prefix) => {
    expect(parseWorkoutHistoryCsv(csv(row({ exercise_name: `${prefix}SUM(A1)` })), now).valid).toBe(
      false,
    );
  });

  it('accepts every canonical metric and warmup sets', () => {
    const result = parseWorkoutHistoryCsv(
      csv(
        row({
          set_role: 'warmup',
          reps: '5',
          load_kg: '0',
          time_seconds: '20',
          distance_m: '100',
          pace_min_per_km: '5.5',
          rounds: '2',
        }),
      ),
      now,
    );
    expect(result.valid && result.preview.workouts[0].exercises[0].sets[0].values).toEqual({
      reps: 5,
      load: 0,
      time: 20,
      distance: 100,
      pace: 5.5,
      rounds: 2,
    });
  });

  it('rejects conflicting repeated exercise metadata and duplicate orders', () => {
    const conflict = parseWorkoutHistoryCsv(
      csv(row(), row({ set_order: '2', exercise_name: 'Different' })),
      now,
    );
    const duplicate = parseWorkoutHistoryCsv(csv(row(), row()), now);
    expect(conflict.valid).toBe(false);
    expect(duplicate.valid).toBe(false);
  });

  it('caps detailed errors at 100 while retaining total count', () => {
    const result = parseWorkoutHistoryCsv(csv(...Array.from({ length: 120 }, () => 'bad')), now);
    expect(result.valid).toBe(false);
    expect(result.errors.total).toBe(120);
    expect(result.errors.details).toHaveLength(100);
  });

  it('rejects files over 2 MiB', () => {
    const result = parseWorkoutHistoryCsv('x'.repeat(WORKOUT_IMPORT_MAX_FILE_BYTES + 1), now);
    expect(result.valid).toBe(false);
    expect(result.errors.details[0]?.code).toBe('file-too-large');
  });

  it('enforces row, workout, exercise and set bounds', () => {
    const tooManyRows = parseWorkoutHistoryCsv(
      csv(...Array.from({ length: 5_001 }, (_, index) => row({ set_order: String(index + 1) }))),
      now,
    );
    const tooManyWorkouts = parseWorkoutHistoryCsv(
      csv(
        ...Array.from({ length: 201 }, (_, index) => row({ workout_id: `workout-${index + 1}` })),
      ),
      now,
    );
    const tooManyExercises = parseWorkoutHistoryCsv(
      csv(
        ...Array.from({ length: 41 }, (_, index) =>
          row({
            exercise_order: String(index + 1),
            exercise_id: `exercise-${index + 1}`,
          }),
        ),
      ),
      now,
    );
    const tooManySets = parseWorkoutHistoryCsv(
      csv(...Array.from({ length: 201 }, (_, index) => row({ set_order: String(index + 1) }))),
      now,
    );
    expect(tooManyRows.valid).toBe(false);
    expect(tooManyWorkouts.valid).toBe(false);
    expect(tooManyExercises.valid).toBe(false);
    expect(tooManySets.valid).toBe(false);
  });

  it('revalidates structured input with exact keys and canonical ordering', () => {
    const parsed = parseWorkoutHistoryCsv(csv(row()), now);
    if (!parsed.valid) throw new Error('fixture invalid');
    expect(
      validateNormalizedWorkoutImport(WORKOUT_HISTORY_CSV_FORMAT, parsed.preview.workouts, now),
    ).toBe(true);
    expect(
      validateNormalizedWorkoutImport(
        WORKOUT_HISTORY_CSV_FORMAT,
        [{ ...parsed.preview.workouts[0], ownerUid: 'injected' }],
        now,
      ),
    ).toBe(false);
    expect(canonicalWorkoutImportPayload([...parsed.preview.workouts])).toEqual(
      parsed.preview.workouts,
    );
  });
});
