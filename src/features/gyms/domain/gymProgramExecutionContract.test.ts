import { describe, expect, it } from 'vitest';
import {
  deriveGymProgramOccurrenceStatus,
  gymProgramOccurrenceDateLocal,
  gymProgramSessionKey,
} from './gymProgramExecutionContract';

describe('gym programme execution public-safe contract', () => {
  it('derives deterministic dates and keys', () => {
    expect(gymProgramSessionKey(2, 3)).toBe('w2-d3');
    expect(gymProgramOccurrenceDateLocal('2026-09-01', 2, 3)).toBe('2026-09-10');
    expect(() => gymProgramOccurrenceDateLocal('2026-02-30', 1, 1)).toThrow();
  });

  it('counts only the same enrollment and session V3 provenance', () => {
    expect(
      deriveGymProgramOccurrenceStatus({
        enrollmentId: 'gym-program-enrollment-a',
        sessionKey: 'w1-d1',
        scheduledDateLocal: '2026-09-01',
        todayLocal: '2026-09-02',
        records: [
          {
            schemaVersion: 3,
            programContext: {
              contractVersion: 'workout-program-provenance-v3',
              programSource: 'gym-program',
              enrollmentId: 'gym-program-enrollment-a',
              sessionKey: 'w1-d1',
            },
          },
        ],
      }),
    ).toBe('completed');
  });

  it('derives non-completed schedule states', () => {
    const base = { enrollmentId: 'a', sessionKey: 'w1-d1', records: [] };
    expect(
      deriveGymProgramOccurrenceStatus({
        ...base,
        scheduledDateLocal: '2026-09-02',
        todayLocal: '2026-09-02',
      }),
    ).toBe('today');
    expect(
      deriveGymProgramOccurrenceStatus({
        ...base,
        scheduledDateLocal: '2026-09-03',
        todayLocal: '2026-09-02',
      }),
    ).toBe('upcoming');
    expect(
      deriveGymProgramOccurrenceStatus({
        ...base,
        scheduledDateLocal: '2026-09-01',
        todayLocal: '2026-09-02',
      }),
    ).toBe('missed');
  });
});
