import { describe, expect, it } from 'vitest';
import { createNotification, defaultNotificationPreferences } from './notifications';
import {
  buildNotificationPresentation,
  classifyNotificationDelivery,
  defaultNotificationDeliveryControls,
  isInsideQuietHours,
  localDateKey,
  nextDigestDelivery,
  nextQuietHoursEnd,
  timeInputToMinute,
  validateNotificationDeliveryControls,
} from './notificationDeliveryControls';

const uid = 'athlete-a';
const controls = (overrides = {}) => ({
  ...defaultNotificationDeliveryControls(uid, 'Africa/Johannesburg'),
  ...overrides,
});
const record = (
  sourceEventId: string,
  eventType: string,
  category: 'training-program' | 'challenge-community' | 'account-security',
  createdAt: string,
) =>
  createNotification(
    uid,
    {
      category,
      eventType,
      sourceDomain: 'synthetic-p79',
      sourceEventId,
      title: `Update ${sourceEventId}`,
      body: 'Open Optiform to review this update.',
      destination: category === 'challenge-community' ? 'challenges' : 'progress',
      createdAt,
    },
    defaultNotificationPreferences(uid),
    Date.parse(createdAt),
  )!;

describe('notification-delivery-controls-v1', () => {
  it('defaults to current instant behavior with quiet hours disabled', () => {
    expect(defaultNotificationDeliveryControls(uid, 'Africa/Johannesburg')).toEqual({
      schemaVersion: 1,
      contractVersion: 'notification-delivery-controls-v1',
      recipientUid: uid,
      timeZone: 'Africa/Johannesburg',
      quietHoursEnabled: false,
      quietStartMinute: 1320,
      quietEndMinute: 420,
      trainingProgramMode: 'instant',
      challengeCommunityMode: 'instant',
      digestHourLocal: 9,
    });
    expect(isInsideQuietHours(Date.parse('2026-09-08T21:00:00Z'), controls())).toBe(false);
  });

  it('strictly validates zones, bounds, modes and the enabled equal-time case', () => {
    expect(validateNotificationDeliveryControls(controls(), uid)).toBe(true);
    expect(validateNotificationDeliveryControls(controls({ timeZone: 'Mars/Olympus' }), uid)).toBe(
      false,
    );
    expect(validateNotificationDeliveryControls(controls({ digestHourLocal: 0 }), uid)).toBe(true);
    expect(validateNotificationDeliveryControls(controls({ digestHourLocal: 23 }), uid)).toBe(true);
    expect(validateNotificationDeliveryControls(controls({ digestHourLocal: -1 }), uid)).toBe(
      false,
    );
    expect(validateNotificationDeliveryControls(controls({ digestHourLocal: 24 }), uid)).toBe(
      false,
    );
    expect(
      validateNotificationDeliveryControls(controls({ trainingProgramMode: 'later' }), uid),
    ).toBe(false);
    expect(
      validateNotificationDeliveryControls(
        controls({ quietHoursEnabled: true, quietStartMinute: 60, quietEndMinute: 60 }),
        uid,
      ),
    ).toBe(false);
    expect(
      validateNotificationDeliveryControls(
        controls({ quietHoursEnabled: false, quietStartMinute: 60, quietEndMinute: 60 }),
        uid,
      ),
    ).toBe(true);
    expect(timeInputToMinute('23:59')).toBe(1439);
    expect(timeInputToMinute('24:00')).toBeNull();
  });

  it('uses inclusive start and exclusive end for same-day and overnight windows', () => {
    const sameDay = controls({
      quietHoursEnabled: true,
      quietStartMinute: 480,
      quietEndMinute: 1020,
    });
    expect(isInsideQuietHours(Date.parse('2026-09-08T06:00:00Z'), sameDay)).toBe(true);
    expect(isInsideQuietHours(Date.parse('2026-09-08T14:59:00Z'), sameDay)).toBe(true);
    expect(isInsideQuietHours(Date.parse('2026-09-08T15:00:00Z'), sameDay)).toBe(false);

    const overnight = controls({ quietHoursEnabled: true });
    expect(isInsideQuietHours(Date.parse('2026-09-08T20:00:00Z'), overnight)).toBe(true);
    expect(isInsideQuietHours(Date.parse('2026-09-09T04:59:00Z'), overnight)).toBe(true);
    expect(isInsideQuietHours(Date.parse('2026-09-09T05:00:00Z'), overnight)).toBe(false);
    expect(nextQuietHoursEnd(Date.parse('2026-09-08T23:00:00Z'), overnight)).toBe(
      Date.parse('2026-09-09T05:00:00Z'),
    );
  });

  it('resolves DST gaps and repeats from IANA wall-clock rules', () => {
    const spring = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 90,
      quietEndMinute: 210,
      digestHourLocal: 2,
    });
    expect(isInsideQuietHours(Date.parse('2026-03-08T06:45:00Z'), spring)).toBe(true);
    expect(nextQuietHoursEnd(Date.parse('2026-03-08T06:45:00Z'), spring)).toBe(
      Date.parse('2026-03-08T07:30:00Z'),
    );
    expect(nextDigestDelivery(Date.parse('2026-03-07T17:00:00Z'), spring)).toBe(
      Date.parse('2026-03-08T07:30:00Z'),
    );

    const fall = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 30,
      quietEndMinute: 150,
    });
    expect(isInsideQuietHours(Date.parse('2026-11-01T05:30:00Z'), fall)).toBe(true);
    expect(isInsideQuietHours(Date.parse('2026-11-01T06:30:00Z'), fall)).toBe(true);
    expect(nextQuietHoursEnd(Date.parse('2026-11-01T05:30:00Z'), fall)).toBe(
      Date.parse('2026-11-01T07:30:00Z'),
    );
    const repeatedEnd = controls({
      timeZone: 'America/New_York',
      quietHoursEnabled: true,
      quietStartMinute: 30,
      quietEndMinute: 90,
    });
    expect(nextQuietHoursEnd(Date.parse('2026-11-01T06:15:00Z'), repeatedEnd)).toBe(
      Date.parse('2026-11-01T06:30:00Z'),
    );
  });

  it('handles local digest rollovers across month and year boundaries', () => {
    const value = controls({ digestHourLocal: 9 });
    expect(nextDigestDelivery(Date.parse('2026-01-31T08:00:00Z'), value)).toBe(
      Date.parse('2026-02-01T07:00:00Z'),
    );
    expect(nextDigestDelivery(Date.parse('2026-12-31T08:00:00Z'), value)).toBe(
      Date.parse('2027-01-01T07:00:00Z'),
    );
    expect(localDateKey('2026-12-31T22:30:00Z', 'Africa/Johannesburg')).toBe('2027-01-01');
  });

  it('uses a closed event registry rather than category-only digest semantics', () => {
    expect(
      classifyNotificationDelivery({ category: 'account-security', eventType: 'anything' }),
    ).toBe('mandatory');
    expect(
      classifyNotificationDelivery({
        category: 'challenge-community',
        eventType: 'friend-challenge-ending-soon',
      }),
    ).toBe('time-sensitive');
    expect(
      classifyNotificationDelivery({
        category: 'challenge-community',
        eventType: 'friend-challenge-final-window',
      }),
    ).toBe('time-sensitive');
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
    ])
      expect(
        classifyNotificationDelivery({
          category: category as 'training-program' | 'challenge-community',
          eventType,
        }),
      ).toBe('digest-eligible');
    expect(
      classifyNotificationDelivery({
        category: 'training-program',
        eventType: 'friend-challenge-invite',
      }),
    ).toBe('suppressible-instant');
    expect(
      classifyNotificationDelivery({ category: 'training-program', eventType: 'future-event' }),
    ).toBe('suppressible-instant');
  });

  it('derives digest groups while retaining original items, state and stable ordering', () => {
    const first = record('one', 'achievement-unlocked', 'training-program', '2026-09-08T22:00:00Z');
    const second = {
      ...record('two', 'personal-season-finalized', 'training-program', '2026-09-08T22:30:00Z'),
      readAt: '2026-09-09T00:00:00Z',
    };
    const reminder = record(
      'three',
      'friend-challenge-final-window',
      'challenge-community',
      '2026-09-08T23:00:00Z',
    );
    const mandatory = {
      ...record('four', 'security-event', 'account-security', '2026-09-08T23:30:00Z'),
      dismissedAt: '2026-09-09T00:01:00Z',
    };
    const result = buildNotificationPresentation(
      [first, second, reminder, mandatory],
      controls({ trainingProgramMode: 'daily-digest', challengeCommunityMode: 'daily-digest' }),
    );
    expect(result.map((item) => item.kind)).toEqual(['notification', 'notification', 'digest']);
    const digest = result.find((item) => item.kind === 'digest');
    expect(digest?.localDate).toBe('2026-09-09');
    expect(digest?.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(digest?.items[0].readAt).toBe(second.readAt);
    expect(result.find((item) => item.key === mandatory.id)).toMatchObject({
      kind: 'notification',
      item: { dismissedAt: mandatory.dismissedAt },
    });
    expect(result.find((item) => item.key === reminder.id)?.kind).toBe('notification');
    expect(buildNotificationPresentation([first], controls())).toHaveLength(1);
  });
});
