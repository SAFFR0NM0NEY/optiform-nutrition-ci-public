import { describe, expect, it } from 'vitest';
import {
  ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION,
  isExerciseExcludedFromSuggestions,
  parseAthleteLimitationProfile,
  parseTrainingLimitationSelections,
  trainingLimitationFingerprint,
} from './trainingLimitations';
const exercise = {
  id: 'synthetic-squat',
  source: 'system' as const,
  status: 'published' as const,
  movementPattern: 'squat' as const,
};
const timestamp = { seconds: 1 };
describe('public-safe P65 training limitation policy', () => {
  it('keeps the frozen contract and rejects free text or unknown movement vocabulary', () => {
    expect(ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION).toBe('athlete-limitation-profile-v1');
    expect(() =>
      parseAthleteLimitationProfile(
        {
          schemaVersion: 1,
          contractVersion: ATHLETE_LIMITATION_PROFILE_CONTRACT_VERSION,
          ownerUid: 'athlete-a',
          excludedMovementPatterns: ['squat'],
          excludedSystemExerciseIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
          note: 'not part of the persisted contract',
        },
        'athlete-a',
      ),
    ).toThrow();
    expect(() =>
      parseTrainingLimitationSelections({
        excludedMovementPatterns: ['medical-condition'],
        excludedSystemExerciseIds: [],
      }),
    ).toThrow();
  });
  it('matches exact system exercise IDs or exact movement patterns only', () => {
    expect(
      isExerciseExcludedFromSuggestions(
        { excludedMovementPatterns: ['squat'], excludedSystemExerciseIds: [] },
        exercise,
      ),
    ).toBe(true);
    expect(
      isExerciseExcludedFromSuggestions(
        { excludedMovementPatterns: [], excludedSystemExerciseIds: ['synthetic-squat'] },
        exercise,
      ),
    ).toBe(true);
    expect(
      isExerciseExcludedFromSuggestions(
        { excludedMovementPatterns: ['squat'], excludedSystemExerciseIds: [] },
        { ...exercise, source: 'user' },
      ),
    ).toBe(false);
  });
  it('caps exercise selections and fingerprints equivalent selections deterministically', () => {
    expect(() =>
      parseTrainingLimitationSelections({
        excludedMovementPatterns: [],
        excludedSystemExerciseIds: Array.from({ length: 41 }, (_, index) => `synthetic-${index}`),
      }),
    ).toThrow();
    expect(
      trainingLimitationFingerprint({
        excludedMovementPatterns: ['squat', 'hinge'],
        excludedSystemExerciseIds: ['b', 'a'],
      }),
    ).toBe(
      trainingLimitationFingerprint({
        excludedMovementPatterns: ['hinge', 'squat'],
        excludedSystemExerciseIds: ['a', 'b'],
      }),
    );
  });
});
