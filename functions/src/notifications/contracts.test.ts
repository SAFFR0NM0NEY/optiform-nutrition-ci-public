import { describe, expect, it } from 'vitest';
import {
  mergeState,
  notificationIdentity,
  registrationId,
  sortAndPrune,
  validFid,
  validNotification,
  type NotificationRecord,
} from './contracts.js';

const now = Date.parse('2026-09-06T10:00:00.000Z');
const record = (id = 'one'): NotificationRecord => ({
  schemaVersion: 1,
  contractVersion: 'notification-centre-v1',
  id: notificationIdentity('athlete-a', 'programmes', id, 'ready'),
  recipientUid: 'athlete-a',
  category: 'training-program',
  eventType: 'ready',
  sourceDomain: 'programmes',
  sourceEventId: id,
  title: 'Programme ready',
  body: 'Your programme is ready.',
  destination: 'programs',
  createdAt: new Date(now).toISOString(),
  readAt: null,
  dismissedAt: null,
});

describe('P45B notification transport contracts', () => {
  it('validates strict records and deterministic identities', () => {
    expect(validNotification(record(), 'athlete-a', now)).toBe(true);
    expect(validNotification({ ...record(), title: '<b>bad</b>' }, 'athlete-a', now)).toBe(false);
    expect(validNotification(record(), 'athlete-b', now)).toBe(false);
  });
  it('merges lifecycle state monotonically and rejects semantic collisions', () => {
    expect(
      mergeState(record(), { ...record(), readAt: new Date(now + 1000).toISOString() }).readAt,
    ).not.toBeNull();
    expect(() => mergeState(record(), { ...record(), body: 'Changed' })).toThrow(
      'notification-id-collision',
    );
  });
  it('uses SHA-256 registration IDs and bounded FID validation', () => {
    expect(registrationId('synthetic-fid')).toMatch(/^[a-f0-9]{64}$/);
    expect(registrationId('synthetic-fid')).not.toContain('synthetic-fid');
    expect(validFid('synthetic-fid')).toBe(true);
    expect(validFid('bad fid')).toBe(false);
  });
  it('prunes deterministically to 250 and 90 days', () => {
    const records = Array.from({ length: 260 }, (_, index) => record(String(index)));
    records.push({ ...record('old'), createdAt: '2025-01-01T00:00:00.000Z' });
    expect(sortAndPrune(records, now)).toHaveLength(250);
  });
});
