export const WORKOUT_HISTORY_IMPORT_CONTRACT = 'workout-history-import-v1' as const;
export const WORKOUT_HISTORY_IMPORT_BATCH_CONTRACT = 'workout-history-import-batch-v1' as const;
export const WORKOUT_HISTORY_CSV_FORMAT = 'optiform-workout-history-csv-v1' as const;

export const WORKOUT_HISTORY_CSV_HEADER = [
  'format_version',
  'dataset_id',
  'workout_id',
  'started_at',
  'completed_at',
  'exercise_order',
  'exercise_id',
  'exercise_name',
  'set_order',
  'set_role',
  'reps',
  'load_kg',
  'time_seconds',
  'distance_m',
  'pace_min_per_km',
  'rounds',
] as const;

export const WORKOUT_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const WORKOUT_IMPORT_MAX_ROWS = 5_000;
export const WORKOUT_IMPORT_MAX_WORKOUTS = 200;
export const WORKOUT_IMPORT_MAX_EXERCISES = 40;
export const WORKOUT_IMPORT_MAX_SETS = 200;
export const WORKOUT_IMPORT_MAX_ERRORS = 100;
export const WORKOUT_IMPORT_MAX_SESSION_MS = 24 * 60 * 60 * 1_000;
export const WORKOUT_IMPORT_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export type ImportedSetValues = {
  reps?: number;
  load?: number;
  time?: number;
  distance?: number;
  pace?: number;
  rounds?: number;
};

export type NormalizedImportSet = {
  order: number;
  role: 'working' | 'warmup';
  values: ImportedSetValues;
};

export type NormalizedImportExercise = {
  order: number;
  sourceExerciseId: string;
  exerciseName: string;
  sets: NormalizedImportSet[];
};

export type NormalizedImportWorkout = {
  datasetId: string;
  sourceWorkoutId: string;
  startedAt: string;
  completedAt: string;
  exercises: NormalizedImportExercise[];
};

export type ImportedWorkoutRecord = NormalizedImportWorkout & {
  schemaVersion: 1;
  contractVersion: typeof WORKOUT_HISTORY_IMPORT_CONTRACT;
  ownerUid: string;
  importedWorkoutId: string;
  recordOrigin: 'user-imported-history';
  trustState: 'historical-unverified';
  sourceFormat: typeof WORKOUT_HISTORY_CSV_FORMAT;
  recordDigestSha256: string;
  importBatchId: string;
  importedAt: string;
};

export type WorkoutImportBatch = {
  schemaVersion: 1;
  contractVersion: typeof WORKOUT_HISTORY_IMPORT_BATCH_CONTRACT;
  ownerUid: string;
  batchId: string;
  sourceFormat: typeof WORKOUT_HISTORY_CSV_FORMAT;
  datasetId: string;
  canonicalDigestSha256: string;
  status: 'committed' | 'rolled-back';
  inputWorkoutCount: number;
  createdWorkoutCount: number;
  duplicateWorkoutCount: number;
  createdImportedWorkoutIds: string[];
  createdAt: string;
  updatedAt: string;
  rolledBackAt?: string;
};

export type WorkoutImportError = {
  row?: number;
  code: string;
  message: string;
};

export type WorkoutImportErrorReport = {
  total: number;
  details: WorkoutImportError[];
};

export type ParsedWorkoutHistoryImport = {
  sourceFormat: typeof WORKOUT_HISTORY_CSV_FORMAT;
  datasetId: string;
  workouts: NormalizedImportWorkout[];
  rowCount: number;
  exerciseCount: number;
  setCount: number;
};

export type WorkoutHistoryParseResult =
  | { valid: true; preview: ParsedWorkoutHistoryImport; errors: WorkoutImportErrorReport }
  | { valid: false; preview: null; errors: WorkoutImportErrorReport };

type MutableExercise = Omit<NormalizedImportExercise, 'sets'> & {
  sets: Map<number, NormalizedImportSet>;
};
type MutableWorkout = Omit<NormalizedImportWorkout, 'exercises'> & {
  exercises: Map<number, MutableExercise>;
};

const SAFE_TOKEN = /^[A-Za-z0-9._:-]+$/;
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;
const FORBIDDEN_CELL_PREFIX = /^[=+\-@]/;
// Character-code validation is intentional at this untrusted text boundary.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_TEXT_CONTROL = /[\u0000-\u001f\u007f]/;

export function parseWorkoutHistoryCsv(
  input: string,
  nowMs = Date.now(),
): WorkoutHistoryParseResult {
  const report = createErrorCollector();
  if (new TextEncoder().encode(input).byteLength > WORKOUT_IMPORT_MAX_FILE_BYTES) {
    report.add('file-too-large', 'CSV must be 2 MiB or smaller.');
    return invalidResult(report);
  }
  const text = input.startsWith('\ufeff') ? input.slice(1) : input;
  if (text.includes('\u0000')) report.add('nul-byte', 'CSV must not contain NUL bytes.');
  if (text.includes('\ufffd'))
    report.add('replacement-character', 'CSV contains replacement-character-corrupt text.');
  // Newlines are the only accepted CSV controls; tabs and other controls are rejected.
  // eslint-disable-next-line no-control-regex
  if (/[\u0001-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    report.add('control-character', 'CSV contains an unsupported control character.');
  if (report.total) return invalidResult(report);

  const parsedRows = parseCsvRows(text);
  if (parsedRows.error) {
    report.add('malformed-csv', parsedRows.error);
    return invalidResult(report);
  }
  const rows = parsedRows.rows;
  while (rows.length && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === '') rows.pop();
  if (!rows.length) {
    report.add('missing-header', 'CSV header is required.');
    return invalidResult(report);
  }
  if (!sameStrings(rows[0], [...WORKOUT_HISTORY_CSV_HEADER]))
    report.add(
      'invalid-header',
      'CSV header and column order must match the V1 format exactly.',
      1,
    );
  const dataRows = rows.slice(1);
  if (dataRows.length > WORKOUT_IMPORT_MAX_ROWS)
    report.add('row-limit', `CSV may contain at most ${WORKOUT_IMPORT_MAX_ROWS} data rows.`);
  if (report.total) return invalidResult(report);

  const workouts = new Map<string, MutableWorkout>();
  let datasetId: string | null = null;
  for (const [index, row] of dataRows.entries()) {
    const rowNumber = index + 2;
    if (row.length !== WORKOUT_HISTORY_CSV_HEADER.length) {
      report.add('column-count', 'Data row has the wrong number of columns.', rowNumber);
      continue;
    }
    if (row.some((cell) => FORBIDDEN_CELL_PREFIX.test(cell.trim()))) {
      report.add(
        'formula-cell',
        'Spreadsheet-executable cell prefixes are not accepted.',
        rowNumber,
      );
      continue;
    }
    const [
      format,
      rawDatasetId,
      workoutId,
      startedAt,
      completedAt,
      exerciseOrder,
      exerciseId,
      exerciseName,
      setOrder,
      setRole,
      reps,
      load,
      time,
      distance,
      pace,
      rounds,
    ] = row.map((cell) => cell.trim());
    const before = report.total;
    if (format !== WORKOUT_HISTORY_CSV_FORMAT)
      report.add(
        'format-version',
        'format_version must be optiform-workout-history-csv-v1.',
        rowNumber,
      );
    if (!validToken(rawDatasetId, 64))
      report.add('dataset-id', 'dataset_id must be a 1–64 character safe token.', rowNumber);
    if (datasetId === null && validToken(rawDatasetId, 64)) datasetId = rawDatasetId;
    else if (datasetId !== null && rawDatasetId !== datasetId)
      report.add('dataset-mismatch', 'Every row must use the same dataset_id.', rowNumber);
    if (!validToken(workoutId, 128))
      report.add('workout-id', 'workout_id must be a 1–128 character safe token.', rowNumber);
    if (!validToken(exerciseId, 128))
      report.add('exercise-id', 'exercise_id must be a 1–128 character safe token.', rowNumber);
    if (!validPlainName(exerciseName))
      report.add('exercise-name', 'exercise_name must be 1–80 plain-text characters.', rowNumber);
    const normalizedStartedAt = normalizeTimestamp(startedAt);
    const normalizedCompletedAt = normalizeTimestamp(completedAt);
    if (!normalizedStartedAt)
      report.add(
        'started-at',
        'started_at requires a valid timestamp with an explicit zone.',
        rowNumber,
      );
    if (!normalizedCompletedAt)
      report.add(
        'completed-at',
        'completed_at requires a valid timestamp with an explicit zone.',
        rowNumber,
      );
    const parsedExerciseOrder = positiveInteger(exerciseOrder);
    const parsedSetOrder = positiveInteger(setOrder);
    if (parsedExerciseOrder === null)
      report.add('exercise-order', 'exercise_order must be a positive integer.', rowNumber);
    if (parsedSetOrder === null)
      report.add('set-order', 'set_order must be a positive integer.', rowNumber);
    if (setRole !== 'working' && setRole !== 'warmup')
      report.add('set-role', 'set_role must be working or warmup.', rowNumber);
    const values = parseMetrics({ reps, load, time, distance, pace, rounds }, report, rowNumber);
    if (!Object.keys(values).length)
      report.add('empty-set', 'Every set requires at least one supported metric.', rowNumber);
    if (report.total !== before) continue;

    let workout = workouts.get(workoutId);
    if (!workout) {
      workout = {
        datasetId: rawDatasetId,
        sourceWorkoutId: workoutId,
        startedAt: normalizedStartedAt!,
        completedAt: normalizedCompletedAt!,
        exercises: new Map(),
      };
      workouts.set(workoutId, workout);
      if (workouts.size > WORKOUT_IMPORT_MAX_WORKOUTS)
        report.add(
          'workout-limit',
          `An import may contain at most ${WORKOUT_IMPORT_MAX_WORKOUTS} workouts.`,
        );
    } else if (
      workout.datasetId !== rawDatasetId ||
      workout.startedAt !== normalizedStartedAt ||
      workout.completedAt !== normalizedCompletedAt
    ) {
      report.add(
        'workout-conflict',
        'Rows for one workout_id must use identical dataset and timestamps.',
        rowNumber,
      );
      continue;
    }
    let exercise = workout.exercises.get(parsedExerciseOrder!);
    if (!exercise) {
      exercise = {
        order: parsedExerciseOrder!,
        sourceExerciseId: exerciseId,
        exerciseName,
        sets: new Map(),
      };
      workout.exercises.set(parsedExerciseOrder!, exercise);
    } else if (exercise.sourceExerciseId !== exerciseId || exercise.exerciseName !== exerciseName) {
      report.add(
        'exercise-conflict',
        'Rows for one workout/exercise_order must use identical exercise metadata.',
        rowNumber,
      );
      continue;
    }
    if (exercise.sets.has(parsedSetOrder!)) {
      report.add('duplicate-set-order', 'set_order must be unique within an exercise.', rowNumber);
      continue;
    }
    exercise.sets.set(parsedSetOrder!, {
      order: parsedSetOrder!,
      role: setRole as NormalizedImportSet['role'],
      values,
    });
  }

  const normalized = [...workouts.values()]
    .sort((a, b) => a.sourceWorkoutId.localeCompare(b.sourceWorkoutId))
    .map((workout) => ({
      ...workout,
      exercises: [...workout.exercises.values()]
        .sort((a, b) => a.order - b.order)
        .map((exercise) => ({
          ...exercise,
          sets: [...exercise.sets.values()].sort((a, b) => a.order - b.order),
        })),
    }));
  validateWorkoutStructure(normalized, nowMs, report);
  if (!dataRows.length) report.add('empty-file', 'CSV must contain at least one data row.');
  if (report.total || !datasetId) return invalidResult(report);
  return {
    valid: true,
    preview: {
      sourceFormat: WORKOUT_HISTORY_CSV_FORMAT,
      datasetId,
      workouts: normalized,
      rowCount: dataRows.length,
      exerciseCount: normalized.reduce((total, workout) => total + workout.exercises.length, 0),
      setCount: normalized.reduce(
        (total, workout) =>
          total + workout.exercises.reduce((sets, exercise) => sets + exercise.sets.length, 0),
        0,
      ),
    },
    errors: report.value(),
  };
}

export function validateNormalizedWorkoutImport(
  sourceFormat: unknown,
  workouts: unknown,
  nowMs = Date.now(),
): workouts is NormalizedImportWorkout[] {
  if (sourceFormat !== WORKOUT_HISTORY_CSV_FORMAT || !Array.isArray(workouts)) return false;
  const report = createErrorCollector();
  if (!workouts.length || workouts.length > WORKOUT_IMPORT_MAX_WORKOUTS) return false;
  for (const workout of workouts) {
    if (
      !exactObject(workout, [
        'datasetId',
        'sourceWorkoutId',
        'startedAt',
        'completedAt',
        'exercises',
      ])
    )
      return false;
    const item = workout as Record<string, unknown>;
    if (
      !validToken(item.datasetId, 64) ||
      !validToken(item.sourceWorkoutId, 128) ||
      FORBIDDEN_CELL_PREFIX.test(String(item.datasetId)) ||
      FORBIDDEN_CELL_PREFIX.test(String(item.sourceWorkoutId)) ||
      !Array.isArray(item.exercises)
    )
      return false;
    for (const exercise of item.exercises) {
      if (!exactObject(exercise, ['order', 'sourceExerciseId', 'exerciseName', 'sets']))
        return false;
      const entry = exercise as Record<string, unknown>;
      if (
        !Number.isInteger(entry.order) ||
        !validToken(entry.sourceExerciseId, 128) ||
        FORBIDDEN_CELL_PREFIX.test(String(entry.sourceExerciseId)) ||
        !validPlainName(entry.exerciseName) ||
        FORBIDDEN_CELL_PREFIX.test(String(entry.exerciseName)) ||
        !Array.isArray(entry.sets)
      )
        return false;
      for (const set of entry.sets) {
        if (!exactObject(set, ['order', 'role', 'values'])) return false;
        const candidate = set as Record<string, unknown>;
        if (
          !Number.isInteger(candidate.order) ||
          !['working', 'warmup'].includes(String(candidate.role)) ||
          !validMetricObject(candidate.values)
        )
          return false;
      }
    }
  }
  const typed = workouts as NormalizedImportWorkout[];
  const totalSets = typed.reduce(
    (total, workout) =>
      total + workout.exercises.reduce((sets, exercise) => sets + exercise.sets.length, 0),
    0,
  );
  if (totalSets > WORKOUT_IMPORT_MAX_ROWS) return false;
  if (new Set(typed.map((workout) => workout.datasetId)).size !== 1) return false;
  if (new Set(typed.map((workout) => workout.sourceWorkoutId)).size !== typed.length) return false;
  validateWorkoutStructure(typed, nowMs, report);
  return report.total === 0;
}

export function canonicalWorkoutImportPayload(workouts: NormalizedImportWorkout[]) {
  return workouts
    .map((workout) => ({
      ...workout,
      exercises: workout.exercises
        .map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({
            ...set,
            values: orderedValues(set.values),
          })),
        }))
        .sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.sourceWorkoutId.localeCompare(b.sourceWorkoutId));
}

export function isImportedWorkoutRecord(value: unknown): value is ImportedWorkoutRecord {
  if (
    !exactObject(value, [
      'schemaVersion',
      'contractVersion',
      'ownerUid',
      'importedWorkoutId',
      'recordOrigin',
      'trustState',
      'sourceFormat',
      'datasetId',
      'sourceWorkoutId',
      'recordDigestSha256',
      'importBatchId',
      'startedAt',
      'completedAt',
      'exercises',
      'importedAt',
    ])
  )
    return false;
  const item = value as Record<string, unknown>;
  const normalized = {
    datasetId: item.datasetId,
    sourceWorkoutId: item.sourceWorkoutId,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    exercises: item.exercises,
  };
  return Boolean(
    item.schemaVersion === 1 &&
    item.contractVersion === WORKOUT_HISTORY_IMPORT_CONTRACT &&
    typeof item.ownerUid === 'string' &&
    validToken(item.importedWorkoutId, 80) &&
    item.recordOrigin === 'user-imported-history' &&
    item.trustState === 'historical-unverified' &&
    item.sourceFormat === WORKOUT_HISTORY_CSV_FORMAT &&
    validToken(item.datasetId, 64) &&
    validToken(item.sourceWorkoutId, 128) &&
    validSha(item.recordDigestSha256) &&
    validToken(item.importBatchId, 80) &&
    normalizeTimestamp(item.importedAt) === item.importedAt &&
    validateNormalizedWorkoutImport(item.sourceFormat, [normalized]),
  );
}

export function isWorkoutImportBatch(value: unknown): value is WorkoutImportBatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = [
    'schemaVersion',
    'contractVersion',
    'ownerUid',
    'batchId',
    'sourceFormat',
    'datasetId',
    'canonicalDigestSha256',
    'status',
    'inputWorkoutCount',
    'createdWorkoutCount',
    'duplicateWorkoutCount',
    'createdImportedWorkoutIds',
    'createdAt',
    'updatedAt',
    ...(item.rolledBackAt === undefined ? [] : ['rolledBackAt']),
  ];
  return (
    exactObject(value, keys) &&
    item.schemaVersion === 1 &&
    item.contractVersion === WORKOUT_HISTORY_IMPORT_BATCH_CONTRACT &&
    typeof item.ownerUid === 'string' &&
    validToken(item.batchId, 80) &&
    item.sourceFormat === WORKOUT_HISTORY_CSV_FORMAT &&
    validToken(item.datasetId, 64) &&
    validSha(item.canonicalDigestSha256) &&
    ['committed', 'rolled-back'].includes(String(item.status)) &&
    nonnegativeInteger(item.inputWorkoutCount) &&
    nonnegativeInteger(item.createdWorkoutCount) &&
    nonnegativeInteger(item.duplicateWorkoutCount) &&
    Number(item.inputWorkoutCount) ===
      Number(item.createdWorkoutCount) + Number(item.duplicateWorkoutCount) &&
    Array.isArray(item.createdImportedWorkoutIds) &&
    item.createdImportedWorkoutIds.length <= WORKOUT_IMPORT_MAX_WORKOUTS &&
    item.createdImportedWorkoutIds.length === item.createdWorkoutCount &&
    item.createdImportedWorkoutIds.every((id) => validToken(id, 80)) &&
    normalizeTimestamp(item.createdAt) === item.createdAt &&
    normalizeTimestamp(item.updatedAt) === item.updatedAt &&
    (item.status === 'rolled-back'
      ? normalizeTimestamp(item.rolledBackAt) === item.rolledBackAt
      : item.rolledBackAt === undefined)
  );
}

function validateWorkoutStructure(
  workouts: NormalizedImportWorkout[],
  nowMs: number,
  report: ReturnType<typeof createErrorCollector>,
) {
  for (const workout of workouts) {
    const started = normalizeTimestamp(workout.startedAt);
    const completed = normalizeTimestamp(workout.completedAt);
    if (!started || started !== workout.startedAt)
      report.add(
        'started-at',
        'startedAt must be normalized UTC ISO with an explicit source zone.',
      );
    if (!completed || completed !== workout.completedAt)
      report.add(
        'completed-at',
        'completedAt must be normalized UTC ISO with an explicit source zone.',
      );
    if (started && completed) {
      const duration = Date.parse(completed) - Date.parse(started);
      if (duration < 0) report.add('timestamp-order', 'completedAt must not precede startedAt.');
      if (duration > WORKOUT_IMPORT_MAX_SESSION_MS)
        report.add('session-duration', 'An imported workout may span at most 24 hours.');
      if (Date.parse(completed) > nowMs + WORKOUT_IMPORT_FUTURE_TOLERANCE_MS)
        report.add(
          'future-completion',
          'completedAt may not be more than five minutes in the future.',
        );
    }
    if (!workout.exercises.length || workout.exercises.length > WORKOUT_IMPORT_MAX_EXERCISES)
      report.add(
        'exercise-limit',
        `Each workout requires 1–${WORKOUT_IMPORT_MAX_EXERCISES} exercise entries.`,
      );
    if (!contiguous(workout.exercises.map((exercise) => exercise.order)))
      report.add('exercise-order', 'exercise_order must start at 1 and remain contiguous.');
    const setCount = workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0);
    if (setCount > WORKOUT_IMPORT_MAX_SETS)
      report.add('set-limit', `Each workout may contain at most ${WORKOUT_IMPORT_MAX_SETS} sets.`);
    for (const exercise of workout.exercises) {
      if (!exercise.sets.length || !contiguous(exercise.sets.map((set) => set.order)))
        report.add('set-order', 'set_order must start at 1 and remain contiguous per exercise.');
    }
  }
}

function parseCsvRows(text: string): { rows: string[][]; error?: string } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else field += character;
      continue;
    }
    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n')
      return { rows, error: 'Unexpected character after a closing quote.' };
    if (character === '"') {
      if (field.length) return { rows, error: 'Quote must begin at the start of a field.' };
      quoted = true;
      closedQuote = false;
    } else if (character === ',') {
      row.push(field);
      field = '';
      closedQuote = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closedQuote = false;
    } else field += character;
  }
  if (quoted) return { rows, error: 'Quoted field is not closed.' };
  row.push(field);
  rows.push(row);
  return { rows };
}

function parseMetrics(
  input: Record<'reps' | 'load' | 'time' | 'distance' | 'pace' | 'rounds', string>,
  report: ReturnType<typeof createErrorCollector>,
  row: number,
) {
  const values: ImportedSetValues = {};
  const specs = {
    reps: { integer: true, minExclusive: false, maximum: 10_000 },
    load: { integer: false, minExclusive: false, maximum: 2_000 },
    time: { integer: false, minExclusive: true, maximum: 86_400 },
    distance: { integer: false, minExclusive: true, maximum: 500_000 },
    pace: { integer: false, minExclusive: true, maximum: 120 },
    rounds: { integer: true, minExclusive: false, maximum: 10_000 },
  } as const;
  for (const metric of Object.keys(specs) as Array<keyof typeof specs>) {
    const raw = input[metric];
    if (!raw) continue;
    const spec = specs[metric];
    const pattern = spec.integer ? INTEGER : DECIMAL;
    const parsed = Number(raw);
    const minimum = metric === 'load' ? 0 : 1;
    if (
      !pattern.test(raw) ||
      !Number.isFinite(parsed) ||
      parsed < minimum ||
      (spec.minExclusive && parsed <= 0) ||
      parsed > spec.maximum
    )
      report.add('metric-value', `${metric} contains an invalid or out-of-range number.`, row);
    else values[metric] = parsed;
  }
  return values;
}

function validMetricObject(value: unknown): value is ImportedSetValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item);
  if (
    !keys.length ||
    keys.some((key) => !['reps', 'load', 'time', 'distance', 'pace', 'rounds'].includes(key))
  )
    return false;
  const valid = (key: string, maximum: number, positive: boolean, integer = false) => {
    const candidate = item[key];
    if (candidate === undefined) return true;
    return (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      (!positive ? candidate >= 0 : candidate > 0) &&
      candidate <= maximum &&
      (!integer || Number.isInteger(candidate))
    );
  };
  return (
    valid('reps', 10_000, true, true) &&
    valid('load', 2_000, false) &&
    valid('time', 86_400, true) &&
    valid('distance', 500_000, true) &&
    valid('pace', 120, true) &&
    valid('rounds', 10_000, true, true)
  );
}

function orderedValues(values: ImportedSetValues): ImportedSetValues {
  return Object.fromEntries(
    ['reps', 'load', 'time', 'distance', 'pace', 'rounds']
      .filter((key) => values[key as keyof ImportedSetValues] !== undefined)
      .map((key) => [key, values[key as keyof ImportedSetValues]]),
  ) as ImportedSetValues;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== 'string' || !EXPLICIT_ZONE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveInteger(value: string) {
  if (!INTEGER.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validToken(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximum &&
    SAFE_TOKEN.test(value)
  );
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function nonnegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validPlainName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 80 &&
    !FORBIDDEN_TEXT_CONTROL.test(value)
  );
}

function exactObject(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object)
      .sort()
      .join('|') === [...keys].sort().join('|'),
  );
}

function contiguous(values: number[]) {
  return values.every((value, index) => value === index + 1);
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createErrorCollector() {
  let total = 0;
  const details: WorkoutImportError[] = [];
  return {
    get total() {
      return total;
    },
    add(code: string, message: string, row?: number) {
      total += 1;
      if (details.length < WORKOUT_IMPORT_MAX_ERRORS)
        details.push({ code, message, ...(row === undefined ? {} : { row }) });
    },
    value: (): WorkoutImportErrorReport => ({ total, details }),
  };
}

function invalidResult(report: ReturnType<typeof createErrorCollector>): WorkoutHistoryParseResult {
  return { valid: false, preview: null, errors: report.value() };
}
