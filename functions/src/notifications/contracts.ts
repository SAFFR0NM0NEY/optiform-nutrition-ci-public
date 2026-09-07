import { createHash } from 'node:crypto';

export const REMOTE_INBOX_CONTRACT = 'notification-remote-inbox-v1' as const;
export const INSTALLATION_CONTRACT = 'notification-installation-registration-v1' as const;
export const REMOTE_PREFERENCES_CONTRACT = 'notification-remote-preferences-v1' as const;
export const PUSH_DELIVERY_CONTRACT = 'notification-push-delivery-v1' as const;
export const MAX_REMOTE_NOTIFICATIONS = 250;
export const MAX_REMOTE_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_WEB_INSTALLATIONS = 10;
export const INSTALLATION_FRESHNESS_MS = 45 * 24 * 60 * 60 * 1000;

export type NotificationRecord = {
  schemaVersion: 1;
  contractVersion: 'notification-centre-v1';
  id: string;
  recipientUid: string;
  category:
    | 'training-program'
    | 'challenge-community'
    | 'account-security'
    | 'coach-message'
    | 'creator-marketplace'
    | 'commercial-campaign';
  eventType: string;
  sourceDomain: string;
  sourceEventId: string;
  title: string;
  body: string;
  destination:
    'home' | 'train' | 'programs' | 'progress' | 'challenges' | 'profile' | 'account-privacy';
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

const categories = [
  'training-program',
  'challenge-community',
  'account-security',
  'coach-message',
  'creator-marketplace',
  'commercial-campaign',
] as const;
const destinations = [
  'home',
  'train',
  'programs',
  'progress',
  'challenges',
  'profile',
  'account-privacy',
];
const token = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const markup = /<[^>]*>|javascript:|https?:\/\//i;

export function notificationIdentity(
  uid: string,
  sourceDomain: string,
  sourceEventId: string,
  eventType: string,
) {
  const input = `${uid}\u001f${sourceDomain}\u001f${sourceEventId}\u001f${eventType}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `notification-${(hash >>> 0).toString(36)}`;
}

export function validNotification(
  value: unknown,
  uid: string,
  now = Date.now(),
): value is NotificationRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const created = typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : NaN;
  const optionalTime = (candidate: unknown) =>
    candidate === null || (typeof candidate === 'string' && Number.isFinite(Date.parse(candidate)));
  return (
    item.schemaVersion === 1 &&
    item.contractVersion === 'notification-centre-v1' &&
    item.recipientUid === uid &&
    typeof item.id === 'string' &&
    item.id ===
      notificationIdentity(
        uid,
        String(item.sourceDomain ?? ''),
        String(item.sourceEventId ?? ''),
        String(item.eventType ?? ''),
      ) &&
    categories.includes(item.category as (typeof categories)[number]) &&
    typeof item.eventType === 'string' &&
    token.test(item.eventType) &&
    typeof item.sourceDomain === 'string' &&
    token.test(item.sourceDomain) &&
    typeof item.sourceEventId === 'string' &&
    item.sourceEventId.length <= 128 &&
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    item.title.length <= 80 &&
    !markup.test(item.title) &&
    typeof item.body === 'string' &&
    item.body.length > 0 &&
    item.body.length <= 180 &&
    !markup.test(item.body) &&
    destinations.includes(String(item.destination)) &&
    Number.isFinite(created) &&
    created <= now + 300_000 &&
    now - created <= MAX_REMOTE_AGE_MS &&
    optionalTime(item.readAt) &&
    optionalTime(item.dismissedAt) &&
    Object.keys(item).length === 14
  );
}

const immutableFields: (keyof NotificationRecord)[] = [
  'recipientUid',
  'category',
  'eventType',
  'sourceDomain',
  'sourceEventId',
  'title',
  'body',
  'destination',
  'createdAt',
];
export function sameSemantics(a: NotificationRecord, b: NotificationRecord) {
  return immutableFields.every((field) => a[field] === b[field]);
}
const earliest = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b;
export function mergeState(a: NotificationRecord, b: NotificationRecord): NotificationRecord {
  if (!sameSemantics(a, b)) throw new Error('notification-id-collision');
  return {
    ...a,
    readAt: earliest(a.readAt, b.readAt),
    dismissedAt: earliest(a.dismissedAt, b.dismissedAt),
  };
}
export function sortAndPrune(records: NotificationRecord[], now = Date.now()) {
  return records
    .filter((item) => now - Date.parse(item.createdAt) <= MAX_REMOTE_AGE_MS)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, MAX_REMOTE_NOTIFICATIONS);
}
export function registrationId(fid: string) {
  return createHash('sha256').update(fid, 'utf8').digest('hex');
}
export function validFid(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512 || value.trim() !== value)
    return false;
  return [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code > 32 && code !== 127;
  });
}
