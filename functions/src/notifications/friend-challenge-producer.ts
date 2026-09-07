import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { MAX_REMOTE_AGE_MS, notificationIdentity, type NotificationRecord } from './contracts.js';
import { deliverTrustedNotification, type PushSender } from './service.js';

type Value = Record<string, unknown>;
type Input = { challengeId: string; eventTime: Date; processingNow?: Date };
type EventKind = 'invite' | 'accepted' | 'declined' | 'cancelled';

const HOUR = 60 * 60 * 1000;
const BASE_KEYS = [
  'schemaVersion',
  'contractVersion',
  'challengeId',
  'participantUids',
  'creatorUid',
  'inviteeUid',
  'creatorDisplayName',
  'inviteeDisplayName',
  'type',
  'status',
  'createdAt',
  'inviteExpiresAt',
  'updatedAt',
] as const;
const IMMUTABLE_KEYS = BASE_KEYS.filter((key) => !['status', 'updatedAt'].includes(key));
const MUSCLES = new Set([
  'pectoralis-major',
  'pectoralis-major-clavicular',
  'pectoralis-major-sternocostal',
  'serratus-anterior',
  'anterior-deltoid',
  'lateral-deltoid',
  'posterior-deltoid',
  'latissimus-dorsi',
  'trapezius',
  'rhomboids',
  'spinal-erectors',
  'biceps-brachii',
  'brachialis',
  'brachioradialis',
  'triceps-brachii',
  'triceps-brachii-long-head',
  'triceps-brachii-lateral-head',
  'triceps-brachii-medial-head',
  'forearm-flexors',
  'forearm-extensors',
  'quadriceps',
  'hamstrings',
  'gluteus-maximus',
  'gluteus-medius',
  'hip-adductors',
  'gastrocnemius',
  'soleus',
  'hip-flexors',
  'rectus-abdominis',
  'obliques',
  'deep-core',
]);
const timestamp = (value: unknown): value is Timestamp =>
  value instanceof Timestamp ||
  Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function',
  );
const same = (left: unknown, right: unknown) =>
  timestamp(left) && timestamp(right)
    ? left.toMillis() === right.toMillis()
    : Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((item, index) => item === right[index])
      : left === right;
const exactKeys = (value: Value, required: readonly string[], optional: readonly string[] = []) => {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key as never) || optional.includes(key))
  );
};
const validUid = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  value.trim() === value &&
  !value.includes('/');
const validId = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  value.trim() === value &&
  !value.includes('/');
const validName = (value: unknown) =>
  typeof value === 'string' && value.length >= 2 && value.length <= 40;
const millis = (value: unknown) => (timestamp(value) ? value.toMillis() : NaN);

export function validPendingFriendChallenge(raw: unknown, challengeId: string): raw is Value {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Value;
  const participants = value.participantUids;
  const optional = ['targetMuscleId', 'createdFromChallengeId'];
  return (
    exactKeys(value, BASE_KEYS, optional) &&
    value.schemaVersion === 1 &&
    value.contractVersion === 'friend-challenges-v1' &&
    value.challengeId === challengeId &&
    validId(challengeId) &&
    validUid(value.creatorUid) &&
    validUid(value.inviteeUid) &&
    value.creatorUid !== value.inviteeUid &&
    Array.isArray(participants) &&
    participants.length === 2 &&
    participants[0] < participants[1] &&
    participants.includes(value.creatorUid) &&
    participants.includes(value.inviteeUid) &&
    validName(value.creatorDisplayName) &&
    validName(value.inviteeDisplayName) &&
    ((value.type === 'training-days' && !('targetMuscleId' in value)) ||
      (value.type === 'muscle-training-days' && MUSCLES.has(String(value.targetMuscleId)))) &&
    value.status === 'pending' &&
    timestamp(value.createdAt) &&
    timestamp(value.inviteExpiresAt) &&
    timestamp(value.updatedAt) &&
    millis(value.inviteExpiresAt) === millis(value.createdAt) + 72 * HOUR &&
    millis(value.updatedAt) === millis(value.createdAt) &&
    (!('createdFromChallengeId' in value) || validId(value.createdFromChallengeId))
  );
}

export function friendChallengeTransition(
  beforeRaw: unknown,
  afterRaw: unknown,
  challengeId: string,
): EventKind | null {
  if (
    !validPendingFriendChallenge(beforeRaw, challengeId) ||
    !afterRaw ||
    typeof afterRaw !== 'object' ||
    Array.isArray(afterRaw)
  )
    return null;
  const before = beforeRaw as Value,
    after = afterRaw as Value;
  if (!IMMUTABLE_KEYS.every((key) => same(before[key], after[key]))) return null;
  const optional = [
    ...('targetMuscleId' in before ? ['targetMuscleId'] : []),
    ...('createdFromChallengeId' in before ? ['createdFromChallengeId'] : []),
  ];
  if (!optional.every((key) => same(before[key], after[key]))) return null;
  if (after.status === 'active') {
    if (
      !exactKeys(
        after,
        [...BASE_KEYS, 'acceptedAt', 'startsAt', 'endsAt', 'finalizeAfter'],
        optional,
      ) ||
      !timestamp(after.acceptedAt) ||
      !timestamp(after.startsAt) ||
      !timestamp(after.endsAt) ||
      !timestamp(after.finalizeAfter) ||
      millis(after.acceptedAt) !== millis(after.startsAt) ||
      millis(after.updatedAt) !== millis(after.acceptedAt) ||
      millis(after.endsAt) !== millis(after.startsAt) + 168 * HOUR ||
      millis(after.finalizeAfter) !== millis(after.endsAt) + 48 * HOUR
    )
      return null;
    return 'accepted';
  }
  if (after.status === 'declined' || after.status === 'cancelled') {
    if (
      !exactKeys(after, [...BASE_KEYS, 'resolvedAt'], optional) ||
      !timestamp(after.resolvedAt) ||
      millis(after.updatedAt) !== millis(after.resolvedAt)
    )
      return null;
    return after.status;
  }
  return null;
}

const exactState = (left: Value, right: Value) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.keys(left).every((key) => key in right && same(left[key], right[key]));
const stale = (eventTime: Date, now: Date) =>
  !Number.isFinite(eventTime.getTime()) || now.getTime() - eventTime.getTime() > MAX_REMOTE_AGE_MS;

export function friendChallengeNotification(
  challenge: Value,
  kind: EventKind,
  eventTime: Date,
): NotificationRecord {
  const recipientUid = String(
    kind === 'invite' || kind === 'cancelled' ? challenge.inviteeUid : challenge.creatorUid,
  );
  const sourceEventId = String(challenge.challengeId);
  const copy = {
    invite: ['Friend challenge invite', 'You have a new friend challenge invite.'],
    accepted: ['Friend challenge accepted', 'Your friend challenge was accepted.'],
    declined: ['Friend challenge declined', 'Your friend challenge invite was declined.'],
    cancelled: ['Friend challenge cancelled', 'A friend challenge invite was cancelled.'],
  } as const;
  const eventType = `friend-challenge-${kind}`;
  return {
    schemaVersion: 1,
    contractVersion: 'notification-centre-v1',
    id: notificationIdentity(recipientUid, 'friend-challenges', sourceEventId, eventType),
    recipientUid,
    category: 'challenge-community',
    eventType,
    sourceDomain: 'friend-challenges',
    sourceEventId,
    title: copy[kind][0],
    body: copy[kind][1],
    destination: 'challenges',
    createdAt: eventTime.toISOString(),
    readAt: null,
    dismissedAt: null,
  };
}

export async function processFriendChallengeCreated(
  db: Firestore,
  snapshot: unknown,
  input: Input,
  sender: PushSender,
) {
  const now = input.processingNow ?? new Date();
  if (stale(input.eventTime, now) || !validPendingFriendChallenge(snapshot, input.challengeId))
    return { status: 'ignored' as const };
  const currentSnapshot = await db.doc(`challenges/${input.challengeId}`).get();
  const current = currentSnapshot.data();
  if (
    !currentSnapshot.exists ||
    !validPendingFriendChallenge(current, input.challengeId) ||
    !exactState(snapshot as Value, current as Value) ||
    now.getTime() >= millis(current?.inviteExpiresAt)
  )
    return { status: 'ignored' as const };
  const delivery = await deliverTrustedNotification(
    db,
    String(current?.inviteeUid),
    friendChallengeNotification(current as Value, 'invite', input.eventTime),
    sender,
    now.getTime(),
  );
  return { status: 'accepted' as const, delivery };
}

export async function processFriendChallengeUpdated(
  db: Firestore,
  before: unknown,
  after: unknown,
  input: Input,
  sender: PushSender,
) {
  const now = input.processingNow ?? new Date();
  if (stale(input.eventTime, now)) return { status: 'ignored' as const };
  const kind = friendChallengeTransition(before, after, input.challengeId);
  if (!kind) return { status: 'ignored' as const };
  const currentSnapshot = await db.doc(`challenges/${input.challengeId}`).get();
  const current = currentSnapshot.data();
  if (
    !currentSnapshot.exists ||
    !exactState(after as Value, current as Value) ||
    friendChallengeTransition(before, current, input.challengeId) !== kind
  )
    return { status: 'ignored' as const };
  const recipient = String(kind === 'cancelled' ? current?.inviteeUid : current?.creatorUid);
  const delivery = await deliverTrustedNotification(
    db,
    recipient,
    friendChallengeNotification(current as Value, kind, input.eventTime),
    sender,
    now.getTime(),
  );
  return { status: 'accepted' as const, delivery };
}
