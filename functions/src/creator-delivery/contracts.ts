import { createHash } from 'node:crypto';
import { validateCreatorDeliverySource } from './p28Validation.js';

export const CREATOR_PROGRAM_DELIVERY_CONTRACT = 'creator-program-delivery-v1' as const;
export const CREATOR_PROGRAM_ACCESS_BINDING_CONTRACT = 'creator-program-access-binding-v1' as const;
export const CREATOR_PROGRAM_LIBRARY_CONTRACT = 'creator-program-library-v1' as const;

export type CanonicalExercise = {
  id: string;
  name: string;
  source: string;
  status: string;
  trackingProfile: unknown;
  trainingClassification: unknown;
  equipment: unknown;
};
type SourceBundle = {
  index: Record<string, unknown>;
  version: Record<string, unknown>;
  days: Array<Record<string, unknown>>;
};

export type DeliveryDay = {
  schemaVersion: 1;
  contractVersion: typeof CREATOR_PROGRAM_DELIVERY_CONTRACT;
  publicationVersionId: string;
  listingId: string;
  dayId: string;
  weekNumber: number;
  dayOfWeek: number;
  weekKind: string;
  label: string;
  exercises: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
};

export type DeliveryProjection = {
  metadata: {
    schemaVersion: 1;
    contractVersion: typeof CREATOR_PROGRAM_DELIVERY_CONTRACT;
    publicationVersionId: string;
    listingId: string;
    creatorId: string;
    versionNumber: number;
    title: string;
    description: string;
    durationWeeks: number;
    dayCount: number;
    contentHash: string;
    status: 'sealed';
  };
  days: DeliveryDay[];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const pick = (value: unknown, keys: string[]) => {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((key) => [key, clone(source[key])]),
  );
};
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

export const creatorDeliveryHash = (value: unknown) =>
  createHash('sha256').update(stable(value)).digest('hex');

export function creatorDeliveryHashInput(
  metadata: Pick<
    DeliveryProjection['metadata'],
    | 'publicationVersionId'
    | 'listingId'
    | 'creatorId'
    | 'versionNumber'
    | 'title'
    | 'description'
    | 'durationWeeks'
  >,
  days: DeliveryDay[],
) {
  return { ...metadata, days };
}

export function projectCreatorDelivery(input: {
  publicationVersionId: string;
  listingId: string;
  creatorId: string;
  versionNumber: number;
  ownerUid: string;
  sourceProgramId: string;
  sourceVersionId: string;
  preview: { title: string; description: string; durationWeeks: number };
  bundle: SourceBundle;
  canonical: ReadonlyMap<string, CanonicalExercise>;
}): DeliveryProjection {
  validateCreatorDeliverySource(
    input.bundle,
    input.ownerUid,
    input.sourceProgramId,
    input.sourceVersionId,
    input.canonical,
  );
  if (input.bundle.days.length > 364) throw new Error('delivery-day-bound-exceeded');
  if (
    !Number.isInteger(input.preview.durationWeeks) ||
    input.preview.durationWeeks < 1 ||
    input.preview.durationWeeks > 52 ||
    input.bundle.days.length > input.preview.durationWeeks * 7
  )
    throw new Error('source-structure-invalid');
  const sortedDays = [...input.bundle.days].sort(
    (a, b) =>
      Number(a.weekNumber) - Number(b.weekNumber) || Number(a.dayOfWeek) - Number(b.dayOfWeek),
  );
  const days = sortedDays.map((day, dayIndex): DeliveryDay => {
    const sourceExercises = Array.isArray(day.exercises) ? day.exercises : [];
    if (
      !Number.isInteger(Number(day.weekNumber)) ||
      Number(day.weekNumber) < 1 ||
      Number(day.weekNumber) > input.preview.durationWeeks ||
      !Number.isInteger(Number(day.dayOfWeek)) ||
      Number(day.dayOfWeek) < 1 ||
      Number(day.dayOfWeek) > 7 ||
      sourceExercises.length > 20
    )
      throw new Error('source-structure-invalid');
    const exerciseIds = new Map<string, string>();
    const exercises = sourceExercises.map((raw, exerciseIndex) => {
      const exercise = raw as Record<string, unknown>;
      const snapshot = exercise.exercise as Record<string, unknown>;
      if (snapshot?.source !== 'system') throw new Error('custom-exercise-denied');
      const canonical = input.canonical.get(String(snapshot.exerciseId));
      if (!canonical || canonical.source !== 'system' || canonical.status !== 'published')
        throw new Error('canonical-exercise-unavailable');
      const deliveryExerciseId = `exercise-${exerciseIndex + 1}`;
      exerciseIds.set(String(exercise.exercisePlanId), deliveryExerciseId);
      const sourceSets = Array.isArray(exercise.setPlans) ? exercise.setPlans : [];
      if (Number(exercise.order) !== exerciseIndex + 1 || sourceSets.length > 20)
        throw new Error('source-structure-invalid');
      const setPlans = sourceSets.map((rawSet, setIndex) => {
        const set = rawSet as Record<string, unknown>;
        if (Number(set.order) !== setIndex + 1) throw new Error('source-structure-invalid');
        const deliverySetId = `set-${setIndex + 1}`;
        return {
          deliverySetId,
          order: Number(set.order),
          role: String(set.role),
          executionPlan: pick(set.executionPlan, ['kind', 'tempo', 'additionalSegmentCount']),
          prescription: pick(set.prescription, [
            'metrics',
            'effort',
            'assistanceKg',
            'segmentTargets',
          ]),
        };
      });
      return {
        deliveryExerciseId,
        order: Number(exercise.order),
        exercise: {
          source: 'system',
          exerciseId: canonical.id,
          name: canonical.name,
          trackingProfile: clone(canonical.trackingProfile),
          trainingClassification: canonical.trainingClassification,
          equipment: clone(canonical.equipment),
        },
        setPlans,
        progression: pick(exercise.progression, [
          'kind',
          'repRange',
          'loadIncrementKg',
          'startingLoadKg',
        ]),
      };
    });
    const groups = (Array.isArray(day.groups) ? day.groups : []).map((raw, groupIndex) => {
      const group = raw as Record<string, unknown>;
      if (!Array.isArray(group.memberExercisePlanIds)) throw new Error('source-structure-invalid');
      const members = group.memberExercisePlanIds.map((id) => exerciseIds.get(String(id)));
      if (members.some((id) => !id)) throw new Error('invalid-group-member');
      return {
        deliveryGroupId: `group-${groupIndex + 1}`,
        type: String(group.type),
        memberDeliveryExerciseIds: members,
        startWorkingSetOrder: Number(group.startWorkingSetOrder),
        roundCount: Number(group.roundCount),
      };
    });
    return {
      schemaVersion: 1,
      contractVersion: CREATOR_PROGRAM_DELIVERY_CONTRACT,
      publicationVersionId: input.publicationVersionId,
      listingId: input.listingId,
      dayId: `day-${dayIndex + 1}`,
      weekNumber: Number(day.weekNumber),
      dayOfWeek: Number(day.dayOfWeek),
      weekKind: String(day.weekKind),
      label: String(day.label),
      exercises,
      groups,
    };
  });
  if (new Set(days.map((day) => `${day.weekNumber}:${day.dayOfWeek}`)).size !== days.length)
    throw new Error('source-structure-invalid');
  const content = creatorDeliveryHashInput(
    {
      publicationVersionId: input.publicationVersionId,
      listingId: input.listingId,
      creatorId: input.creatorId,
      versionNumber: input.versionNumber,
      title: input.preview.title,
      description: input.preview.description,
      durationWeeks: input.preview.durationWeeks,
    },
    days,
  );
  return {
    metadata: {
      schemaVersion: 1,
      contractVersion: CREATOR_PROGRAM_DELIVERY_CONTRACT,
      publicationVersionId: input.publicationVersionId,
      listingId: input.listingId,
      creatorId: input.creatorId,
      versionNumber: input.versionNumber,
      title: input.preview.title,
      description: input.preview.description,
      durationWeeks: input.preview.durationWeeks,
      dayCount: days.length,
      contentHash: creatorDeliveryHash(content),
      status: 'sealed',
    },
    days,
  };
}

export function exactPayload(payload: unknown, keys: string[]) {
  return (
    !!payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.keys(payload).sort().join('|') === [...keys].sort().join('|')
  );
}
