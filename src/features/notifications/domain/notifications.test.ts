import { describe, expect, it } from 'vitest';
import {
  createNotification,
  defaultNotificationPreferences,
  destinationRoute,
  dismissNotification,
  insertNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notificationId,
  preferenceAllows,
  pruneNotifications,
  unreadNotificationCount,
  validateNotification,
  type NotificationEvent,
  type NotificationRecordV1,
} from './notifications';

const NOW = '2026-09-05T10:00:00.000Z';
const uid = 'athlete-a';
const baseEvent: NotificationEvent = {
  category: 'training-program',
  eventType: 'achievement-unlocked',
  sourceDomain: 'motivation',
  sourceEventId: 'first-workout',
  title: 'Achievement unlocked',
  body: 'First workout',
  destination: 'progress',
  createdAt: NOW,
};
const make = (event = baseEvent) =>
  createNotification(uid, event, defaultNotificationPreferences(uid), Date.parse(NOW))!;

describe('notification-centre-v1 domain', () => {
  it('creates deterministic identity and separates lifecycle events', () => {
    expect(notificationId(uid, 'challenge', 'one', 'requested')).toBe(
      notificationId(uid, 'challenge', 'one', 'requested'),
    );
    expect(notificationId(uid, 'challenge', 'one', 'requested')).not.toBe(
      notificationId(uid, 'challenge', 'one', 'settled'),
    );
  });
  it('deduplicates repeated source events', () =>
    expect(insertNotification([make()], make(), Date.parse(NOW))).toHaveLength(1));
  it('validates its schema and rejects invalid categories', () => {
    expect(validateNotification(make(), Date.parse(NOW))).toBe(true);
    expect(validateNotification({ ...make(), category: 'unknown' }, Date.parse(NOW))).toBe(false);
  });
  it('recognizes reserved vocabulary but never enables it', () => {
    const reserved = { ...make(), category: 'coach-message' as const };
    expect(validateNotification(reserved, Date.parse(NOW))).toBe(true);
    expect(preferenceAllows(defaultNotificationPreferences(uid), 'coach-message')).toBe(false);
    expect(
      createNotification(
        uid,
        { ...baseEvent, category: 'coach-message' },
        defaultNotificationPreferences(uid),
      ),
    ).toBeNull();
  });
  it('maps only typed safe destinations', () => {
    expect(destinationRoute('challenges')).toBe('/challenges');
    expect(destinationRoute('account-privacy')).toBe('/profile/privacy');
  });
  it('rejects markup, URLs, oversized copy and unsafe destination data', () => {
    expect(
      createNotification(
        uid,
        { ...baseEvent, title: '<b>unsafe</b>' },
        defaultNotificationPreferences(uid),
      ),
    ).toBeNull();
    expect(
      createNotification(
        uid,
        { ...baseEvent, body: 'https://bad.example' },
        defaultNotificationPreferences(uid),
      ),
    ).toBeNull();
    expect(
      createNotification(
        uid,
        { ...baseEvent, title: 'x'.repeat(81) },
        defaultNotificationPreferences(uid),
      ),
    ).toBeNull();
    expect(
      validateNotification({ ...make(), destination: 'javascript:alert(1)' }, Date.parse(NOW)),
    ).toBe(false);
  });
  it('derives unread, read, mark-all and dismiss state without source mutation', () => {
    const record = make();
    expect(unreadNotificationCount([record])).toBe(1);
    const read = markNotificationRead([record], record.id, NOW);
    expect(unreadNotificationCount(read)).toBe(0);
    expect(markAllNotificationsRead([record], NOW)[0].readAt).toBe(NOW);
    expect(dismissNotification([record], record.id, NOW)[0].dismissedAt).toBe(NOW);
    expect(record.readAt).toBeNull();
  });
  it('caps retention at 250 newest records', () => {
    const records = Array.from({ length: 260 }, (_, index) =>
      make({ ...baseEvent, sourceEventId: String(index) }),
    );
    expect(pruneNotifications(records, Date.parse(NOW))).toHaveLength(250);
  });
  it('drops records older than 90 rolling days', () => {
    const old = make({ ...baseEvent, sourceEventId: 'old', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(pruneNotifications([old, make()], Date.parse(NOW))).toEqual([make()]);
  });
  it('uses stable ID ordering for equal timestamps', () => {
    const records = [
      make({ ...baseEvent, sourceEventId: 'b' }),
      make({ ...baseEvent, sourceEventId: 'a' }),
    ];
    const expected = [...records].sort((a, b) => a.id.localeCompare(b.id)).map((item) => item.id);
    expect(pruneNotifications(records, Date.parse(NOW)).map((item) => item.id)).toEqual(expected);
  });
  it('rejects malformed and unreasonable future timestamps', () => {
    expect(validateNotification({ ...make(), createdAt: 'bad' }, Date.parse(NOW))).toBe(false);
    expect(
      validateNotification({ ...make(), createdAt: '2030-01-01T00:00:00.000Z' }, Date.parse(NOW)),
    ).toBe(false);
  });
  it('applies optional preferences while account security stays mandatory', () => {
    const preferences = {
      ...defaultNotificationPreferences(uid),
      trainingProgram: false,
      challengeCommunity: false,
    };
    expect(createNotification(uid, baseEvent, preferences)).toBeNull();
    expect(
      createNotification(uid, { ...baseEvent, category: 'challenge-community' }, preferences),
    ).toBeNull();
    expect(
      createNotification(
        uid,
        { ...baseEvent, category: 'account-security' },
        preferences,
        Date.parse(NOW),
      ),
    ).not.toBeNull();
  });
  it('rejects invalid user namespaces', () => {
    expect(() => defaultNotificationPreferences('../other')).toThrow();
    expect(
      createNotification('../other', baseEvent, defaultNotificationPreferences(uid)),
    ).toBeNull();
  });
  it('rejects tampering with deterministic IDs', () =>
    expect(validateNotification({ ...make(), id: 'random' }, Date.parse(NOW))).toBe(false));
  it('does not mutate records during retention', () => {
    const records: NotificationRecordV1[] = [make()];
    expect(pruneNotifications(records, Date.parse(NOW))).not.toBe(records);
  });
});
