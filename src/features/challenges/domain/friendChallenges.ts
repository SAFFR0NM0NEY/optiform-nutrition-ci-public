import { muscles, type MuscleId } from '../../exercises/domain/taxonomies';

export const FRIEND_CHALLENGES_CONTRACT_VERSION = 'friend-challenges-v1' as const;
export const CHALLENGE_DURATION_MS = 168 * 60 * 60 * 1000;
export const CHALLENGE_INVITE_EXPIRY_MS = 72 * 60 * 60 * 1000;
export const CHALLENGE_SYNC_GRACE_MS = 48 * 60 * 60 * 1000;
export const CHALLENGE_DAY_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_MAX_SCORE = 4;

export type FriendChallengeType = 'training-days' | 'muscle-training-days';
export type FriendChallengeStatus =
  'pending' | 'active' | 'completed' | 'declined' | 'cancelled' | 'expired';

export type FriendChallengeV1 = {
  schemaVersion: 1;
  contractVersion: typeof FRIEND_CHALLENGES_CONTRACT_VERSION;
  challengeId: string;
  participantUids: [string, string];
  creatorUid: string;
  inviteeUid: string;
  creatorDisplayName: string;
  inviteeDisplayName: string;
  type: FriendChallengeType;
  targetMuscleId?: MuscleId;
  status: FriendChallengeStatus;
  createdAt: string;
  inviteExpiresAt: string;
  acceptedAt?: string;
  startsAt?: string;
  endsAt?: string;
  finalizeAfter?: string;
  resolvedAt?: string;
  completedAt?: string;
  createdFromChallengeId?: string;
  updatedAt: string;
};

export type ChallengeDayEvidenceV1 = {
  schemaVersion: 1;
  contractVersion: typeof FRIEND_CHALLENGES_CONTRACT_VERSION;
  challengeId: string;
  participantUid: string;
  dayIndex: number;
  pointValue: 1;
  sourceKind: 'completed-workout' | 'muscle-evidence';
  sourceWorkoutId: string;
  sourceCompletedAt: string;
  sourceMuscleId?: MuscleId;
  createdAt: string;
};

export type ChallengePhase = FriendChallengeStatus | 'settling' | 'ready-to-finalize';

export function orderParticipantUids(uidA: string, uidB: string): [string, string] {
  if (!uidA || !uidB || uidA === uidB) throw new Error('Two distinct participants are required.');
  return [uidA, uidB].sort() as [string, string];
}

export function makeChallengeEntryId(participantUid: string, dayIndex: number) {
  if (
    !/^[A-Za-z0-9]+$/.test(participantUid) ||
    !Number.isInteger(dayIndex) ||
    dayIndex < 0 ||
    dayIndex > 6
  )
    throw new Error('Invalid challenge evidence identity.');
  return `${participantUid}_${dayIndex}`;
}

export function isCanonicalMuscleId(value: string): value is MuscleId {
  return muscles.some((muscle) => muscle.id === value);
}

export function createPendingChallenge(input: {
  challengeId: string;
  creatorUid: string;
  inviteeUid: string;
  creatorDisplayName: string;
  inviteeDisplayName: string;
  type: FriendChallengeType;
  targetMuscleId?: MuscleId;
  createdAt: string;
  createdFromChallengeId?: string;
}): FriendChallengeV1 {
  if (!input.challengeId.trim()) throw new Error('Challenge ID is required.');
  if (input.type === 'training-days' && input.targetMuscleId)
    throw new Error('Training-days challenges cannot target a muscle.');
  if (
    input.type === 'muscle-training-days' &&
    (!input.targetMuscleId || !isCanonicalMuscleId(input.targetMuscleId))
  )
    throw new Error('Choose one canonical muscle.');
  const created = Date.parse(input.createdAt);
  if (!Number.isFinite(created)) throw new Error('Invalid challenge creation time.');
  return {
    schemaVersion: 1,
    contractVersion: FRIEND_CHALLENGES_CONTRACT_VERSION,
    challengeId: input.challengeId,
    participantUids: orderParticipantUids(input.creatorUid, input.inviteeUid),
    creatorUid: input.creatorUid,
    inviteeUid: input.inviteeUid,
    creatorDisplayName: input.creatorDisplayName,
    inviteeDisplayName: input.inviteeDisplayName,
    type: input.type,
    ...(input.targetMuscleId ? { targetMuscleId: input.targetMuscleId } : {}),
    status: 'pending',
    createdAt: input.createdAt,
    inviteExpiresAt: new Date(created + CHALLENGE_INVITE_EXPIRY_MS).toISOString(),
    ...(input.createdFromChallengeId
      ? { createdFromChallengeId: input.createdFromChallengeId }
      : {}),
    updatedAt: input.createdAt,
  };
}

export function getChallengeDayIndex(startsAt: string, sourceCompletedAt: string) {
  const elapsed = Date.parse(sourceCompletedAt) - Date.parse(startsAt);
  if (elapsed < 0 || elapsed >= CHALLENGE_DURATION_MS) return null;
  return Math.floor(elapsed / CHALLENGE_DAY_MS);
}

export function getChallengePhase(challenge: FriendChallengeV1, now = new Date()): ChallengePhase {
  const current = now.getTime();
  if (challenge.status === 'pending' && current >= Date.parse(challenge.inviteExpiresAt))
    return 'expired';
  if (challenge.status !== 'active') return challenge.status;
  if (current < Date.parse(challenge.endsAt!)) return 'active';
  if (current < Date.parse(challenge.finalizeAfter!)) return 'settling';
  return 'ready-to-finalize';
}

export function calculateChallengeScore(
  entries: Array<Pick<ChallengeDayEvidenceV1, 'participantUid' | 'pointValue' | 'dayIndex'>>,
  participantUid: string,
) {
  const creditedDayIndexes = [
    ...new Set(
      entries
        .filter(
          (entry) =>
            entry.participantUid === participantUid &&
            entry.pointValue === 1 &&
            Number.isInteger(entry.dayIndex) &&
            entry.dayIndex >= 0 &&
            entry.dayIndex <= 6,
        )
        .map((entry) => entry.dayIndex),
    ),
  ].sort((left, right) => left - right);
  return { score: Math.min(creditedDayIndexes.length, CHALLENGE_MAX_SCORE), creditedDayIndexes };
}

export function calculateChallengeResult(creatorScore: number, inviteeScore: number) {
  if (creatorScore === inviteeScore) return 'tie' as const;
  return creatorScore > inviteeScore ? ('creator-win' as const) : ('invitee-win' as const);
}

export function chooseDaySources<T extends { workoutId: string; completedAt: string }>(
  challenge: Pick<FriendChallengeV1, 'startsAt' | 'endsAt'>,
  sources: T[],
) {
  if (!challenge.startsAt || !challenge.endsAt) return [];
  const selected = new Map<number, T>();
  [...sources]
    .sort(
      (left, right) =>
        Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
        left.workoutId.localeCompare(right.workoutId),
    )
    .forEach((source) => {
      const dayIndex = getChallengeDayIndex(challenge.startsAt!, source.completedAt);
      if (dayIndex !== null && !selected.has(dayIndex)) selected.set(dayIndex, source);
    });
  return [...selected.entries()].map(([dayIndex, source]) => ({ dayIndex, source }));
}
