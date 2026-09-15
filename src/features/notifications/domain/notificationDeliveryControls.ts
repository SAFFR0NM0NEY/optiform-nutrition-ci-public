import {
  sortNotifications,
  type NotificationCategory,
  type NotificationRecordV1,
} from './notifications';

export const NOTIFICATION_DELIVERY_CONTROLS_CONTRACT = 'notification-delivery-controls-v1' as const;

export const deliveryModes = ['instant', 'daily-digest'] as const;
export type NotificationDeliveryMode = (typeof deliveryModes)[number];
export type NotificationDeliveryClass =
  'mandatory' | 'time-sensitive' | 'digest-eligible' | 'suppressible-instant';

export type NotificationDeliveryControlsV1 = {
  schemaVersion: 1;
  contractVersion: typeof NOTIFICATION_DELIVERY_CONTROLS_CONTRACT;
  recipientUid: string;
  timeZone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  trainingProgramMode: NotificationDeliveryMode;
  challengeCommunityMode: NotificationDeliveryMode;
  digestHourLocal: number;
};

export type NotificationPresentationItem =
  | { kind: 'notification'; key: string; newestAt: string; item: NotificationRecordV1 }
  | {
      kind: 'digest';
      key: string;
      newestAt: string;
      category: Extract<NotificationCategory, 'training-program' | 'challenge-community'>;
      localDate: string;
      items: NotificationRecordV1[];
    };

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const digestEligibleEvents = new Set([
  'training-program:achievement-unlocked',
  'training-program:personal-season-finalized',
  'challenge-community:challenge-settled',
  'training-program:gym-program-assigned',
  'training-program:gym-program-assignment-revoked',
  'challenge-community:friend-challenge-invite',
  'challenge-community:friend-challenge-accepted',
  'challenge-community:friend-challenge-declined',
  'challenge-community:friend-challenge-cancelled',
  'challenge-community:friend-challenge-overtaken',
  'challenge-community:creator-challenge-member-joined',
  'challenge-community:creator-challenge-member-withdrawn',
]);
const timeSensitiveEvents = new Set([
  'challenge-community:friend-challenge-ending-soon',
  'challenge-community:friend-challenge-final-window',
]);

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatter(timeZone: string) {
  let value = formatterCache.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat('en-CA-u-ca-iso8601', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, value);
  }
  return value;
}

export function validIanaTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100) return false;
  try {
    formatter(timeZone).format(0);
    return true;
  } catch {
    return false;
  }
}

export function deviceTimeZone() {
  const candidate = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return validIanaTimeZone(candidate) ? candidate : 'UTC';
}

export function defaultNotificationDeliveryControls(
  uid: string,
  timeZone = deviceTimeZone(),
): NotificationDeliveryControlsV1 {
  if (!UID.test(uid)) throw new Error('Invalid authenticated user namespace.');
  return {
    schemaVersion: 1,
    contractVersion: NOTIFICATION_DELIVERY_CONTROLS_CONTRACT,
    recipientUid: uid,
    timeZone: validIanaTimeZone(timeZone) ? timeZone : 'UTC',
    quietHoursEnabled: false,
    quietStartMinute: 22 * 60,
    quietEndMinute: 7 * 60,
    trainingProgramMode: 'instant',
    challengeCommunityMode: 'instant',
    digestHourLocal: 9,
  };
}

export function validateNotificationDeliveryControls(
  value: unknown,
  uid?: string,
): value is NotificationDeliveryControlsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const minute = (candidate: unknown) =>
    Number.isInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 1439;
  return (
    item.schemaVersion === 1 &&
    item.contractVersion === NOTIFICATION_DELIVERY_CONTROLS_CONTRACT &&
    typeof item.recipientUid === 'string' &&
    UID.test(item.recipientUid) &&
    (!uid || item.recipientUid === uid) &&
    validIanaTimeZone(item.timeZone) &&
    typeof item.quietHoursEnabled === 'boolean' &&
    minute(item.quietStartMinute) &&
    minute(item.quietEndMinute) &&
    (!item.quietHoursEnabled || item.quietStartMinute !== item.quietEndMinute) &&
    deliveryModes.includes(item.trainingProgramMode as NotificationDeliveryMode) &&
    deliveryModes.includes(item.challengeCommunityMode as NotificationDeliveryMode) &&
    Number.isInteger(item.digestHourLocal) &&
    Number(item.digestHourLocal) >= 0 &&
    Number(item.digestHourLocal) <= 23 &&
    Object.keys(item).length === 10
  );
}

function localParts(at: number | Date, timeZone: string): LocalParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

const dateKey = (parts: Pick<LocalParts, 'year' | 'month' | 'day'>) =>
  `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day
    .toString()
    .padStart(2, '0')}`;

export function localDateKey(at: number | Date | string, timeZone: string) {
  if (!validIanaTimeZone(timeZone)) throw new Error('Invalid IANA time zone.');
  const instant = typeof at === 'string' ? Date.parse(at) : at instanceof Date ? at.getTime() : at;
  if (!Number.isFinite(instant)) throw new Error('Invalid instant.');
  return dateKey(localParts(instant, timeZone));
}

export function isInsideQuietHours(at: number | Date, controls: NotificationDeliveryControlsV1) {
  if (!validateNotificationDeliveryControls(controls, controls.recipientUid)) return false;
  if (!controls.quietHoursEnabled) return false;
  const parts = localParts(at, controls.timeZone);
  const currentMinute = parts.hour * 60 + parts.minute;
  const { quietStartMinute: start, quietEndMinute: end } = controls;
  return start < end
    ? currentMinute >= start && currentMinute < end
    : currentMinute >= start || currentMinute < end;
}

function offsetAt(instant: number, timeZone: string) {
  const parts = localParts(instant, timeZone);
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(instant / 1000) * 1000
  );
}

function localInstant(
  targetDate: string,
  minuteOfDay: number,
  timeZone: string,
  notBefore = Number.NEGATIVE_INFINITY,
) {
  const [year, month, day] = targetDate.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set([
    offsetAt(targetUtc - 36 * 60 * 60 * 1000, timeZone),
    offsetAt(targetUtc, timeZone),
    offsetAt(targetUtc + 36 * 60 * 60 * 1000, timeZone),
  ]);
  const exact = [...offsets]
    .map((offset) => targetUtc - offset)
    .filter((candidate) => {
      const parts = localParts(candidate, timeZone);
      return (
        candidate >= notBefore &&
        dateKey(parts) === targetDate &&
        parts.hour === hour &&
        parts.minute === minute
      );
    });
  if (exact.length) return Math.min(...exact);

  // A spring-forward gap has no exact wall-clock instant. Choose the first valid local minute
  // after the requested one, which is deterministic and never fires before the configured time.
  const estimate = targetUtc - offsetAt(targetUtc, timeZone);
  let best: { instant: number; localMinute: number } | null = null;
  for (
    let candidate = estimate - 3 * 60 * 60 * 1000;
    candidate <= estimate + 3 * 60 * 60 * 1000;
    candidate += 60_000
  ) {
    const parts = localParts(candidate, timeZone);
    const localMinute = parts.hour * 60 + parts.minute;
    if (
      dateKey(parts) === targetDate &&
      candidate >= notBefore &&
      localMinute >= minuteOfDay &&
      (!best ||
        localMinute < best.localMinute ||
        (localMinute === best.localMinute && candidate < best.instant))
    )
      best = { instant: candidate, localMinute };
  }
  if (!best) throw new Error('Unable to resolve local time.');
  return best.instant;
}

function addLocalDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear().toString().padStart(4, '0')}-${(next.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`;
}

export function nextQuietHoursEnd(at: number | Date, controls: NotificationDeliveryControlsV1) {
  const instant = at instanceof Date ? at.getTime() : at;
  if (!isInsideQuietHours(instant, controls)) return null;
  const parts = localParts(instant, controls.timeZone);
  const currentMinute = parts.hour * 60 + parts.minute;
  const currentDate = dateKey(parts);
  const endDate =
    controls.quietStartMinute > controls.quietEndMinute &&
    currentMinute >= controls.quietStartMinute
      ? addLocalDays(currentDate, 1)
      : currentDate;
  return localInstant(endDate, controls.quietEndMinute, controls.timeZone, instant);
}

export function nextDigestDelivery(at: number | Date, controls: NotificationDeliveryControlsV1) {
  const instant = at instanceof Date ? at.getTime() : at;
  const parts = localParts(instant, controls.timeZone);
  const currentMinute = parts.hour * 60 + parts.minute;
  const digestMinute = controls.digestHourLocal * 60;
  const currentDate = dateKey(parts);
  const deliveryDate = currentMinute < digestMinute ? currentDate : addLocalDays(currentDate, 1);
  let candidate = localInstant(deliveryDate, digestMinute, controls.timeZone, instant);
  const quietEnd = nextQuietHoursEnd(candidate, controls);
  if (quietEnd !== null) candidate = quietEnd;
  return candidate;
}

export function classifyNotificationDelivery(
  notification: Pick<NotificationRecordV1, 'category' | 'eventType'>,
): NotificationDeliveryClass {
  if (notification.category === 'account-security') return 'mandatory';
  const semantic = `${notification.category}:${notification.eventType}`;
  if (timeSensitiveEvents.has(semantic)) return 'time-sensitive';
  if (digestEligibleEvents.has(semantic)) return 'digest-eligible';
  return 'suppressible-instant';
}

export function deliveryModeForCategory(
  category: NotificationCategory,
  controls: NotificationDeliveryControlsV1,
) {
  if (category === 'training-program') return controls.trainingProgramMode;
  if (category === 'challenge-community') return controls.challengeCommunityMode;
  return 'instant';
}

export function buildNotificationPresentation(
  records: NotificationRecordV1[],
  controls: NotificationDeliveryControlsV1,
): NotificationPresentationItem[] {
  const visible = sortNotifications(records);
  const groups = new Map<string, Extract<NotificationPresentationItem, { kind: 'digest' }>>();
  const output: NotificationPresentationItem[] = [];
  for (const item of visible) {
    const category = item.category;
    const digestible =
      (category === 'training-program' || category === 'challenge-community') &&
      deliveryModeForCategory(category, controls) === 'daily-digest' &&
      classifyNotificationDelivery(item) === 'digest-eligible';
    if (!digestible) {
      output.push({ kind: 'notification', key: item.id, newestAt: item.createdAt, item });
      continue;
    }
    const localDate = localDateKey(item.createdAt, controls.timeZone);
    const key = `digest:${category}:${localDate}`;
    const previous = groups.get(key);
    if (previous) previous.items.push(item);
    else
      groups.set(key, {
        kind: 'digest',
        key,
        newestAt: item.createdAt,
        category,
        localDate,
        items: [item],
      });
  }
  output.push(...groups.values());
  return output.sort(
    (a, b) => Date.parse(b.newestAt) - Date.parse(a.newestAt) || a.key.localeCompare(b.key),
  );
}

export function minuteToTimeInput(minute: number) {
  return `${Math.floor(minute / 60)
    .toString()
    .padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}

export function timeInputToMinute(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
