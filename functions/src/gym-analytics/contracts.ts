import { createHash } from 'node:crypto';

export const GYM_PARTICIPATION_ANALYTICS_CONTRACT = 'gym-participation-analytics-v1' as const;
export const GYM_WORKOUT_ANALYTICS_EVENT_CONTRACT = 'gym-workout-analytics-event-v1' as const;
export const GYM_ANALYTICS_PRIVACY_CONTRACT = 'gym-analytics-privacy-v1' as const;
export const GYM_ANALYTICS_WINDOW_DAYS = 28;
export const GYM_ANALYTICS_MINIMUM_COHORT = 5;
export const GYM_ANALYTICS_EVENT_LIMIT = 5_000;
const V3_CONTEXT_KEYS = [
  'contractVersion',
  'programSource',
  'enrollmentId',
  'gymId',
  'gymProgramId',
  'publicationVersionId',
  'deliveryDayId',
  'programName',
  'sessionLabel',
  'weekNumber',
  'dayOfWeek',
  'sessionKey',
  'scheduledDateLocal',
] as const;
const ANALYTICS_EVENT_KEYS = [
  'schemaVersion',
  'contractVersion',
  'gymId',
  'eventId',
  'participantKey',
  'sessionCompletionKey',
  'gymProgramId',
  'publicationVersionId',
  'recordedAt',
  'recordedDateUtc',
] as const;

export function assertGymAnalyticsCapacity(eventCount: number, membershipCount: number) {
  if (eventCount > GYM_ANALYTICS_EVENT_LIMIT || membershipCount > 1_000)
    throw new Error('analytics-capacity-review');
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const gymAnalyticsEventId = (uid: string, workoutId: string) =>
  digest(`${GYM_WORKOUT_ANALYTICS_EVENT_CONTRACT}:${uid}:${workoutId}`);
export const gymAnalyticsParticipantKey = (gymId: string, uid: string) =>
  digest(`gym-analytics-participant-v1:${gymId}:${uid}`);
export const gymAnalyticsSessionCompletionKey = (
  gymId: string,
  uid: string,
  enrollmentId: string,
  sessionKey: string,
) => digest(`gym-analytics-session-v1:${gymId}:${uid}:${enrollmentId}:${sessionKey}`);

export type AnalyticsEvent = {
  schemaVersion: 1;
  contractVersion: typeof GYM_WORKOUT_ANALYTICS_EVENT_CONTRACT;
  gymId: string;
  eventId: string;
  participantKey: string;
  sessionCompletionKey: string;
  gymProgramId: string;
  publicationVersionId: string;
  recordedAt: unknown;
  recordedDateUtc: string;
};

export function projectGymWorkoutAnalyticsEvent(input: {
  uid: string;
  workoutId: string;
  workout: unknown;
  recordedAt: Date;
}): AnalyticsEvent | null {
  const workout = record(input.workout);
  const context = record(workout.programContext);
  if (
    workout.schemaVersion !== 3 ||
    workout.recordOrigin !== 'athlete-client' ||
    workout.sourceSessionSchemaVersion !== 5 ||
    workout.ownerUid !== input.uid ||
    workout.workoutId !== input.workoutId ||
    !validateGymProgramV3Context(context) ||
    Number.isNaN(input.recordedAt.getTime())
  )
    return null;
  const gymId = String(context.gymId);
  return {
    schemaVersion: 1,
    contractVersion: GYM_WORKOUT_ANALYTICS_EVENT_CONTRACT,
    gymId,
    eventId: gymAnalyticsEventId(input.uid, input.workoutId),
    participantKey: gymAnalyticsParticipantKey(gymId, input.uid),
    sessionCompletionKey: gymAnalyticsSessionCompletionKey(
      gymId,
      input.uid,
      String(context.enrollmentId),
      String(context.sessionKey),
    ),
    gymProgramId: String(context.gymProgramId),
    publicationVersionId: String(context.publicationVersionId),
    recordedAt: input.recordedAt,
    recordedDateUtc: input.recordedAt.toISOString().slice(0, 10),
  };
}

export function validateGymProgramV3Context(input: unknown): input is Value {
  const context = record(input);
  return (
    exactKeys(context, V3_CONTEXT_KEYS) &&
    context.contractVersion === 'workout-program-provenance-v3' &&
    context.programSource === 'gym-program' &&
    typeof context.enrollmentId === 'string' &&
    /^gym-program-enrollment-[A-Za-z0-9-]+$/.test(context.enrollmentId) &&
    identifier(context.gymId) &&
    identifier(context.gymProgramId) &&
    identifier(context.publicationVersionId) &&
    identifier(context.deliveryDayId) &&
    boundedLabel(context.programName) &&
    boundedLabel(context.sessionLabel) &&
    Number.isInteger(context.weekNumber) &&
    Number(context.weekNumber) >= 1 &&
    Number(context.weekNumber) <= 52 &&
    Number.isInteger(context.dayOfWeek) &&
    Number(context.dayOfWeek) >= 1 &&
    Number(context.dayOfWeek) <= 7 &&
    context.sessionKey === `w${context.weekNumber}-d${context.dayOfWeek}` &&
    localDate(context.scheduledDateLocal)
  );
}

export function validateGymAnalyticsEvent(
  input: unknown,
  documentId: string,
  collectionGymId: string,
): AnalyticsEvent | null {
  const event = record(input);
  const recordedAt = firestoreDate(event.recordedAt);
  if (
    !exactKeys(event, ANALYTICS_EVENT_KEYS) ||
    event.schemaVersion !== 1 ||
    event.contractVersion !== GYM_WORKOUT_ANALYTICS_EVENT_CONTRACT ||
    !sha256(event.eventId) ||
    event.eventId !== documentId ||
    !sha256(event.participantKey) ||
    !sha256(event.sessionCompletionKey) ||
    !identifier(event.gymId) ||
    event.gymId !== collectionGymId ||
    !identifier(event.gymProgramId) ||
    !identifier(event.publicationVersionId) ||
    !recordedAt ||
    !localDate(event.recordedDateUtc) ||
    event.recordedDateUtc !== recordedAt.toISOString().slice(0, 10)
  )
    return null;
  return event as AnalyticsEvent;
}

type Value = Record<string, unknown>;
const record = (value: unknown): Value =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Value) : {};
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const boundedLabel = (value: unknown) =>
  typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= 80;
const sha256 = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exactKeys = (value: Value, keys: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const localDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
};
const firestoreDate = (value: unknown) => {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return null;
  const date = toDate.call(value) as unknown;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

export function aggregateGymParticipation(
  events: Array<Pick<AnalyticsEvent, 'participantKey' | 'sessionCompletionKey' | 'gymProgramId'>>,
  titles: ReadonlyMap<string, string>,
) {
  const aggregate = (items: typeof events) => {
    const participants = new Set(items.map((item) => item.participantKey));
    const sessions = new Set(items.map((item) => item.sessionCompletionKey));
    return participants.size < GYM_ANALYTICS_MINIMUM_COHORT
      ? { status: 'suppressed' as const, minimumCohort: GYM_ANALYTICS_MINIMUM_COHORT }
      : {
          status: 'available' as const,
          distinctParticipants: participants.size,
          sessionsRecorded: sessions.size,
        };
  };
  const ids = [...new Set(events.map((event) => event.gymProgramId))];
  const programActivity = ids.map((gymProgramId) => ({
    gymProgramId,
    title: titles.get(gymProgramId) ?? 'Gym programme',
    ...aggregate(events.filter((event) => event.gymProgramId === gymProgramId)),
  }));
  programActivity.sort((a, b) => {
    const status = Number(a.status === 'suppressed') - Number(b.status === 'suppressed');
    return status || a.title.localeCompare(b.title) || a.gymProgramId.localeCompare(b.gymProgramId);
  });
  return { trainingActivity: aggregate(events), programActivity };
}
