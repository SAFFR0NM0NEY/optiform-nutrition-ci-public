import {
  CHALLENGE_DURATION_MS,
  CHALLENGE_MAX_SCORE,
  CHALLENGE_SYNC_GRACE_MS,
  calculateChallengeScore,
  chooseDaySources,
  getChallengeDayIndex,
} from '../../challenges/domain/friendChallenges';
import { createGymOpaqueId, validGymOpaqueId, validGymText } from './gyms';

export const GYM_CHALLENGES_CONTRACT = 'gym-challenges-v1' as const;
export const GYM_CHALLENGE_PARTICIPATION_CONTRACT = 'gym-challenge-participation-v1' as const;
export const GYM_CHALLENGE_EVIDENCE_CONTRACT = 'gym-challenge-evidence-v1' as const;
export const GYM_CHALLENGE_MAX_PARTICIPANTS = 50;
export const GYM_CHALLENGE_PAGE_SIZE = 20;
export const GYM_CHALLENGE_PAGE_SIZE_MAX = 50;
export const GYM_CHALLENGE_MIN_START_MS = 15 * 60 * 1000;
export const GYM_CHALLENGE_MAX_START_MS = 7 * 24 * 60 * 60 * 1000;

export type GymChallengeStatus = 'enabled' | 'cancelled' | 'archived';
export type GymChallengePhase =
  'registration' | 'active' | 'settling' | 'complete' | 'cancelled' | 'archived';
export type GymChallengeV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_CHALLENGES_CONTRACT;
  challengeId: string;
  gymId: string;
  title: string;
  description: string;
  type: 'training-days';
  status: GymChallengeStatus;
  participantCount: number;
  createdAt: string;
  startsAt: string;
  endsAt: string;
  finalizeAfter: string;
  updatedAt: string;
  cancelledAt?: string;
  archivedAt?: string;
};
export type GymChallengeParticipantControlV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_CHALLENGE_PARTICIPATION_CONTRACT;
  challengeId: string;
  gymId: string;
  participantUid: string;
  participantId: string;
  membershipCycle: number;
  joinedAt: string;
};
export type GymChallengeParticipantV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_CHALLENGE_PARTICIPATION_CONTRACT;
  challengeId: string;
  gymId: string;
  participantId: string;
  displayName: string;
  joinedAt: string;
};
export type GymChallengeEvidenceControlV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_CHALLENGE_EVIDENCE_CONTRACT;
  challengeId: string;
  gymId: string;
  participantUid: string;
  participantId: string;
  membershipCycle: number;
  evidenceId: string;
  dayIndex: number;
  pointValue: 1;
  sourceWorkoutId: string;
  sourceCompletedAt: string;
  createdAt: string;
};
export type GymChallengeEvidenceV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_CHALLENGE_EVIDENCE_CONTRACT;
  challengeId: string;
  gymId: string;
  evidenceId: string;
  participantId: string;
  dayIndex: number;
  pointValue: 1;
};
export type GymChallengeLeaderboardRow = GymChallengeParticipantV1 & {
  score: number;
  creditedDayIndexes: number[];
  rank: number;
};

export const createGymChallengeId = createGymOpaqueId;
export const createGymChallengeParticipantId = createGymOpaqueId;

export function createGymChallenge(
  input: Pick<GymChallengeV1, 'gymId' | 'title' | 'description' | 'startsAt'>,
  now = new Date(),
  challengeId = createGymChallengeId(),
): GymChallengeV1 {
  const starts = Date.parse(input.startsAt),
    created = now.getTime();
  if (
    !validGymOpaqueId(input.gymId) ||
    !validGymOpaqueId(challengeId) ||
    !validGymText(input.title, 2, 80) ||
    !validGymText(input.description, 0, 500) ||
    starts < created + GYM_CHALLENGE_MIN_START_MS ||
    starts > created + GYM_CHALLENGE_MAX_START_MS
  )
    throw new Error('Gym challenge is invalid.');
  const createdAt = now.toISOString();
  return {
    schemaVersion: 1,
    contractVersion: GYM_CHALLENGES_CONTRACT,
    challengeId,
    gymId: input.gymId,
    title: input.title,
    description: input.description,
    type: 'training-days',
    status: 'enabled',
    participantCount: 0,
    createdAt,
    startsAt: new Date(starts).toISOString(),
    endsAt: new Date(starts + CHALLENGE_DURATION_MS).toISOString(),
    finalizeAfter: new Date(starts + CHALLENGE_DURATION_MS + CHALLENGE_SYNC_GRACE_MS).toISOString(),
    updatedAt: createdAt,
  };
}

export function getGymChallengePhase(
  challenge: GymChallengeV1,
  now = new Date(),
): GymChallengePhase {
  if (challenge.status === 'cancelled') return 'cancelled';
  if (challenge.status === 'archived') return 'archived';
  const current = now.getTime();
  if (current < Date.parse(challenge.startsAt)) return 'registration';
  if (current < Date.parse(challenge.endsAt)) return 'active';
  if (current < Date.parse(challenge.finalizeAfter)) return 'settling';
  return 'complete';
}

export function makeGymChallengeEvidenceId(participantId: string, dayIndex: number) {
  if (
    !validGymOpaqueId(participantId) ||
    !Number.isInteger(dayIndex) ||
    dayIndex < 0 ||
    dayIndex > 6
  )
    throw new Error('Gym challenge evidence identity is invalid.');
  return `${participantId}_${dayIndex}`;
}

export function buildGymChallengeLeaderboard(
  participants: GymChallengeParticipantV1[],
  evidence: GymChallengeEvidenceV1[],
): GymChallengeLeaderboardRow[] {
  const rows = participants
    .map((participant) => {
      const result = calculateChallengeScore(
        evidence.map((entry) => ({
          participantUid: entry.participantId,
          pointValue: entry.pointValue,
          dayIndex: entry.dayIndex,
        })),
        participant.participantId,
      );
      return { ...participant, ...result, rank: 0 };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }) ||
        left.participantId.localeCompare(right.participantId),
    );
  return rows.map((row) => ({
    ...row,
    rank: rows.findIndex((candidate) => candidate.score === row.score) + 1,
  }));
}

export function chooseGymChallengeDaySources<T extends { workoutId: string; completedAt: string }>(
  challenge: GymChallengeV1,
  sources: T[],
) {
  return chooseDaySources(challenge, sources);
}

export {
  CHALLENGE_DURATION_MS,
  CHALLENGE_MAX_SCORE,
  CHALLENGE_SYNC_GRACE_MS,
  getChallengeDayIndex,
};
