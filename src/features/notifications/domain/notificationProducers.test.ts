import { describe, expect, it } from 'vitest';
import {
  accountExportNotification,
  achievementNotification,
  challengeSettledNotification,
  personalSeasonNotification,
} from './notificationProducers';

describe('deterministic notification producers', () => {
  it('creates bounded training, season, challenge and account events', () => {
    expect(
      achievementNotification({
        achievementId: 'first-workout',
        title: 'First workout',
        achievedAt: '2026-09-05T00:00:00.000Z',
      }),
    ).toMatchObject({ category: 'training-program', destination: 'progress' });
    expect(
      personalSeasonNotification({ seasonId: 'season-1', completedAt: '2026-09-05T00:00:00.000Z' }),
    ).toMatchObject({ eventType: 'personal-season-finalized' });
    expect(
      challengeSettledNotification({
        challengeId: 'challenge-1',
        completedAt: '2026-09-05T00:00:00.000Z',
      }),
    ).toMatchObject({ category: 'challenge-community', destination: 'challenges' });
    expect(accountExportNotification('2026-09-05T00:00:00.000Z')).toMatchObject({
      category: 'account-security',
      destination: 'account-privacy',
    });
  });
  it('uses stable observation identities without copying source payloads', () => {
    const first = challengeSettledNotification({
      challengeId: 'challenge-1',
      completedAt: '2026-09-05T00:00:00.000Z',
    });
    const second = challengeSettledNotification({
      challengeId: 'challenge-1',
      completedAt: '2026-09-06T00:00:00.000Z',
    });
    expect(first.observationId).toBe(second.observationId);
    expect(JSON.stringify(first)).not.toMatch(/weight|reps|notes|proof/i);
  });
});
