import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_DAY_MS,
  calculateChallengeResult,
  calculateChallengeScore,
  chooseDaySources,
  createPendingChallenge,
  getChallengeDayIndex,
  getChallengePhase,
  makeChallengeEntryId,
  type ChallengeDayEvidenceV1,
} from './friendChallenges';

const start = '2026-01-01T10:00:00.000Z';
const evidence = (uid: string, dayIndex: number): ChallengeDayEvidenceV1 => ({
  schemaVersion: 1,
  contractVersion: 'friend-challenges-v1',
  challengeId: 'challenge1',
  participantUid: uid,
  dayIndex,
  pointValue: 1,
  sourceKind: 'completed-workout',
  sourceWorkoutId: `workout${dayIndex}`,
  sourceCompletedAt: new Date(Date.parse(start) + dayIndex * CHALLENGE_DAY_MS).toISOString(),
  createdAt: start,
});

describe('friend-challenges-v1 domain', () => {
  it('creates a deterministic bounded pending invite', () => {
    const item = createPendingChallenge({
      challengeId: 'challenge1',
      creatorUid: 'uidB',
      inviteeUid: 'uidA',
      creatorDisplayName: 'B',
      inviteeDisplayName: 'A',
      type: 'training-days',
      createdAt: start,
    });
    expect(item.participantUids).toEqual(['uidA', 'uidB']);
    expect(Date.parse(item.inviteExpiresAt) - Date.parse(start)).toBe(72 * 60 * 60 * 1000);
    expect(item).not.toHaveProperty('startsAt');
  });

  it('requires a canonical muscle only for muscle challenges', () => {
    expect(() =>
      createPendingChallenge({
        challengeId: 'x',
        creatorUid: 'a',
        inviteeUid: 'b',
        creatorDisplayName: 'A',
        inviteeDisplayName: 'B',
        type: 'muscle-training-days',
        createdAt: start,
      }),
    ).toThrow();
    expect(
      createPendingChallenge({
        challengeId: 'x',
        creatorUid: 'a',
        inviteeUid: 'b',
        creatorDisplayName: 'A',
        inviteeDisplayName: 'B',
        type: 'muscle-training-days',
        targetMuscleId: 'biceps-brachii',
        createdAt: start,
      }).targetMuscleId,
    ).toBe('biceps-brachii');
  });

  it('uses exact rolling 24-hour buckets', () => {
    expect(getChallengeDayIndex(start, start)).toBe(0);
    expect(
      getChallengeDayIndex(start, new Date(Date.parse(start) + CHALLENGE_DAY_MS).toISOString()),
    ).toBe(1);
    expect(
      getChallengeDayIndex(start, new Date(Date.parse(start) + 7 * CHALLENGE_DAY_MS).toISOString()),
    ).toBeNull();
  });

  it.each([
    [0, 0],
    [1, 1],
    [4, 4],
    [5, 4],
    [7, 4],
  ])('caps %i days at %i', (days, score) => {
    expect(
      calculateChallengeScore(
        Array.from({ length: days }, (_, index) => evidence('uidA', index)),
        'uidA',
      ).score,
    ).toBe(score);
  });

  it('deduplicates a day and never uses a secondary tie break', () => {
    expect(calculateChallengeScore([evidence('uidA', 0), evidence('uidA', 0)], 'uidA')).toEqual({
      score: 1,
      creditedDayIndexes: [0],
    });
    expect(calculateChallengeResult(4, 2)).toBe('creator-win');
    expect(calculateChallengeResult(2, 4)).toBe('invitee-win');
    expect(calculateChallengeResult(3, 3)).toBe('tie');
    expect(calculateChallengeResult(4, 4)).toBe('tie');
  });

  it('chooses the earliest source, then workout ID, per day', () => {
    const sources = [
      { workoutId: 'z', completedAt: new Date(Date.parse(start) + 2000).toISOString() },
      { workoutId: 'a', completedAt: new Date(Date.parse(start) + 1000).toISOString() },
      { workoutId: 'b', completedAt: new Date(Date.parse(start) + CHALLENGE_DAY_MS).toISOString() },
    ];
    expect(
      chooseDaySources(
        {
          startsAt: start,
          endsAt: new Date(Date.parse(start) + 7 * CHALLENGE_DAY_MS).toISOString(),
        },
        sources,
      ).map(({ source }) => source.workoutId),
    ).toEqual(['a', 'b']);
  });

  it('derives active, settling, ready and expired phases', () => {
    const pending = createPendingChallenge({
      challengeId: 'x',
      creatorUid: 'a',
      inviteeUid: 'b',
      creatorDisplayName: 'A',
      inviteeDisplayName: 'B',
      type: 'training-days',
      createdAt: start,
    });
    expect(getChallengePhase(pending, new Date(Date.parse(start) + 73 * 60 * 60 * 1000))).toBe(
      'expired',
    );
    const active = {
      ...pending,
      status: 'active' as const,
      acceptedAt: start,
      startsAt: start,
      endsAt: new Date(Date.parse(start) + 7 * CHALLENGE_DAY_MS).toISOString(),
      finalizeAfter: new Date(Date.parse(start) + 9 * CHALLENGE_DAY_MS).toISOString(),
    };
    expect(getChallengePhase(active, new Date(Date.parse(start) + CHALLENGE_DAY_MS))).toBe(
      'active',
    );
    expect(getChallengePhase(active, new Date(Date.parse(start) + 8 * CHALLENGE_DAY_MS))).toBe(
      'settling',
    );
    expect(getChallengePhase(active, new Date(Date.parse(start) + 9 * CHALLENGE_DAY_MS))).toBe(
      'ready-to-finalize',
    );
    expect(makeChallengeEntryId('uidA', 6)).toBe('uidA_6');
  });
});
