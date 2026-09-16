import { createHash } from 'node:crypto';

export const CREATOR_MEMBERSHIP_CHALLENGE_CONTRACT = 'creator-membership-challenge-v1';
export const CREATOR_MEMBERSHIP_CHALLENGE_PARTICIPATION_CONTRACT =
  'creator-membership-challenge-participation-v1';
export const CREATOR_MEMBERSHIP_CHALLENGE_EVIDENCE_CONTRACT =
  'creator-membership-challenge-evidence-v1';
export const CREATOR_MEMBERSHIP_CHALLENGE_LEADERBOARD_CONTRACT =
  'creator-membership-challenge-leaderboard-v1';
export const CHALLENGE_WINDOW_MS = 168 * 60 * 60 * 1000;
export const CHALLENGE_GRACE_MS = 48 * 60 * 60 * 1000;
export const CHALLENGE_DAY_MS = 24 * 60 * 60 * 1000;

export const participantLookupId = (challengeId: string, uid: string) =>
  createHash('sha256')
    .update(`creator-membership-challenge-participant\0${challengeId}\0${uid}`)
    .digest('hex');
export const evidenceId = (participantId: string, dayIndex: number) => {
  if (
    !/^creator-challenge-participant-[0-9a-f-]{36}$/i.test(participantId) ||
    !Number.isInteger(dayIndex) ||
    dayIndex < 0 ||
    dayIndex > 6
  )
    throw new Error('invalid-request');
  return `${participantId}_${dayIndex}`;
};
export const dayIndexFor = (startsAtMs: number, completedAtMs: number) => {
  const index = Math.floor((completedAtMs - startsAtMs) / CHALLENGE_DAY_MS);
  return index >= 0 && index <= 6 ? index : null;
};
export type Source = { workoutId: string; completedAtMs: number };
export const chooseDaySources = (startsAtMs: number, sources: Source[]) => {
  const selected = new Map<number, Source>();
  for (const source of [...sources].sort(
    (a, b) => a.completedAtMs - b.completedAtMs || a.workoutId.localeCompare(b.workoutId),
  )) {
    const dayIndex = dayIndexFor(startsAtMs, source.completedAtMs);
    if (dayIndex !== null && !selected.has(dayIndex)) selected.set(dayIndex, source);
  }
  return [...selected].map(([dayIndex, source]) => ({ dayIndex, source }));
};
export type LeaderboardInput = {
  participantId: string;
  displayName: string;
  status: string;
  dayIndexes: number[];
};
export const buildLeaderboard = (input: LeaderboardInput[]) => {
  const ordered = input
    .filter((item) => item.status === 'active')
    .map((item) => ({
      ...item,
      score: Math.min(
        new Set(item.dayIndexes.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
          .size,
        4,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) ||
        a.participantId.localeCompare(b.participantId),
    );
  let sportingRank = 0;
  return ordered.map((item, index) => {
    if (!index || ordered[index - 1].score !== item.score) sportingRank = index + 1;
    return {
      participantId: item.participantId,
      displayName: item.displayName,
      score: item.score,
      rank: sportingRank,
      creditedDays: [...new Set(item.dayIndexes)].sort(),
    };
  });
};
