import { createHash } from 'node:crypto';
import type { NotificationRecord } from './contracts.js';

export const DELIVERY_CONTROLS_CONTRACT = 'notification-delivery-controls-v1' as const;
export const REMOTE_DELIVERY_CONTROLS_CONTRACT =
  'notification-remote-delivery-controls-v1' as const;
export const DELIVERY_QUEUE_CONTRACT = 'notification-delivery-queue-v1' as const;
export const MAX_DELIVERY_QUEUE_PER_UID = 250;
export const MAX_DELIVERY_SWEEP = 500;

export const deliveryModes = ['instant', 'daily-digest'] as const;
export type DeliveryMode = (typeof deliveryModes)[number];
export type DeliveryClass =
  'mandatory' | 'time-sensitive' | 'digest-eligible' | 'suppressible-instant';

export type DeliveryControls = {
  schemaVersion: 1;
  contractVersion: typeof DELIVERY_CONTROLS_CONTRACT;
  recipientUid: string;
  timeZone: string;
  quietHoursEnabled: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
  trainingProgramMode: DeliveryMode;
  challengeCommunityMode: DeliveryMode;
  digestHourLocal: number;
};

export type DeliveryControlsInput = Omit<
  DeliveryControls,
  'schemaVersion' | 'contractVersion' | 'recipientUid'
>;

export type DeliveryDecision =
  | { kind: 'immediate'; deliveryClass: DeliveryClass }
  | {
      kind: 'queue';
      deliveryClass: DeliveryClass;
      deliveryMode: DeliveryMode;
      deliveryAt: number;
    }
  | { kind: 'none'; deliveryClass: DeliveryClass; reason: 'expired' };

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

const exactKeys = (value: unknown, keys: string[]) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as object)
      .sort()
      .join('|') === [...keys].sort().join('|'),
  );

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

export function validDeliveryControlsInput(value: unknown): value is DeliveryControlsInput {
  const keys = [
    'timeZone',
    'quietHoursEnabled',
    'quietStartMinute',
    'quietEndMinute',
    'trainingProgramMode',
    'challengeCommunityMode',
    'digestHourLocal',
  ];
  if (!exactKeys(value, keys)) return false;
  const item = value as Record<string, unknown>;
  const minute = (candidate: unknown) =>
    Number.isInteger(candidate) && Number(candidate) >= 0 && Number(candidate) <= 1439;
  return (
    validIanaTimeZone(item.timeZone) &&
    typeof item.quietHoursEnabled === 'boolean' &&
    minute(item.quietStartMinute) &&
    minute(item.quietEndMinute) &&
    (!item.quietHoursEnabled || item.quietStartMinute !== item.quietEndMinute) &&
    deliveryModes.includes(item.trainingProgramMode as DeliveryMode) &&
    deliveryModes.includes(item.challengeCommunityMode as DeliveryMode) &&
    Number.isInteger(item.digestHourLocal) &&
    Number(item.digestHourLocal) >= 0 &&
    Number(item.digestHourLocal) <= 23
  );
}

export function createDeliveryControls(
  uid: string,
  input: DeliveryControlsInput,
): DeliveryControls {
  if (!validDeliveryControlsInput(input)) throw new Error('invalid-delivery-controls');
  return {
    schemaVersion: 1,
    contractVersion: DELIVERY_CONTROLS_CONTRACT,
    recipientUid: uid,
    ...input,
  };
}

export function parseRemoteDeliveryControls(value: unknown, uid: string): DeliveryControls | null {
  const keys = [
    'schemaVersion',
    'contractVersion',
    'ownerUid',
    'timeZone',
    'quietHoursEnabled',
    'quietStartMinute',
    'quietEndMinute',
    'trainingProgramMode',
    'challengeCommunityMode',
    'digestHourLocal',
    'createdAt',
    'updatedAt',
  ];
  if (!exactKeys(value, keys)) return null;
  const item = value as Record<string, unknown>;
  const timestamp = (candidate: unknown) =>
    Boolean(
      candidate &&
      typeof candidate === 'object' &&
      'toMillis' in candidate &&
      typeof candidate.toMillis === 'function' &&
      Number.isFinite(candidate.toMillis()),
    );
  if (
    item.schemaVersion !== 1 ||
    item.contractVersion !== REMOTE_DELIVERY_CONTROLS_CONTRACT ||
    item.ownerUid !== uid ||
    !timestamp(item.createdAt) ||
    !timestamp(item.updatedAt)
  )
    return null;
  const input = {
    timeZone: item.timeZone,
    quietHoursEnabled: item.quietHoursEnabled,
    quietStartMinute: item.quietStartMinute,
    quietEndMinute: item.quietEndMinute,
    trainingProgramMode: item.trainingProgramMode,
    challengeCommunityMode: item.challengeCommunityMode,
    digestHourLocal: item.digestHourLocal,
  };
  return validDeliveryControlsInput(input) ? createDeliveryControls(uid, input) : null;
}

function localParts(at: number, timeZone: string): LocalParts {
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
  if (!best) throw new Error('invalid-local-time');
  return best.instant;
}

function addLocalDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear().toString().padStart(4, '0')}-${(next.getUTCMonth() + 1)
    .toString()
    .padStart(2, '0')}-${next.getUTCDate().toString().padStart(2, '0')}`;
}

export function isQuiet(at: number, controls: DeliveryControls) {
  if (!controls.quietHoursEnabled) return false;
  const parts = localParts(at, controls.timeZone);
  const minute = parts.hour * 60 + parts.minute;
  const { quietStartMinute: start, quietEndMinute: end } = controls;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

export function nextQuietEnd(at: number, controls: DeliveryControls) {
  if (!isQuiet(at, controls)) return null;
  const parts = localParts(at, controls.timeZone);
  const minute = parts.hour * 60 + parts.minute;
  const today = dateKey(parts);
  const endDate =
    controls.quietStartMinute > controls.quietEndMinute && minute >= controls.quietStartMinute
      ? addLocalDays(today, 1)
      : today;
  return localInstant(endDate, controls.quietEndMinute, controls.timeZone, at);
}

export function nextDigestAt(at: number, controls: DeliveryControls) {
  const parts = localParts(at, controls.timeZone);
  const minute = parts.hour * 60 + parts.minute;
  const digestMinute = controls.digestHourLocal * 60;
  const today = dateKey(parts);
  const targetDate = minute < digestMinute ? today : addLocalDays(today, 1);
  let candidate = localInstant(targetDate, digestMinute, controls.timeZone, at);
  const quietEnd = nextQuietEnd(candidate, controls);
  if (quietEnd !== null) candidate = quietEnd;
  return candidate;
}

export function classifyDelivery(notification: Pick<NotificationRecord, 'category' | 'eventType'>) {
  if (notification.category === 'account-security') return 'mandatory' as const;
  const semantic = `${notification.category}:${notification.eventType}`;
  if (timeSensitiveEvents.has(semantic)) return 'time-sensitive' as const;
  if (digestEligibleEvents.has(semantic)) return 'digest-eligible' as const;
  return 'suppressible-instant' as const;
}

export function modeForNotification(notification: NotificationRecord, controls: DeliveryControls) {
  if (notification.category === 'training-program') return controls.trainingProgramMode;
  if (notification.category === 'challenge-community') return controls.challengeCommunityMode;
  return 'instant';
}

export function decideDelivery(
  notification: NotificationRecord,
  controls: DeliveryControls,
  now: number,
  notAfter?: number,
): DeliveryDecision {
  const deliveryClass = classifyDelivery(notification);
  if (deliveryClass === 'mandatory') return { kind: 'immediate', deliveryClass };
  if (notAfter !== undefined && now >= notAfter)
    return { kind: 'none', deliveryClass, reason: 'expired' };
  const mode =
    deliveryClass === 'digest-eligible' ? modeForNotification(notification, controls) : 'instant';
  const deliveryAt =
    mode === 'daily-digest' ? nextDigestAt(now, controls) : nextQuietEnd(now, controls);
  if (deliveryAt === null) return { kind: 'immediate', deliveryClass };
  if (notAfter !== undefined && deliveryAt >= notAfter)
    return { kind: 'none', deliveryClass, reason: 'expired' };
  return { kind: 'queue', deliveryClass, deliveryMode: mode, deliveryAt };
}

export function deliveryQueueIdentity(uid: string, notificationId: string) {
  return createHash('sha256').update(`${uid}\u001f${notificationId}`, 'utf8').digest('hex');
}
