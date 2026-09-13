import { Timestamp } from 'firebase-admin/firestore';
import { cleanText } from '../creator-membership/contracts.js';
import {
  CREATOR_MEMBERSHIP_CHALLENGE_EVIDENCE_CONTRACT,
  CREATOR_MEMBERSHIP_CHALLENGE_PARTICIPATION_CONTRACT,
  evidenceId,
} from './contracts.js';

type RecordValue = Record<string, unknown>;
const METRICS = ['reps', 'load', 'time', 'distance', 'pace', 'rounds'] as const;
const PARTICIPANT_PATTERN = /^creator-challenge-participant-[0-9a-f-]{36}$/i;

const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
const exactKeys = (value: RecordValue, keys: string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const optionalKeys = (value: RecordValue, required: string[], optional: string[]) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const iso = (value: unknown) =>
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const timestamp = (value: unknown): value is Timestamp => value instanceof Timestamp;
const participantIdValid = (value: unknown): value is string =>
  typeof value === 'string' && PARTICIPANT_PATTERN.test(value);

function validMetric(metric: string, value: unknown) {
  if (!METRICS.includes(metric as (typeof METRICS)[number]) || typeof value !== 'number')
    return false;
  if (!Number.isFinite(value) || value < 0) return false;
  if ((metric === 'reps' || metric === 'rounds') && !Number.isInteger(value)) return false;
  return metric === 'load' || value > 0;
}

function validValues(value: unknown, primary: string, supported: string[]) {
  const values = record(value);
  if (!values || values[primary] === undefined) return false;
  return Object.entries(values).every(
    ([metric, amount]) => supported.includes(metric) && validMetric(metric, amount),
  );
}

function validProgramContext(value: unknown) {
  const context = record(value);
  if (!context) return false;
  const common = [
    'contractVersion',
    'programSource',
    'enrollmentId',
    'programName',
    'sessionLabel',
    'weekNumber',
    'dayOfWeek',
    'sessionKey',
    'scheduledDateLocal',
  ];
  const commonValid =
    Number.isInteger(context.weekNumber) &&
    Number(context.weekNumber) >= 1 &&
    Number(context.weekNumber) <= 52 &&
    Number.isInteger(context.dayOfWeek) &&
    Number(context.dayOfWeek) >= 1 &&
    Number(context.dayOfWeek) <= 7 &&
    context.sessionKey === `w${context.weekNumber}-d${context.dayOfWeek}` &&
    typeof context.scheduledDateLocal === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(context.scheduledDateLocal) &&
    typeof context.programName === 'string' &&
    context.programName.length >= 1 &&
    context.programName.length <= 80 &&
    typeof context.sessionLabel === 'string' &&
    context.sessionLabel.length >= 1 &&
    context.sessionLabel.length <= 80;
  if (!commonValid) return false;
  if (context.contractVersion === 'workout-program-provenance-v1') {
    return (
      exactKeys(context, [...common, 'programId', 'programVersionId']) &&
      ['athlete', 'optiform-system'].includes(String(context.programSource)) &&
      typeof context.enrollmentId === 'string' &&
      /^enrollment-/.test(context.enrollmentId) &&
      typeof context.programId === 'string' &&
      /^program-/.test(context.programId) &&
      typeof context.programVersionId === 'string' &&
      /^v\d+$/.test(context.programVersionId)
    );
  }
  if (context.contractVersion === 'workout-program-provenance-v2') {
    return (
      exactKeys(context, [
        ...common,
        'listingId',
        'creatorId',
        'publicationVersionId',
        'deliveryDayId',
      ]) &&
      context.programSource === 'creator-entitled' &&
      typeof context.enrollmentId === 'string' &&
      /^creator-enrollment-[A-Za-z0-9-]+$/.test(context.enrollmentId) &&
      ['listingId', 'creatorId', 'publicationVersionId', 'deliveryDayId'].every((key) =>
        nonEmpty(context[key]),
      )
    );
  }
  if (context.contractVersion === 'workout-program-provenance-v3') {
    return (
      exactKeys(context, [
        ...common,
        'gymId',
        'gymProgramId',
        'publicationVersionId',
        'deliveryDayId',
      ]) &&
      context.programSource === 'gym-program' &&
      typeof context.enrollmentId === 'string' &&
      /^gym-program-enrollment-[A-Za-z0-9-]+$/.test(context.enrollmentId) &&
      ['gymId', 'gymProgramId', 'publicationVersionId', 'deliveryDayId'].every((key) =>
        nonEmpty(context[key]),
      )
    );
  }
  return false;
}

function validExecution(value: unknown, role: unknown, profile: RecordValue) {
  const execution = record(value);
  if (
    !execution ||
    !optionalKeys(execution, ['kind'], ['effort', 'tempo', 'assistanceKg', 'additionalSegments'])
  )
    return false;
  const kind = String(execution.kind);
  if (
    !['standard', 'amrap', 'assisted', 'drop-set', 'rest-pause'].includes(kind) ||
    (role === 'warmup' && kind !== 'standard')
  )
    return false;
  if (execution.effort !== undefined) {
    const effort = record(execution.effort);
    if (!effort || !exactKeys(effort, ['scale', 'value'])) return false;
    const minimum = effort.scale === 'rpe' ? 1 : 0;
    if (
      !['rpe', 'rir'].includes(String(effort.scale)) ||
      typeof effort.value !== 'number' ||
      effort.value < minimum ||
      effort.value > 10 ||
      effort.value * 2 !== Math.round(effort.value * 2)
    )
      return false;
  }
  if (execution.tempo !== undefined) {
    const tempo = record(execution.tempo);
    if (
      !tempo ||
      !exactKeys(tempo, ['eccentricSeconds', 'bottomPauseSeconds', 'concentric', 'topPauseSeconds'])
    )
      return false;
    const values = [
      tempo.eccentricSeconds,
      tempo.bottomPauseSeconds,
      tempo.topPauseSeconds,
      ...(tempo.concentric === 'X' ? [] : [tempo.concentric]),
    ];
    if (!values.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 10))
      return false;
  }
  if (
    execution.assistanceKg !== undefined &&
    (typeof execution.assistanceKg !== 'number' ||
      !Number.isFinite(execution.assistanceKg) ||
      execution.assistanceKg < 0 ||
      kind !== 'assisted')
  )
    return false;
  const segments = execution.additionalSegments ?? [];
  if (
    !Array.isArray(segments) ||
    segments.length > 7 ||
    (['drop-set', 'rest-pause'].includes(kind) ? segments.length === 0 : segments.length > 0)
  )
    return false;
  const ids = new Set<string>();
  for (const [index, raw] of segments.entries()) {
    const segment = record(raw);
    if (
      !segment ||
      !optionalKeys(segment, ['id', 'order', 'values'], ['pauseBeforeSeconds']) ||
      !nonEmpty(segment.id) ||
      ids.has(String(segment.id)) ||
      segment.order !== index + 1
    )
      return false;
    ids.add(String(segment.id));
    if (
      segment.pauseBeforeSeconds !== undefined &&
      (!Number.isInteger(segment.pauseBeforeSeconds) ||
        Number(segment.pauseBeforeSeconds) < 0 ||
        kind === 'drop-set')
    )
      return false;
    if (
      !validValues(
        segment.values,
        String(profile.primaryMetric),
        profile.supportedMetrics as string[],
      )
    )
      return false;
  }
  return true;
}

function validExercises(value: unknown, modern: boolean) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const entryIds = new Set<string>(),
    setIds = new Set<string>();
  for (const [entryIndex, raw] of value.entries()) {
    const entry = record(raw);
    if (!entry) return false;
    const entryRequired = ['id', 'order', 'exercise', 'sets', 'createdAt'];
    if (!optionalKeys(entry, entryRequired, ['note', 'programPlan'])) return false;
    const exercise = record(entry.exercise);
    if (
      !exercise ||
      !optionalKeys(
        exercise,
        ['exerciseId', 'name', 'trackingProfile', 'trainingClassification', 'equipment'],
        modern ? ['source'] : [],
      )
    )
      return false;
    const profile = record(exercise.trackingProfile);
    if (
      !profile ||
      !exactKeys(profile, ['primaryMetric', 'supportedMetrics']) ||
      !METRICS.includes(profile.primaryMetric as never) ||
      !Array.isArray(profile.supportedMetrics) ||
      !profile.supportedMetrics.includes(profile.primaryMetric) ||
      !profile.supportedMetrics.every((metric) => METRICS.includes(metric as never))
    )
      return false;
    if (
      !nonEmpty(entry.id) ||
      entryIds.has(String(entry.id)) ||
      entry.order !== entryIndex + 1 ||
      !iso(entry.createdAt) ||
      !nonEmpty(exercise.exerciseId) ||
      !nonEmpty(exercise.name) ||
      (modern && !['system', 'athlete-custom'].includes(String(exercise.source))) ||
      !['power', 'resistance', 'mixed', 'conditioning'].includes(
        String(exercise.trainingClassification),
      ) ||
      !Array.isArray(exercise.equipment) ||
      !exercise.equipment.every((item) => typeof item === 'string')
    )
      return false;
    entryIds.add(String(entry.id));
    if (
      entry.note !== undefined &&
      (typeof entry.note !== 'string' || !entry.note.trim() || entry.note.length > 1000)
    )
      return false;
    if (entry.programPlan !== undefined) {
      const plan = record(entry.programPlan);
      if (!plan || !exactKeys(plan, ['exercisePlanId', 'plannedSource', 'plannedExerciseId']))
        return false;
    }
    if (!Array.isArray(entry.sets) || entry.sets.length === 0) return false;
    for (const [setIndex, rawSet] of entry.sets.entries()) {
      const set = record(rawSet);
      if (!set) return false;
      const required = [
        'id',
        'order',
        'status',
        'role',
        'values',
        'createdAt',
        'updatedAt',
        'completedAt',
      ];
      if (!optionalKeys(set, required, modern ? ['execution', 'programPlan'] : ['programPlan']))
        return false;
      if (
        !nonEmpty(set.id) ||
        setIds.has(String(set.id)) ||
        set.order !== setIndex + 1 ||
        set.status !== 'completed' ||
        !['working', 'warmup'].includes(String(set.role)) ||
        !iso(set.createdAt) ||
        !iso(set.updatedAt) ||
        !iso(set.completedAt) ||
        !validValues(
          set.values,
          String(profile.primaryMetric),
          profile.supportedMetrics as string[],
        )
      )
        return false;
      setIds.add(String(set.id));
      if (modern && !validExecution(set.execution, set.role, profile)) return false;
      if (set.programPlan !== undefined) {
        const plan = record(set.programPlan);
        if (!plan || !exactKeys(plan, ['setPlanId', 'prescription'])) return false;
      }
    }
  }
  return true;
}

function validGroups(value: unknown, exercises: unknown) {
  if (!Array.isArray(value) || !Array.isArray(exercises)) return false;
  const entries = new Map(exercises.map((item) => [String(record(item)?.id), record(item)]));
  const groups = new Set<string>(),
    occupied = new Set<string>();
  for (const raw of value) {
    const group = record(raw);
    if (
      !group ||
      !exactKeys(group, [
        'id',
        'type',
        'memberExerciseEntryIds',
        'startWorkingSetOrder',
        'roundCount',
      ]) ||
      !nonEmpty(group.id) ||
      groups.has(String(group.id)) ||
      !['superset', 'giant-set'].includes(String(group.type)) ||
      !Array.isArray(group.memberExerciseEntryIds)
    )
      return false;
    groups.add(String(group.id));
    const members = new Set(group.memberExerciseEntryIds.map(String));
    const sizeValid =
      group.type === 'superset' ? members.size === 2 : members.size >= 3 && members.size <= 6;
    if (
      !sizeValid ||
      members.size !== group.memberExerciseEntryIds.length ||
      !Number.isInteger(group.startWorkingSetOrder) ||
      Number(group.startWorkingSetOrder) < 1 ||
      !Number.isInteger(group.roundCount) ||
      Number(group.roundCount) < 1
    )
      return false;
    for (const member of members) {
      const entry = entries.get(member),
        sets = entry?.sets;
      if (!entry || !Array.isArray(sets)) return false;
      const working = sets.filter((item) => record(item)?.role === 'working');
      for (
        let order = Number(group.startWorkingSetOrder);
        order < Number(group.startWorkingSetOrder) + Number(group.roundCount);
        order += 1
      ) {
        if (!working[order - 1] || occupied.has(`${member}:${order}`)) return false;
        occupied.add(`${member}:${order}`);
      }
    }
  }
  return true;
}

export type ValidWorkoutSource = {
  workoutId: string;
  completedAtMs: number;
  completedAt: Timestamp;
};
export function assertChallengeWorkoutSource(
  value: unknown,
  documentId: string,
  uid: string,
  start: number,
  end: number,
): ValidWorkoutSource {
  const workout = record(value);
  const schema = workout?.schemaVersion;
  const required = [
    'schemaVersion',
    'recordOrigin',
    'sourceSessionSchemaVersion',
    'workoutId',
    'ownerUid',
    'startedAt',
    'completedAt',
    'exercises',
  ];
  const modern = schema === 2 || schema === 3;
  if (
    !workout ||
    ![1, 2, 3].includes(Number(schema)) ||
    !optionalKeys(workout, modern ? [...required, 'pausedDurationSeconds', 'groups'] : required, [
      'note',
      ...(schema === 3 ? ['programContext'] : []),
    ]) ||
    workout.sourceSessionSchemaVersion !== (schema === 1 ? 3 : schema === 2 ? 4 : 5) ||
    workout.recordOrigin !== 'athlete-client' ||
    workout.workoutId !== documentId ||
    workout.ownerUid !== uid ||
    !timestamp(workout.startedAt) ||
    !timestamp(workout.completedAt) ||
    workout.completedAt.toMillis() < workout.startedAt.toMillis() ||
    workout.completedAt.toMillis() < start ||
    workout.completedAt.toMillis() >= end ||
    (workout.note !== undefined &&
      (typeof workout.note !== 'string' || !workout.note.trim() || workout.note.length > 2000)) ||
    !validExercises(workout.exercises, modern) ||
    (modern &&
      (!Number.isInteger(workout.pausedDurationSeconds) ||
        Number(workout.pausedDurationSeconds) < 0 ||
        !validGroups(workout.groups, workout.exercises))) ||
    (schema === 3 &&
      workout.programContext !== undefined &&
      !validProgramContext(workout.programContext))
  )
    throw new Error('challenge-workout-source-invalid');
  return {
    workoutId: documentId,
    completedAtMs: workout.completedAt.toMillis(),
    completedAt: workout.completedAt,
  };
}

export type SafeParticipant = {
  participantId: string;
  status: 'active' | 'withdrawn';
  displayName: string;
  joinedAt: Timestamp;
  withdrawnAt?: Timestamp;
};
export type PrivateParticipant = SafeParticipant & { participantUid: string };
export function assertSafeParticipant(
  value: unknown,
  documentId: string,
  creatorId: string,
  challengeId: string,
): SafeParticipant {
  const item = record(value),
    withdrawn = item?.status === 'withdrawn';
  const keys = [
    'schemaVersion',
    'contractVersion',
    'creatorId',
    'challengeId',
    'participantId',
    'status',
    'displayName',
    'joinedAt',
    ...(withdrawn ? ['withdrawnAt'] : []),
  ];
  if (
    !item ||
    !exactKeys(item, keys) ||
    item.schemaVersion !== 1 ||
    item.contractVersion !== CREATOR_MEMBERSHIP_CHALLENGE_PARTICIPATION_CONTRACT ||
    item.creatorId !== creatorId ||
    item.challengeId !== challengeId ||
    item.participantId !== documentId ||
    !participantIdValid(item.participantId) ||
    !['active', 'withdrawn'].includes(String(item.status)) ||
    !timestamp(item.joinedAt) ||
    (withdrawn
      ? item.displayName !== '' || !timestamp(item.withdrawnAt)
      : (() => {
          try {
            cleanText(item.displayName, 2, 40);
            return false;
          } catch {
            return true;
          }
        })())
  )
    throw new Error('challenge-state-invalid');
  return item as unknown as SafeParticipant;
}
export function assertPrivateParticipant(
  value: unknown,
  creatorId: string,
  challengeId: string,
  uid: string,
): PrivateParticipant {
  const item = record(value),
    withdrawn = item?.status === 'withdrawn';
  const keys = [
    'schemaVersion',
    'contractVersion',
    'creatorId',
    'challengeId',
    'participantUid',
    'participantId',
    'status',
    'displayName',
    'joinedAt',
    ...(withdrawn ? ['withdrawnAt'] : []),
  ];
  if (
    !item ||
    !exactKeys(item, keys) ||
    item.schemaVersion !== 1 ||
    item.contractVersion !== CREATOR_MEMBERSHIP_CHALLENGE_PARTICIPATION_CONTRACT ||
    item.creatorId !== creatorId ||
    item.challengeId !== challengeId ||
    item.participantUid !== uid ||
    !participantIdValid(item.participantId) ||
    !['active', 'withdrawn'].includes(String(item.status)) ||
    !timestamp(item.joinedAt) ||
    (withdrawn
      ? item.displayName !== '' || !timestamp(item.withdrawnAt)
      : (() => {
          try {
            cleanText(item.displayName, 2, 40);
            return false;
          } catch {
            return true;
          }
        })())
  )
    throw new Error('challenge-state-invalid');
  return item as unknown as PrivateParticipant;
}
export function assertParticipantPair(control: PrivateParticipant, safe: SafeParticipant) {
  if (
    control.participantId !== safe.participantId ||
    control.status !== safe.status ||
    control.displayName !== safe.displayName ||
    !control.joinedAt.isEqual(safe.joinedAt) ||
    (control.withdrawnAt
      ? !safe.withdrawnAt?.isEqual(control.withdrawnAt)
      : safe.withdrawnAt !== undefined)
  )
    throw new Error('challenge-state-invalid');
}

export type SafeEvidence = {
  creatorId: string;
  challengeId: string;
  evidenceId: string;
  participantId: string;
  dayIndex: number;
  pointValue: 1;
};
export type PrivateEvidence = SafeEvidence & {
  participantUid: string;
  sourceWorkoutId: string;
  sourceCompletedAt: Timestamp;
  createdAt: Timestamp;
};
export function assertSafeEvidence(
  value: unknown,
  documentId: string,
  creatorId: string,
  challengeId: string,
): SafeEvidence {
  const item = record(value);
  if (
    !item ||
    !exactKeys(item, [
      'schemaVersion',
      'contractVersion',
      'creatorId',
      'challengeId',
      'evidenceId',
      'participantId',
      'dayIndex',
      'pointValue',
    ]) ||
    item.schemaVersion !== 1 ||
    item.contractVersion !== CREATOR_MEMBERSHIP_CHALLENGE_EVIDENCE_CONTRACT ||
    item.creatorId !== creatorId ||
    item.challengeId !== challengeId ||
    item.evidenceId !== documentId ||
    !participantIdValid(item.participantId) ||
    !Number.isInteger(item.dayIndex) ||
    Number(item.dayIndex) < 0 ||
    Number(item.dayIndex) > 6 ||
    item.pointValue !== 1 ||
    evidenceId(item.participantId, Number(item.dayIndex)) !== item.evidenceId
  )
    throw new Error('challenge-state-invalid');
  return item as unknown as SafeEvidence;
}
export function assertPrivateEvidence(
  value: unknown,
  documentId: string,
  creatorId: string,
  challengeId: string,
): PrivateEvidence {
  const item = record(value);
  if (
    !item ||
    !exactKeys(item, [
      'schemaVersion',
      'contractVersion',
      'creatorId',
      'challengeId',
      'evidenceId',
      'participantUid',
      'participantId',
      'dayIndex',
      'pointValue',
      'sourceWorkoutId',
      'sourceCompletedAt',
      'createdAt',
    ]) ||
    item.schemaVersion !== 1 ||
    item.contractVersion !== CREATOR_MEMBERSHIP_CHALLENGE_EVIDENCE_CONTRACT ||
    item.creatorId !== creatorId ||
    item.challengeId !== challengeId ||
    item.evidenceId !== documentId ||
    !participantIdValid(item.participantId) ||
    !nonEmpty(item.participantUid) ||
    !Number.isInteger(item.dayIndex) ||
    Number(item.dayIndex) < 0 ||
    Number(item.dayIndex) > 6 ||
    item.pointValue !== 1 ||
    !nonEmpty(item.sourceWorkoutId) ||
    !timestamp(item.sourceCompletedAt) ||
    !timestamp(item.createdAt) ||
    evidenceId(item.participantId, Number(item.dayIndex)) !== item.evidenceId
  )
    throw new Error('challenge-state-invalid');
  return item as unknown as PrivateEvidence;
}
