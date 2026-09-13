export const NOTIFICATION_CONTRACT = 'notification-centre-v1' as const;
export const PREFERENCES_CONTRACT = 'notification-preferences-v1' as const;
export const MAX_NOTIFICATIONS = 250;
export const MAX_NOTIFICATION_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export const notificationCategories = [
  'training-program',
  'challenge-community',
  'account-security',
  'coach-message',
  'creator-marketplace',
  'commercial-campaign',
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];
export type LiveNotificationCategory = Extract<
  NotificationCategory,
  'training-program' | 'challenge-community' | 'account-security'
>;

export const notificationDestinations = [
  'home',
  'train',
  'programs',
  'progress',
  'challenges',
  'profile',
  'account-privacy',
] as const;
export type NotificationDestination = (typeof notificationDestinations)[number];

export type NotificationRecordV1 = {
  schemaVersion: 1;
  contractVersion: typeof NOTIFICATION_CONTRACT;
  id: string;
  recipientUid: string;
  category: NotificationCategory;
  eventType: string;
  sourceDomain: string;
  sourceEventId: string;
  title: string;
  body: string;
  destination: NotificationDestination;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

export type NotificationPreferencesV1 = {
  schemaVersion: 1;
  contractVersion: typeof PREFERENCES_CONTRACT;
  recipientUid: string;
  trainingProgram: boolean;
  challengeCommunity: boolean;
};

export type NotificationEvent = Pick<
  NotificationRecordV1,
  | 'category'
  | 'eventType'
  | 'sourceDomain'
  | 'sourceEventId'
  | 'title'
  | 'body'
  | 'destination'
  | 'createdAt'
>;

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const MARKUP = /<[^>]*>|javascript:|https?:\/\//i;

export function validNotificationUid(uid: string) {
  return UID.test(uid);
}

export function notificationId(
  recipientUid: string,
  sourceDomain: string,
  sourceEventId: string,
  eventType: string,
) {
  const input = `${recipientUid}\u001f${sourceDomain}\u001f${sourceEventId}\u001f${eventType}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `notification-${(hash >>> 0).toString(36)}`;
}

export function destinationRoute(destination: NotificationDestination) {
  return {
    home: '/',
    train: '/train',
    programs: '/train/programs',
    progress: '/progress',
    challenges: '/challenges',
    profile: '/profile',
    'account-privacy': '/profile/privacy',
  }[destination];
}

export function defaultNotificationPreferences(uid: string): NotificationPreferencesV1 {
  if (!validNotificationUid(uid)) throw new Error('Invalid authenticated user namespace.');
  return {
    schemaVersion: 1,
    contractVersion: PREFERENCES_CONTRACT,
    recipientUid: uid,
    trainingProgram: true,
    challengeCommunity: true,
  };
}

export function preferenceAllows(
  preferences: NotificationPreferencesV1,
  category: NotificationCategory,
) {
  if (category === 'account-security') return true;
  if (category === 'training-program') return preferences.trainingProgram;
  if (category === 'challenge-community') return preferences.challengeCommunity;
  return false;
}

export function createNotification(
  recipientUid: string,
  event: NotificationEvent,
  preferences: NotificationPreferencesV1,
  nowMs = Date.now(),
): NotificationRecordV1 | null {
  if (!validNotificationUid(recipientUid) || preferences.recipientUid !== recipientUid) return null;
  if (!preferenceAllows(preferences, event.category)) return null;
  const candidate: NotificationRecordV1 = {
    schemaVersion: 1,
    contractVersion: NOTIFICATION_CONTRACT,
    id: notificationId(recipientUid, event.sourceDomain, event.sourceEventId, event.eventType),
    recipientUid,
    ...event,
    title: event.title.trim(),
    body: event.body.trim(),
    readAt: null,
    dismissedAt: null,
  };
  return validateNotification(candidate, nowMs) ? candidate : null;
}

export function validateNotification(
  value: unknown,
  nowMs = Date.now(),
): value is NotificationRecordV1 {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const createdMs = typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : NaN;
  const validOptionalTimestamp = (timestamp: unknown) =>
    timestamp === null || (typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp)));
  return (
    item.schemaVersion === 1 &&
    item.contractVersion === NOTIFICATION_CONTRACT &&
    typeof item.id === 'string' &&
    item.id ===
      notificationId(
        String(item.recipientUid ?? ''),
        String(item.sourceDomain ?? ''),
        String(item.sourceEventId ?? ''),
        String(item.eventType ?? ''),
      ) &&
    typeof item.recipientUid === 'string' &&
    validNotificationUid(item.recipientUid) &&
    notificationCategories.includes(item.category as NotificationCategory) &&
    typeof item.eventType === 'string' &&
    TOKEN.test(item.eventType) &&
    typeof item.sourceDomain === 'string' &&
    TOKEN.test(item.sourceDomain) &&
    typeof item.sourceEventId === 'string' &&
    item.sourceEventId.length <= 128 &&
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    item.title.length <= 80 &&
    !MARKUP.test(item.title) &&
    typeof item.body === 'string' &&
    item.body.length > 0 &&
    item.body.length <= 180 &&
    !MARKUP.test(item.body) &&
    notificationDestinations.includes(item.destination as NotificationDestination) &&
    Number.isFinite(createdMs) &&
    createdMs <= nowMs + 5 * 60 * 1000 &&
    validOptionalTimestamp(item.readAt) &&
    validOptionalTimestamp(item.dismissedAt)
  );
}

export function sortNotifications(records: NotificationRecordV1[]) {
  return [...records].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
  );
}

export function pruneNotifications(records: NotificationRecordV1[], nowMs = Date.now()) {
  return sortNotifications(
    records.filter((item) => nowMs - Date.parse(item.createdAt) <= MAX_NOTIFICATION_AGE_MS),
  ).slice(0, MAX_NOTIFICATIONS);
}

export function insertNotification(
  records: NotificationRecordV1[],
  notification: NotificationRecordV1,
  nowMs = Date.now(),
) {
  return pruneNotifications(
    records.some((item) => item.id === notification.id) ? records : [...records, notification],
    nowMs,
  );
}

export const unreadNotificationCount = (records: NotificationRecordV1[]) =>
  records.filter((item) => !item.readAt && !item.dismissedAt).length;

export function markNotificationRead(records: NotificationRecordV1[], id: string, now: string) {
  return records.map((item) => (item.id === id && !item.readAt ? { ...item, readAt: now } : item));
}

export function markAllNotificationsRead(records: NotificationRecordV1[], now: string) {
  return records.map((item) =>
    !item.dismissedAt && !item.readAt ? { ...item, readAt: now } : item,
  );
}

export function dismissNotification(records: NotificationRecordV1[], id: string, now: string) {
  return records.map((item) => (item.id === id ? { ...item, dismissedAt: now } : item));
}
