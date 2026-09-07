import {
  MAX_NOTIFICATION_AGE_MS,
  MAX_NOTIFICATIONS,
  pruneNotifications,
  validateNotification,
  type NotificationPreferencesV1,
  type NotificationRecordV1,
} from './notifications';

export const REMOTE_INBOX_CONTRACT = 'notification-remote-inbox-v1' as const;
export const INSTALLATION_CONTRACT = 'notification-installation-registration-v1' as const;
export const REMOTE_PREFERENCES_CONTRACT = 'notification-remote-preferences-v1' as const;
export const PUSH_DELIVERY_CONTRACT = 'notification-push-delivery-v1' as const;
export const MAX_MIRROR_BATCH = 50;
export const MAX_WEB_INSTALLATIONS = 10;
export const INSTALLATION_FRESHNESS_MS = 45 * 24 * 60 * 60 * 1000;

export type RemotePreferences = Pick<
  NotificationPreferencesV1,
  'trainingProgram' | 'challengeCommunity'
>;

const semanticFields: (keyof NotificationRecordV1)[] = [
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

export function sameNotificationSemantics(a: NotificationRecordV1, b: NotificationRecordV1) {
  return semanticFields.every((field) => a[field] === b[field]);
}

function earliest(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

export function mergeNotificationState(local: NotificationRecordV1, remote: NotificationRecordV1) {
  if (!sameNotificationSemantics(local, remote)) throw new Error('notification-id-collision');
  return {
    ...remote,
    readAt: earliest(local.readAt, remote.readAt),
    dismissedAt: earliest(local.dismissedAt, remote.dismissedAt),
  };
}

export function reconcileNotificationCentres(
  local: NotificationRecordV1[],
  remote: NotificationRecordV1[],
  uid: string,
  nowMs = Date.now(),
) {
  const merged = new Map<string, NotificationRecordV1>();
  for (const record of [...remote, ...local]) {
    if (record.recipientUid !== uid || !validateNotification(record, nowMs)) continue;
    const previous = merged.get(record.id);
    merged.set(record.id, previous ? mergeNotificationState(previous, record) : record);
  }
  return pruneNotifications([...merged.values()], nowMs);
}

export function isRetainedNotification(record: NotificationRecordV1, nowMs = Date.now()) {
  return nowMs - Date.parse(record.createdAt) <= MAX_NOTIFICATION_AGE_MS;
}

export function chunkNotificationMirror(records: NotificationRecordV1[]) {
  const retained = pruneNotifications(records);
  return Array.from({ length: Math.ceil(retained.length / MAX_MIRROR_BATCH) }, (_, index) =>
    retained.slice(index * MAX_MIRROR_BATCH, (index + 1) * MAX_MIRROR_BATCH),
  );
}

export function validateRemoteState(records: unknown, uid: string, nowMs = Date.now()) {
  if (!Array.isArray(records) || records.length > MAX_NOTIFICATIONS) return [];
  return records.filter(
    (record): record is NotificationRecordV1 =>
      validateNotification(record, nowMs) && record.recipientUid === uid,
  );
}

export function validTransportPayload(value: unknown): value is {
  kind: 'optiform-notification';
  notificationId: string;
} {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.kind === 'optiform-notification' &&
    typeof payload.notificationId === 'string' &&
    /^notification-[a-z0-9]+$/.test(payload.notificationId)
  );
}
