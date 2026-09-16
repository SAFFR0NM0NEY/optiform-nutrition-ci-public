import { describe, expect, it } from 'vitest';
import {
  classifyDelivery,
  createDeliveryControls,
  decideDelivery,
  deliveryQueueIdentity,
  isQuiet,
  nextDigestAt,
  nextQuietEnd,
  parseRemoteDeliveryControls,
  validDeliveryControlsInput,
  type DeliveryControlsInput,
} from './delivery-controls.js';
import { notificationIdentity, type NotificationRecord } from './contracts.js';

const uid = 'athlete-a';
const input = (overrides: Partial<DeliveryControlsInput> = {}): DeliveryControlsInput => ({
  timeZone: 'Africa/Johannesburg',
  quietHoursEnabled: false,
  quietStartMinute: 1320,
  quietEndMinute: 420,
  trainingProgramMode: 'instant',
  challengeCommunityMode: 'instant',
  digestHourLocal: 9,
  ...overrides,
});
const controls = (overrides: Partial<DeliveryControlsInput> = {}) =>
  createDeliveryControls(uid, input(overrides));
const notification = (
  eventType: string,
  category: NotificationRecord['category'] = 'challenge-community',
): NotificationRecord => ({
  schemaVersion: 1,
  contractVersion: 'notification-centre-v1',
  id: notificationIdentity(uid, 'synthetic-p79', eventType, eventType),
  recipientUid: uid,
  category,
  eventType,
  sourceDomain: 'synthetic-p79',
  sourceEventId: eventType,
  title: 'Notification update',
  body: 'Open Optiform to review this update.',
  destination: 'challenges',
  createdAt: '2026-09-10T00:00:00.000Z',
  readAt: null,
  dismissedAt: null,
});

describe('P79 delivery controls and delivery policy', () => {
  it('validates only the exact remote payload and returns a separate client contract', () => {
    expect(validDeliveryControlsInput(input())).toBe(true);
    expect(validDeliveryControlsInput({ ...input(), ownerUid: uid })).toBe(false);
    expect(validDeliveryControlsInput(input({ timeZone: 'invalid/zone' }))).toBe(false);
    expect(
      validDeliveryControlsInput(input({ quietHoursEnabled: true, quietEndMinute: 1320 })),
    ).toBe(false);
    expect(validDeliveryControlsInput(input({ digestHourLocal: 24 }))).toBe(false);
    expect(
      validDeliveryControlsInput(input({ challengeCommunityMode: 'weekly' as 'instant' })),
    ).toBe(false);
    expect(
      parseRemoteDeliveryControls(
        {
          schemaVersion: 1,
          contractVersion: 'notification-remote-delivery-controls-v1',
          ownerUid: uid,
          ...input(),
          createdAt: { toMillis: () => 1 },
          updatedAt: { toMillis: () => 2 },
        },
        uid,
      ),
    ).toEqual(controls());
  });

  it('classifies mandatory, deadline, enumerated digest and unknown optional events', () => {
    expect(classifyDelivery(notification('anything', 'account-security'))).toBe('mandatory');
    expect(classifyDelivery(notification('friend-challenge-ending-soon'))).toBe('time-sensitive');
    expect(classifyDelivery(notification('friend-challenge-final-window'))).toBe('time-sensitive');
    for (const [category, eventType] of [
      ['training-program', 'achievement-unlocked'],
      ['training-program', 'personal-season-finalized'],
      ['challenge-community', 'challenge-settled'],
      ['training-program', 'gym-program-assigned'],
      ['training-program', 'gym-program-assignment-revoked'],
      ['challenge-community', 'friend-challenge-invite'],
      ['challenge-community', 'friend-challenge-accepted'],
      ['challenge-community', 'friend-challenge-declined'],
      ['challenge-community', 'friend-challenge-cancelled'],
      ['challenge-community', 'friend-challenge-overtaken'],
      ['challenge-community', 'creator-challenge-member-joined'],
      ['challenge-community', 'creator-challenge-member-withdrawn'],
    ] as const)
      expect(classifyDelivery(notification(eventType, category))).toBe('digest-eligible');
    expect(classifyDelivery(notification('friend-challenge-overtaken', 'training-program'))).toBe(
      'suppressible-instant',
    );
    expect(classifyDelivery(notification('future-optional'))).toBe('suppressible-instant');
  });

  it('uses exact quiet boundaries and delays optional but never mandatory delivery', () => {
    const value = controls({ quietHoursEnabled: true });
    const start = Date.parse('2026-09-10T20:00:00Z');
    expect(isQuiet(start, value)).toBe(true);
    expect(nextQuietEnd(start, value)).toBe(Date.parse('2026-09-11T05:00:00Z'));
    expect(isQuiet(Date.parse('2026-09-11T05:00:00Z'), value)).toBe(false);
    expect(decideDelivery(notification('future-optional'), value, start)).toMatchObject({
      kind: 'queue',
      deliveryMode: 'instant',
      deliveryAt: Date.parse('2026-09-11T05:00:00Z'),
    });
    expect(decideDelivery(notification('security', 'account-security'), value, start).kind).toBe(
      'immediate',
    );
  });

  it('queues explicit digest events and drops stale P68 reminders', () => {
    const value = controls({
      quietHoursEnabled: true,
      challengeCommunityMode: 'daily-digest',
    });
    const daytime = Date.parse('2026-09-10T08:00:00Z');
    expect(decideDelivery(notification('friend-challenge-ending-soon'), value, daytime).kind).toBe(
      'immediate',
    );
    expect(decideDelivery(notification('friend-challenge-final-window'), value, daytime).kind).toBe(
      'immediate',
    );
    expect(
      decideDelivery(notification('friend-challenge-overtaken'), value, daytime),
    ).toMatchObject({
      kind: 'queue',
      deliveryMode: 'daily-digest',
      deliveryAt: Date.parse('2026-09-11T07:00:00Z'),
    });
    const quiet = Date.parse('2026-09-10T20:30:00Z');
    expect(
      decideDelivery(
        notification('friend-challenge-ending-soon'),
        value,
        quiet,
        Date.parse('2026-09-11T04:30:00Z'),
      ),
    ).toMatchObject({ kind: 'none', reason: 'expired' });
    expect(
      decideDelivery(
        notification('friend-challenge-final-window'),
        value,
        quiet,
        Date.parse('2026-09-11T06:00:00Z'),
      ),
    ).toMatchObject({ kind: 'queue', deliveryAt: Date.parse('2026-09-11T05:00:00Z') });
    const quietDigestHour = controls({
      quietHoursEnabled: true,
      trainingProgramMode: 'daily-digest',
      digestHourLocal: 6,
    });
    expect(
      decideDelivery(
        notification('gym-program-assigned', 'training-program'),
        quietDigestHour,
        Date.parse('2026-09-10T02:00:00Z'),
      ),
    ).toMatchObject({ kind: 'queue', deliveryAt: Date.parse('2026-09-10T05:00:00Z') });
  });

  it('resolves DST digest and quiet endpoints without fixed offsets', () => {
    const spring = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 90,
      quietEndMinute: 210,
      digestHourLocal: 2,
    });
    expect(nextQuietEnd(Date.parse('2026-03-08T06:45:00Z'), spring)).toBe(
      Date.parse('2026-03-08T07:30:00Z'),
    );
    expect(nextDigestAt(Date.parse('2026-03-07T17:00:00Z'), spring)).toBe(
      Date.parse('2026-03-08T07:30:00Z'),
    );
    const fall = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 30,
      quietEndMinute: 150,
    });
    expect(nextQuietEnd(Date.parse('2026-11-01T05:30:00Z'), fall)).toBe(
      Date.parse('2026-11-01T07:30:00Z'),
    );
    const repeatedEnd = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 30,
      quietEndMinute: 90,
    });
    expect(nextQuietEnd(Date.parse('2026-11-01T06:15:00Z'), repeatedEnd)).toBe(
      Date.parse('2026-11-01T06:30:00Z'),
    );
  });

  it('uses a deterministic UID-scoped SHA-256 queue identity', () => {
    expect(deliveryQueueIdentity(uid, 'notification-one')).toMatch(/^[a-f0-9]{64}$/);
    expect(deliveryQueueIdentity(uid, 'notification-one')).toBe(
      deliveryQueueIdentity(uid, 'notification-one'),
    );
    expect(deliveryQueueIdentity('athlete-b', 'notification-one')).not.toBe(
      deliveryQueueIdentity(uid, 'notification-one'),
    );
  });
});
