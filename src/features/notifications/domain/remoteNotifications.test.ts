import { describe, expect, it } from 'vitest';
import { createNotification, defaultNotificationPreferences } from './notifications';
import {
  chunkNotificationMirror,
  mergeNotificationState,
  reconcileNotificationCentres,
  validTransportPayload,
} from './remoteNotifications';

const now = '2026-09-06T10:00:00.000Z';
const record = (uid = 'athlete-a', sourceEventId = 'one') =>
  createNotification(
    uid,
    {
      category: 'training-program',
      eventType: 'programme-ready',
      sourceDomain: 'programmes',
      sourceEventId,
      title: 'Programme ready',
      body: 'Your programme is ready.',
      destination: 'programs',
      createdAt: now,
    },
    defaultNotificationPreferences(uid),
    Date.parse(now),
  )!;

describe('P45B remote notification domain', () => {
  it('merges read and dismissed timestamps monotonically using the earliest timestamp', () => {
    const base = record();
    const merged = mergeNotificationState(
      { ...base, readAt: '2026-09-06T10:02:00.000Z' },
      { ...base, dismissedAt: '2026-09-06T10:03:00.000Z' },
    );
    expect(merged.readAt).toBe('2026-09-06T10:02:00.000Z');
    expect(merged.dismissedAt).toBe('2026-09-06T10:03:00.000Z');
  });
  it('fails closed on deterministic ID semantic collision', () => {
    const base = record();
    expect(() => mergeNotificationState(base, { ...base, title: 'Changed' })).toThrow(
      'notification-id-collision',
    );
  });
  it('reconciles only the current UID and preserves remote read state against stale local state', () => {
    const base = record();
    expect(
      reconcileNotificationCentres(
        [base, record('athlete-b')],
        [{ ...base, readAt: '2026-09-06T10:01:00.000Z' }],
        'athlete-a',
        Date.parse(now),
      ),
    ).toEqual([{ ...base, readAt: '2026-09-06T10:01:00.000Z' }]);
  });
  it('chunks no more than 50 records and validates only generic transport payloads', () => {
    expect(
      chunkNotificationMirror(Array.from({ length: 101 }, (_, i) => record('athlete-a', `${i}`))),
    ).toHaveLength(3);
    expect(
      validTransportPayload({ kind: 'optiform-notification', notificationId: record().id }),
    ).toBe(true);
    expect(validTransportPayload({ kind: 'other', notificationId: record().id })).toBe(false);
  });
});
