import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_DURATION_MS,
  CHALLENGE_SYNC_GRACE_MS,
  buildGymChallengeLeaderboard,
  chooseGymChallengeDaySources,
  createGymChallenge,
  createGymChallengeId,
  createGymChallengeParticipantId,
  getChallengeDayIndex,
  getGymChallengePhase,
  makeGymChallengeEvidenceId,
  type GymChallengeEvidenceV1,
  type GymChallengeParticipantV1,
} from './gymChallenges';

const now = new Date('2026-09-05T10:00:00.000Z');
const challenge = createGymChallenge(
  {
    gymId: '1111111111111111',
    title: 'September consistency',
    description: 'Train on four days.',
    startsAt: '2026-09-06T10:00:00.000Z',
  },
  now,
  '2222222222222222',
);
const participant = (id: string, displayName: string): GymChallengeParticipantV1 => ({
  schemaVersion: 1,
  contractVersion: 'gym-challenge-participation-v1',
  challengeId: challenge.challengeId,
  gymId: challenge.gymId,
  participantId: id,
  displayName,
  joinedAt: now.toISOString(),
});
const point = (id: string, dayIndex: number): GymChallengeEvidenceV1 => ({
  schemaVersion: 1,
  contractVersion: 'gym-challenge-evidence-v1',
  challengeId: challenge.challengeId,
  gymId: challenge.gymId,
  participantId: id,
  evidenceId: `${id}_${dayIndex}`,
  dayIndex,
  pointValue: 1,
});

describe('P38B gym challenge domain', () => {
  it('uses secure opaque challenge and participant identities', () => {
    expect(createGymChallengeId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(createGymChallengeParticipantId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
  });
  it('freezes seven-day timing and the 48-hour sync grace', () => {
    expect(Date.parse(challenge.endsAt) - Date.parse(challenge.startsAt)).toBe(
      CHALLENGE_DURATION_MS,
    );
    expect(Date.parse(challenge.finalizeAfter) - Date.parse(challenge.endsAt)).toBe(
      CHALLENGE_SYNC_GRACE_MS,
    );
  });
  it('derives registration, active, settling and complete phases', () => {
    expect(getGymChallengePhase(challenge, now)).toBe('registration');
    expect(getGymChallengePhase(challenge, new Date(challenge.startsAt))).toBe('active');
    expect(getGymChallengePhase(challenge, new Date(challenge.endsAt))).toBe('settling');
    expect(getGymChallengePhase(challenge, new Date(challenge.finalizeAfter))).toBe('complete');
  });
  it('reuses P14 elapsed 24-hour day buckets', () => {
    expect(getChallengeDayIndex(challenge.startsAt, challenge.startsAt)).toBe(0);
    expect(
      getChallengeDayIndex(
        challenge.startsAt,
        new Date(Date.parse(challenge.endsAt) - 1).toISOString(),
      ),
    ).toBe(6);
    expect(getChallengeDayIndex(challenge.startsAt, challenge.endsAt)).toBeNull();
  });
  it('uses deterministic evidence IDs', () => {
    expect(makeGymChallengeEvidenceId('3333333333333333', 6)).toBe('3333333333333333_6');
  });
  it('caps unique credited days at four and assigns sporting ties', () => {
    const ids = ['3333333333333333', '4444444444444444', '5555555555555555', '6666666666666666'];
    const evidence = [
      ...[0, 1, 2, 3, 4, 5, 6].map((day) => point(ids[0], day)),
      ...[0, 1, 2, 3].map((day) => point(ids[1], day)),
      point(ids[1], 3),
      ...[0, 1, 2].map((day) => point(ids[2], day)),
    ];
    const rows = buildGymChallengeLeaderboard(
      [
        participant(ids[0], 'zoe'),
        participant(ids[1], 'Alex'),
        participant(ids[2], 'Bea'),
        participant(ids[3], 'Cal'),
      ],
      evidence,
    );
    expect(rows.map(({ score, rank }) => ({ score, rank }))).toEqual([
      { score: 4, rank: 1 },
      { score: 4, rank: 1 },
      { score: 3, rank: 3 },
      { score: 0, rank: 4 },
    ]);
    expect(rows.slice(0, 2).map((row) => row.displayName)).toEqual(['Alex', 'zoe']);
  });
  it('selects the earliest workout per day with stable ID tie-breaking', () => {
    const starts = Date.parse(challenge.startsAt);
    const selected = chooseGymChallengeDaySources(challenge, [
      { workoutId: 'z', completedAt: new Date(starts + 1000).toISOString() },
      { workoutId: 'b', completedAt: new Date(starts + 500).toISOString() },
      { workoutId: 'a', completedAt: new Date(starts + 500).toISOString() },
    ]);
    expect(selected).toEqual([
      { dayIndex: 0, source: expect.objectContaining({ workoutId: 'a' }) },
    ]);
  });
});
