import type { CanonicalExercise } from './contracts.js';

export const TRAINING_PROGRAMS_CONTRACT = 'training-programs-v1' as const;
const METRICS = ['reps', 'load', 'time', 'distance', 'pace', 'rounds'] as const;
type Metric = (typeof METRICS)[number];
type Value = Record<string, unknown>;
type Source = { index: Value; version: Value; days: Value[] };

const record = (value: unknown): Value | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Value) : null;
const only = (value: Value, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const text = (value: unknown, maximum: number, optional = false) =>
  typeof value === 'string' &&
  (optional && value === '' ? true : value.trim().length > 0) &&
  value.length <= maximum;
const fail = (): never => {
  throw new Error('source-structure-invalid');
};
const requiredRecord = (value: unknown): Value => record(value) ?? fail();
const requiredArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : fail());

export function validateCreatorDeliverySource(
  source: Source,
  ownerUid: string,
  programId: string,
  versionId: string,
  canonical: ReadonlyMap<string, CanonicalExercise>,
) {
  validateIndex(source.index, ownerUid, programId);
  validateVersion(source.version, ownerUid, programId, versionId);
  if (source.days.length > 364 || source.days.length > Number(source.version.durationWeeks) * 7)
    fail();
  const dayKeys = new Set<string>();
  for (const day of source.days) {
    validateDay(day, source.version, canonical);
    const key = `${day.weekNumber}:${day.dayOfWeek}`;
    if (dayKeys.has(key)) fail();
    dayKeys.add(key);
  }
}

function validateIndex(index: Value, uid: string, programId: string) {
  if (
    !only(index, [
      'schemaVersion',
      'contractVersion',
      'ownerUid',
      'programId',
      'source',
      'name',
      'currentVersionId',
      'currentVersionNumber',
      'status',
      'createdAt',
      'updatedAt',
    ]) ||
    index.schemaVersion !== 1 ||
    index.contractVersion !== TRAINING_PROGRAMS_CONTRACT ||
    index.ownerUid !== uid ||
    index.programId !== programId ||
    index.source !== 'athlete' ||
    !/^program-[A-Za-z0-9-]+$/.test(programId) ||
    !text(index.name, 80) ||
    !/^v[1-9][0-9]*$/.test(String(index.currentVersionId)) ||
    !Number.isInteger(index.currentVersionNumber) ||
    Number(index.currentVersionNumber) < 1 ||
    index.currentVersionId !== `v${index.currentVersionNumber}` ||
    !['active', 'archived'].includes(String(index.status))
  )
    fail();
}

function validateVersion(version: Value, uid: string, programId: string, versionId: string) {
  if (
    !only(version, [
      'schemaVersion',
      'contractVersion',
      'ownerUid',
      'programId',
      'versionId',
      'versionNumber',
      'name',
      'description',
      'note',
      'durationWeeks',
      'createdAt',
    ]) ||
    version.schemaVersion !== 1 ||
    version.contractVersion !== TRAINING_PROGRAMS_CONTRACT ||
    version.ownerUid !== uid ||
    version.programId !== programId ||
    version.versionId !== versionId ||
    !/^v[1-9][0-9]*$/.test(versionId) ||
    !Number.isInteger(version.versionNumber) ||
    versionId !== `v${version.versionNumber}` ||
    !text(version.name, 80) ||
    (version.description !== undefined && !text(version.description, 1000, true)) ||
    (version.note !== undefined && !text(version.note, 1000, true)) ||
    !Number.isInteger(version.durationWeeks) ||
    Number(version.durationWeeks) < 1 ||
    Number(version.durationWeeks) > 52
  )
    fail();
}

function validateDay(
  day: Value,
  version: Value,
  canonical: ReadonlyMap<string, CanonicalExercise>,
) {
  const exercises = requiredArray(day.exercises);
  const groups = requiredArray(day.groups);
  if (
    !only(day, [
      'schemaVersion',
      'contractVersion',
      'ownerUid',
      'programId',
      'versionId',
      'dayId',
      'weekNumber',
      'dayOfWeek',
      'weekKind',
      'label',
      'note',
      'exercises',
      'groups',
      'createdAt',
    ]) ||
    day.schemaVersion !== 1 ||
    day.contractVersion !== TRAINING_PROGRAMS_CONTRACT ||
    day.ownerUid !== version.ownerUid ||
    day.programId !== version.programId ||
    day.versionId !== version.versionId ||
    !Number.isInteger(day.weekNumber) ||
    Number(day.weekNumber) < 1 ||
    Number(day.weekNumber) > Number(version.durationWeeks) ||
    !Number.isInteger(day.dayOfWeek) ||
    Number(day.dayOfWeek) < 1 ||
    Number(day.dayOfWeek) > 7 ||
    day.dayId !== `w${day.weekNumber}-d${day.dayOfWeek}` ||
    !['standard', 'deload'].includes(String(day.weekKind)) ||
    !text(day.label, 80) ||
    (day.note !== undefined && !text(day.note, 1000, true)) ||
    exercises.length > 20 ||
    groups.length > 20
  )
    fail();
  const exerciseIds = new Set<string>();
  exercises.forEach((raw, index) => {
    const exercise = requiredRecord(raw);
    validateExercise(exercise, index + 1, canonical);
    const id = String(exercise.exercisePlanId);
    if (exerciseIds.has(id)) fail();
    exerciseIds.add(id);
  });
  const groupIds = new Set<string>();
  for (const raw of groups) {
    const group = requiredRecord(raw);
    if (
      !only(group, [
        'groupPlanId',
        'type',
        'memberExercisePlanIds',
        'startWorkingSetOrder',
        'roundCount',
      ])
    )
      fail();
    const id = String(group.groupPlanId ?? '');
    const members = Array.isArray(group.memberExercisePlanIds) ? group.memberExercisePlanIds : [];
    const type = String(group.type);
    if (
      !id ||
      id.length > 128 ||
      groupIds.has(id) ||
      !['superset', 'giant-set'].includes(type) ||
      (type === 'superset' && members.length !== 2) ||
      (type === 'giant-set' && (members.length < 3 || members.length > 6)) ||
      new Set(members).size !== members.length ||
      members.some((member) => typeof member !== 'string' || !exerciseIds.has(member)) ||
      !Number.isInteger(group.startWorkingSetOrder) ||
      Number(group.startWorkingSetOrder) < 1 ||
      !Number.isInteger(group.roundCount) ||
      Number(group.roundCount) < 1
    )
      fail();
    groupIds.add(id);
  }
}

function validateExercise(
  exercise: Value,
  order: number,
  canonical: ReadonlyMap<string, CanonicalExercise>,
) {
  const snapshot = requiredRecord(exercise.exercise);
  const profile = requiredRecord(snapshot.trackingProfile);
  const sets = requiredArray(exercise.setPlans);
  const progression = requiredRecord(exercise.progression);
  if (snapshot.source !== 'system') throw new Error('custom-exercise-denied');
  if (
    !only(exercise, [
      'exercisePlanId',
      'order',
      'exercise',
      'note',
      'instructionText',
      'instructionUrl',
      'setPlans',
      'progression',
    ]) ||
    !/^pex-[A-Za-z0-9-]+$/.test(String(exercise.exercisePlanId)) ||
    exercise.order !== order ||
    !only(snapshot, [
      'source',
      'exerciseId',
      'name',
      'trackingProfile',
      'trainingClassification',
      'equipment',
    ]) ||
    !text(snapshot.exerciseId, 128) ||
    !text(snapshot.name, 160) ||
    !validProfile(profile) ||
    (exercise.note !== undefined && !text(exercise.note, 1000, true)) ||
    (exercise.instructionText !== undefined && !text(exercise.instructionText, 1000, true)) ||
    (exercise.instructionUrl !== undefined &&
      (typeof exercise.instructionUrl !== 'string' ||
        exercise.instructionUrl.length > 2048 ||
        !/^https:\/\//i.test(exercise.instructionUrl))) ||
    sets.length < 1 ||
    sets.length > 20
  )
    fail();
  const canonicalExercise = canonical.get(String(snapshot.exerciseId));
  if (
    !canonicalExercise ||
    canonicalExercise.id !== snapshot.exerciseId ||
    canonicalExercise.source !== 'system' ||
    canonicalExercise.status !== 'published'
  )
    throw new Error('canonical-exercise-unavailable');
  const canonicalProfile = requiredRecord(canonicalExercise.trackingProfile);
  if (!validProfile(canonicalProfile)) fail();
  const sourceSupported = profile.supportedMetrics as Metric[];
  const supported = canonicalProfile.supportedMetrics as Metric[];
  const setIds = new Set<string>();
  sets.forEach((raw, index) => {
    const set = requiredRecord(raw);
    validateSet(set, index + 1, sourceSupported);
    validateSet(set, index + 1, supported);
    const id = String(set.setPlanId);
    if (setIds.has(id)) fail();
    setIds.add(id);
  });
  const validSets = sets.map(requiredRecord);
  validateProgression(progression, sourceSupported, validSets);
  validateProgression(progression, supported, validSets);
}

function validProfile(profile: Value) {
  const supported = profile.supportedMetrics;
  return (
    only(profile, ['primaryMetric', 'supportedMetrics']) &&
    METRICS.includes(profile.primaryMetric as Metric) &&
    Array.isArray(supported) &&
    supported.length > 0 &&
    new Set(supported).size === supported.length &&
    supported.every((metric) => METRICS.includes(metric as Metric)) &&
    supported.includes(profile.primaryMetric)
  );
}

function validateSet(set: Value, order: number, supported: Metric[]) {
  const execution = requiredRecord(set.executionPlan);
  const prescription = requiredRecord(set.prescription);
  if (
    !only(set, ['setPlanId', 'order', 'role', 'executionPlan', 'prescription']) ||
    !/^pset-[A-Za-z0-9-]+$/.test(String(set.setPlanId)) ||
    set.order !== order ||
    !['working', 'warmup'].includes(String(set.role)) ||
    !only(execution, ['kind', 'tempo', 'additionalSegmentCount']) ||
    !only(prescription, ['metrics', 'effort', 'assistanceKg', 'segmentTargets'])
  )
    fail();
  const kind = String(execution.kind);
  const count = execution.additionalSegmentCount ?? 0;
  if (
    !['standard', 'amrap', 'assisted', 'drop-set', 'rest-pause'].includes(kind) ||
    (set.role === 'warmup' && kind !== 'standard') ||
    !Number.isInteger(count) ||
    Number(count) < 0 ||
    Number(count) > 7 ||
    (['drop-set', 'rest-pause'].includes(kind) ? Number(count) < 1 : Number(count) !== 0) ||
    !validTempo(execution.tempo)
  )
    fail();
  validatePrescription(prescription, supported, kind, Number(count));
}

function validTempo(value: unknown) {
  if (value === undefined) return true;
  const tempo = record(value);
  if (
    !tempo ||
    !only(tempo, ['eccentricSeconds', 'bottomPauseSeconds', 'concentric', 'topPauseSeconds'])
  )
    return false;
  const whole = (item: unknown) =>
    Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 10;
  return (
    whole(tempo.eccentricSeconds) &&
    whole(tempo.bottomPauseSeconds) &&
    (tempo.concentric === 'X' || whole(tempo.concentric)) &&
    whole(tempo.topPauseSeconds)
  );
}

function validatePrescription(
  prescription: Value,
  supported: Metric[],
  executionKind: string,
  segmentCount: number,
) {
  const metrics = requiredRecord(prescription.metrics);
  for (const [metric, target] of Object.entries(metrics))
    if (!supported.includes(metric as Metric) || !validTarget(target, metric as Metric)) fail();
  if (prescription.effort !== undefined) {
    const effort = record(prescription.effort);
    if (
      !effort ||
      !only(effort, ['scale', 'target']) ||
      !['rpe', 'rir'].includes(String(effort.scale)) ||
      !validEffortTarget(effort.target, effort.scale as 'rpe' | 'rir')
    )
      fail();
  }
  if (
    prescription.assistanceKg !== undefined &&
    (executionKind !== 'assisted' || !validTarget(prescription.assistanceKg, 'load'))
  )
    fail();
  const segments = prescription.segmentTargets;
  if ((Array.isArray(segments) ? segments.length : 0) !== segmentCount) fail();
  for (const raw of Array.isArray(segments) ? segments : []) {
    const segment = requiredRecord(raw);
    for (const [metric, target] of Object.entries(segment))
      if (!supported.includes(metric as Metric) || !validTarget(target, metric as Metric)) fail();
  }
}

function validTarget(value: unknown, metric: Metric) {
  const target = record(value);
  if (!target) return false;
  if (target.kind === 'exact' && only(target, ['kind', 'value']))
    return validMetric(metric, target.value);
  return (
    target.kind === 'range' &&
    only(target, ['kind', 'minimum', 'maximum']) &&
    validMetric(metric, target.minimum) &&
    validMetric(metric, target.maximum) &&
    Number(target.minimum) <= Number(target.maximum)
  );
}

function validMetric(metric: Metric, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  if (['reps', 'rounds'].includes(metric) && !Number.isInteger(value)) return false;
  return metric === 'load' || value > 0;
}

function validEffortTarget(value: unknown, scale: 'rpe' | 'rir') {
  const target = record(value);
  if (!target) return false;
  const minimum = scale === 'rpe' ? 1 : 0;
  const valid = (item: unknown) =>
    typeof item === 'number' &&
    Number.isFinite(item) &&
    item >= minimum &&
    item <= 10 &&
    (item * 2) % 1 === 0;
  if (target.kind === 'exact' && only(target, ['kind', 'value'])) return valid(target.value);
  return (
    target.kind === 'range' &&
    only(target, ['kind', 'minimum', 'maximum']) &&
    valid(target.minimum) &&
    valid(target.maximum) &&
    Number(target.minimum) <= Number(target.maximum)
  );
}

function validateProgression(progression: Value, supported: Metric[], sets: Value[]) {
  if (progression.kind === 'manual' && only(progression, ['kind'])) return;
  const range = record(progression.repRange);
  if (
    progression.kind !== 'double-progression' ||
    !only(progression, ['kind', 'repRange', 'loadIncrementKg', 'startingLoadKg']) ||
    !supported.includes('load') ||
    !supported.includes('reps') ||
    !range ||
    !only(range, ['minimum', 'maximum']) ||
    !Number.isInteger(range.minimum) ||
    Number(range.minimum) < 1 ||
    !Number.isInteger(range.maximum) ||
    Number(range.maximum) < Number(range.minimum) ||
    typeof progression.loadIncrementKg !== 'number' ||
    progression.loadIncrementKg < 0.5 ||
    progression.loadIncrementKg > 25 ||
    (progression.loadIncrementKg * 2) % 1 !== 0 ||
    (progression.startingLoadKg !== undefined &&
      (typeof progression.startingLoadKg !== 'number' || progression.startingLoadKg < 0)) ||
    sets
      .filter((set) => set.role === 'working')
      .some((set) => {
        const execution = record(set.executionPlan);
        return execution?.kind !== 'standard' || Number(execution.additionalSegmentCount ?? 0) > 0;
      })
  )
    fail();
}
