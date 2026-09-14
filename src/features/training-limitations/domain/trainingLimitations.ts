import { movementPatterns, type MovementPattern } from '../../exercises/domain/taxonomies';
import type { Exercise } from '../../exercises/domain/types';

export const ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION = 'athlete-limitation-profile-v1' as const;
export const ATHLETE_LIMITATION_PROFILE_SCHEMA_VERSION = 1 as const;
export const MAX_EXCLUDED_SYSTEM_EXERCISES = 40;

export type TrainingLimitationSelections = {
  excludedMovementPatterns: MovementPattern[];
  excludedSystemExerciseIds: string[];
};

export type AthleteLimitationProfileV1 = TrainingLimitationSelections & {
  schemaVersion: typeof ATHLETE_LIMITATION_PROFILE_SCHEMA_VERSION;
  contractVersion: typeof ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION;
  ownerUid: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export const EMPTY_TRAINING_LIMITATIONS: TrainingLimitationSelections = {
  excludedMovementPatterns: [],
  excludedSystemExerciseIds: [],
};

const MOVEMENT_PATTERN_IDS = new Set<MovementPattern>(movementPatterns.map(({ value }) => value));
const EXERCISE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseAthleteLimitationProfile(
  value: unknown,
  expectedUid: string,
): AthleteLimitationProfileV1 {
  if (!value || typeof value !== 'object') throw new Error('Training limitations are invalid.');
  const profile = value as Record<string, unknown>;
  const expectedKeys = [
    'schemaVersion',
    'contractVersion',
    'ownerUid',
    'excludedMovementPatterns',
    'excludedSystemExerciseIds',
    'createdAt',
    'updatedAt',
  ];
  if (
    Object.keys(profile).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in profile)) ||
    profile.schemaVersion !== ATHLETE_LIMITATION_PROFILE_SCHEMA_VERSION ||
    profile.contractVersion !== ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION ||
    profile.ownerUid !== expectedUid ||
    !isTimestampLike(profile.createdAt) ||
    !isTimestampLike(profile.updatedAt)
  )
    throw new Error('Training limitations identity is invalid.');

  const selections = parseSelections(profile);
  return {
    schemaVersion: ATHLETE_LIMITATION_PROFILE_SCHEMA_VERSION,
    contractVersion: ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION,
    ownerUid: expectedUid,
    ...selections,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function parseTrainingLimitationSelections(value: unknown): TrainingLimitationSelections {
  if (!value || typeof value !== 'object') throw new Error('Training limitations are invalid.');
  return parseSelections(value as Record<string, unknown>);
}

export function validateTrainingLimitationSelections(
  value: TrainingLimitationSelections,
  catalogue: readonly Exercise[],
): TrainingLimitationSelections {
  const parsed = parseTrainingLimitationSelections(value);
  const publishedSystemIds = new Set(
    catalogue
      .filter(({ source, status }) => source === 'system' && status === 'published')
      .map(({ id }) => id),
  );
  if (parsed.excludedSystemExerciseIds.some((id) => !publishedSystemIds.has(id)))
    throw new Error('Choose only current published system exercises.');
  return parsed;
}

export function sanitizeTrainingLimitationProfile(
  profile: AthleteLimitationProfileV1 | TrainingLimitationSelections | null,
  catalogue: readonly Exercise[],
): TrainingLimitationSelections | null {
  if (!profile) return null;
  const publishedSystemIds = new Set(
    catalogue
      .filter(({ source, status }) => source === 'system' && status === 'published')
      .map(({ id }) => id),
  );
  return {
    excludedMovementPatterns: [...profile.excludedMovementPatterns],
    excludedSystemExerciseIds: profile.excludedSystemExerciseIds.filter((id) =>
      publishedSystemIds.has(id),
    ),
  };
}

export function isTrainingLimitationProfileEmpty(profile: TrainingLimitationSelections | null) {
  return (
    !profile ||
    (profile.excludedMovementPatterns.length === 0 &&
      profile.excludedSystemExerciseIds.length === 0)
  );
}

export function isExerciseExcludedFromSuggestions(
  profile: TrainingLimitationSelections | null,
  exercise: Exercise,
) {
  if (!profile || exercise.source !== 'system' || exercise.status !== 'published') return false;
  return (
    profile.excludedSystemExerciseIds.includes(exercise.id) ||
    profile.excludedMovementPatterns.includes(exercise.movementPattern)
  );
}

export function trainingLimitationFingerprint(profile: TrainingLimitationSelections | null) {
  if (!profile) return 'training-limitations:none';
  const movements = [...profile.excludedMovementPatterns].sort();
  const exercises = [...profile.excludedSystemExerciseIds].sort();
  return `training-limitations:${movements.join('|')}:${exercises.join('|')}`;
}

function parseSelections(value: Record<string, unknown>): TrainingLimitationSelections {
  if (
    !Array.isArray(value.excludedMovementPatterns) ||
    !Array.isArray(value.excludedSystemExerciseIds)
  )
    throw new Error('Training limitation selections are invalid.');
  const excludedMovementPatterns = value.excludedMovementPatterns;
  const excludedSystemExerciseIds = value.excludedSystemExerciseIds;
  if (
    excludedMovementPatterns.length > movementPatterns.length ||
    new Set(excludedMovementPatterns).size !== excludedMovementPatterns.length ||
    excludedMovementPatterns.some(
      (item) => typeof item !== 'string' || !MOVEMENT_PATTERN_IDS.has(item as MovementPattern),
    )
  )
    throw new Error('Movement exclusions are invalid.');
  if (
    excludedSystemExerciseIds.length > MAX_EXCLUDED_SYSTEM_EXERCISES ||
    new Set(excludedSystemExerciseIds).size !== excludedSystemExerciseIds.length ||
    excludedSystemExerciseIds.some(
      (item) => typeof item !== 'string' || !EXERCISE_ID.test(item) || item.length > 160,
    )
  )
    throw new Error('Exercise exclusions are invalid.');
  return {
    excludedMovementPatterns: [...excludedMovementPatterns] as MovementPattern[],
    excludedSystemExerciseIds: [...excludedSystemExerciseIds] as string[],
  };
}

function isTimestampLike(value: unknown) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ('seconds' in value || 'toMillis' in value || 'toDate' in value),
  );
}
