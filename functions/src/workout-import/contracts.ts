import { createHash } from 'node:crypto';

export const IMPORT_CONTRACT = 'workout-history-import-v1' as const;
export const IMPORT_BATCH_CONTRACT = 'workout-history-import-batch-v1' as const;
export const IMPORT_CSV_FORMAT = 'optiform-workout-history-csv-v1' as const;
export const IMPORT_MAX_WORKOUTS = 200;
export const IMPORT_MAX_EXERCISES = 40;
export const IMPORT_MAX_SETS = 200;
export const IMPORT_MAX_ROWS = 5_000;
const MAX_SESSION_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 300_000;
const TOKEN = /^[A-Za-z0-9._:-]+$/;
const SHA = /^[a-f0-9]{64}$/;

export type ImportSetValues = Partial<
  Record<'reps' | 'load' | 'time' | 'distance' | 'pace' | 'rounds', number>
>;
export type ImportSet = { order: number; role: 'working' | 'warmup'; values: ImportSetValues };
export type ImportExercise = {
  order: number;
  sourceExerciseId: string;
  exerciseName: string;
  sets: ImportSet[];
};
export type ImportWorkout = {
  datasetId: string;
  sourceWorkoutId: string;
  startedAt: string;
  completedAt: string;
  exercises: ImportExercise[];
};
export type ImportRequest = {
  sourceFormat: typeof IMPORT_CSV_FORMAT;
  workouts: ImportWorkout[];
};

export function parsePreviewRequest(input: unknown, now = new Date()): ImportRequest {
  if (!exactObject(input, ['sourceFormat', 'workouts'])) throw new Error('invalid-request');
  return validateRequest(input as Record<string, unknown>, now);
}

export function parseCommitRequest(
  input: unknown,
  now = new Date(),
): ImportRequest & { expectedCanonicalDigestSha256: string } {
  if (!exactObject(input, ['sourceFormat', 'workouts', 'expectedCanonicalDigestSha256']))
    throw new Error('invalid-request');
  const value = input as Record<string, unknown>;
  if (
    typeof value.expectedCanonicalDigestSha256 !== 'string' ||
    !SHA.test(value.expectedCanonicalDigestSha256)
  )
    throw new Error('invalid-request');
  return {
    ...validateRequest(value, now),
    expectedCanonicalDigestSha256: value.expectedCanonicalDigestSha256,
  };
}

export function parseRollbackRequest(input: unknown) {
  if (!exactObject(input, ['batchId'])) throw new Error('invalid-request');
  const batchId = (input as Record<string, unknown>).batchId;
  if (!validToken(batchId, 80)) throw new Error('invalid-request');
  return { batchId };
}

export function canonicalizeImport(workouts: ImportWorkout[]) {
  return workouts
    .map((workout) => ({
      datasetId: workout.datasetId,
      sourceWorkoutId: workout.sourceWorkoutId,
      startedAt: workout.startedAt,
      completedAt: workout.completedAt,
      exercises: workout.exercises
        .map((exercise) => ({
          order: exercise.order,
          sourceExerciseId: exercise.sourceExerciseId,
          exerciseName: exercise.exerciseName,
          sets: exercise.sets
            .map((set) => ({ order: set.order, role: set.role, values: orderedValues(set.values) }))
            .sort((a, b) => a.order - b.order),
        }))
        .sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.sourceWorkoutId.localeCompare(b.sourceWorkoutId));
}

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export const canonicalDigest = (workouts: ImportWorkout[]) =>
  sha256(
    JSON.stringify({ sourceFormat: IMPORT_CSV_FORMAT, workouts: canonicalizeImport(workouts) }),
  );
export const importedWorkoutId = (workout: ImportWorkout) =>
  `imported-${sha256(`${IMPORT_CSV_FORMAT}\u001f${workout.datasetId}\u001f${workout.sourceWorkoutId}`)}`;
export const recordDigest = (workout: ImportWorkout) =>
  sha256(
    JSON.stringify({
      startedAt: workout.startedAt,
      completedAt: workout.completedAt,
      exercises: canonicalizeImport([workout])[0].exercises,
    }),
  );
export const contentClaimId = (uid: string, digest: string) => sha256(`${uid}\u001f${digest}`);

function validateRequest(value: Record<string, unknown>, now: Date): ImportRequest {
  if (value.sourceFormat !== IMPORT_CSV_FORMAT || !Array.isArray(value.workouts))
    throw new Error('invalid-request');
  if (!value.workouts.length || value.workouts.length > IMPORT_MAX_WORKOUTS)
    throw new Error('invalid-request');
  const workouts = value.workouts.map((workout) => validateWorkout(workout, now));
  if (
    workouts.reduce(
      (total, workout) =>
        total + workout.exercises.reduce((sets, exercise) => sets + exercise.sets.length, 0),
      0,
    ) > IMPORT_MAX_ROWS
  )
    throw new Error('invalid-request');
  if (new Set(workouts.map((item) => item.datasetId)).size !== 1)
    throw new Error('invalid-request');
  if (new Set(workouts.map((item) => item.sourceWorkoutId)).size !== workouts.length)
    throw new Error('invalid-request');
  return { sourceFormat: IMPORT_CSV_FORMAT, workouts: canonicalizeImport(workouts) };
}

function validateWorkout(input: unknown, now: Date): ImportWorkout {
  if (
    !exactObject(input, ['datasetId', 'sourceWorkoutId', 'startedAt', 'completedAt', 'exercises'])
  )
    throw new Error('invalid-request');
  const value = input as Record<string, unknown>;
  if (!validToken(value.datasetId, 64) || !validToken(value.sourceWorkoutId, 128))
    throw new Error('invalid-request');
  const startedAt = normalizedTimestamp(value.startedAt);
  const completedAt = normalizedTimestamp(value.completedAt);
  if (
    !startedAt ||
    !completedAt ||
    startedAt !== value.startedAt ||
    completedAt !== value.completedAt
  )
    throw new Error('invalid-request');
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  if (
    duration < 0 ||
    duration > MAX_SESSION_MS ||
    Date.parse(completedAt) > now.getTime() + FUTURE_TOLERANCE_MS
  )
    throw new Error('invalid-request');
  if (
    !Array.isArray(value.exercises) ||
    !value.exercises.length ||
    value.exercises.length > IMPORT_MAX_EXERCISES
  )
    throw new Error('invalid-request');
  const exercises = value.exercises.map(validateExercise);
  if (!contiguous(exercises.map((item) => item.order))) throw new Error('invalid-request');
  if (exercises.reduce((sum, item) => sum + item.sets.length, 0) > IMPORT_MAX_SETS)
    throw new Error('invalid-request');
  return {
    datasetId: value.datasetId,
    sourceWorkoutId: value.sourceWorkoutId,
    startedAt,
    completedAt,
    exercises,
  };
}

function validateExercise(input: unknown): ImportExercise {
  if (!exactObject(input, ['order', 'sourceExerciseId', 'exerciseName', 'sets']))
    throw new Error('invalid-request');
  const value = input as Record<string, unknown>;
  if (
    !Number.isInteger(value.order) ||
    !validToken(value.sourceExerciseId, 128) ||
    !plainName(value.exerciseName) ||
    !Array.isArray(value.sets) ||
    !value.sets.length
  )
    throw new Error('invalid-request');
  const sets = value.sets.map(validateSet);
  if (!contiguous(sets.map((item) => item.order))) throw new Error('invalid-request');
  return {
    order: value.order as number,
    sourceExerciseId: value.sourceExerciseId,
    exerciseName: value.exerciseName,
    sets,
  };
}

function validateSet(input: unknown): ImportSet {
  if (!exactObject(input, ['order', 'role', 'values'])) throw new Error('invalid-request');
  const value = input as Record<string, unknown>;
  if (!Number.isInteger(value.order) || !['working', 'warmup'].includes(String(value.role)))
    throw new Error('invalid-request');
  const values = validateValues(value.values);
  return { order: value.order as number, role: value.role as ImportSet['role'], values };
}

function validateValues(input: unknown): ImportSetValues {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('invalid-request');
  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    !keys.length ||
    keys.some((key) => !['reps', 'load', 'time', 'distance', 'pace', 'rounds'].includes(key))
  )
    throw new Error('invalid-request');
  const valid = (key: string, max: number, minimum: number, integer = false) => {
    const candidate = value[key];
    return (
      candidate === undefined ||
      (typeof candidate === 'number' &&
        Number.isFinite(candidate) &&
        candidate >= minimum &&
        candidate <= max &&
        (!integer || Number.isInteger(candidate)))
    );
  };
  if (
    !valid('reps', 10_000, 1, true) ||
    !valid('load', 2_000, 0) ||
    !valid('time', 86_400, Number.MIN_VALUE) ||
    !valid('distance', 500_000, Number.MIN_VALUE) ||
    !valid('pace', 120, Number.MIN_VALUE) ||
    !valid('rounds', 10_000, 1, true)
  )
    throw new Error('invalid-request');
  return orderedValues(value as ImportSetValues);
}

function orderedValues(values: ImportSetValues): ImportSetValues {
  return Object.fromEntries(
    ['reps', 'load', 'time', 'distance', 'pace', 'rounds']
      .filter((key) => values[key as keyof ImportSetValues] !== undefined)
      .map((key) => [key, values[key as keyof ImportSetValues]]),
  );
}
function exactObject(input: unknown, keys: string[]) {
  return Boolean(
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input as object)
      .sort()
      .join('|') === [...keys].sort().join('|'),
  );
}
function validToken(input: unknown, max: number): input is string {
  return (
    typeof input === 'string' &&
    input.length >= 1 &&
    input.length <= max &&
    TOKEN.test(input) &&
    !/^[=+\-@]/.test(input)
  );
}
function plainName(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input === input.trim() &&
    input.length >= 1 &&
    input.length <= 80 &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(input) &&
    !/^[=+\-@]/.test(input)
  );
}
function normalizedTimestamp(input: unknown) {
  if (typeof input !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function contiguous(values: number[]) {
  return values.every((value, index) => value === index + 1);
}
