import { describe, expect, it } from 'vitest';
import {
  buildLeaderboard,
  chooseDaySources,
  dayIndexFor,
  evidenceId,
  participantLookupId,
} from './contracts.js';

describe('creator membership challenge contracts', () => {
  it('uses opaque deterministic private lookups and safe evidence ids', () => {
    expect(participantLookupId('challenge-a', 'uid-a')).toHaveLength(64);
    expect(participantLookupId('challenge-a', 'uid-a')).not.toContain('uid-a');
    expect(
      evidenceId('creator-challenge-participant-00000000-0000-4000-8000-000000000001', 6),
    ).toMatch(/_6$/);
  });
  it('uses seven exact elapsed buckets', () => {
    expect(dayIndexFor(1000, 1000)).toBe(0);
    expect(dayIndexFor(1000, 1000 + 7 * 86400000)).toBeNull();
  });
  it('selects earliest then lowest workout id', () => {
    const result = chooseDaySources(0, [
      { workoutId: 'b', completedAtMs: 10 },
      { workoutId: 'a', completedAtMs: 10 },
    ]);
    expect(result[0].source.workoutId).toBe('a');
  });
  it('caps at four and preserves sporting ties', () => {
    const rows = buildLeaderboard([
      { participantId: 'b', displayName: 'Beta', status: 'active', dayIndexes: [0, 1, 2, 3, 4] },
      { participantId: 'a', displayName: 'Alpha', status: 'active', dayIndexes: [0, 1, 2, 3] },
      { participantId: 'c', displayName: 'Charlie', status: 'active', dayIndexes: [0, 1, 2] },
    ]);
    expect(rows.map(({ score, rank }) => ({ score, rank }))).toEqual([
      { score: 4, rank: 1 },
      { score: 4, rank: 1 },
      { score: 3, rank: 3 },
    ]);
  });
});
