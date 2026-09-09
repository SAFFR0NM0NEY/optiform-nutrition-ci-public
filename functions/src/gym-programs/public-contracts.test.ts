import { describe, expect, it } from 'vitest';
import {
  GYM_PROGRAM_ASSIGNMENT_CONTRACT,
  GYM_PROGRAM_DELIVERY_CONTRACT,
  GYM_PROGRAM_LIBRARY_CONTRACT,
  GYM_PROGRAM_PUBLICATION_CONTRACT,
  gymAssignmentIndexId,
  gymDeliveryHash,
} from './contracts.js';
describe('public-safe P38D contracts', () => {
  it('keeps the four frozen contract names', () =>
    expect([
      GYM_PROGRAM_PUBLICATION_CONTRACT,
      GYM_PROGRAM_DELIVERY_CONTRACT,
      GYM_PROGRAM_ASSIGNMENT_CONTRACT,
      GYM_PROGRAM_LIBRARY_CONTRACT,
    ]).toEqual([
      'gym-program-publication-v1',
      'gym-program-delivery-v1',
      'gym-program-assignment-v1',
      'gym-program-library-v1',
    ]));
  it('derives deterministic namespaced assignment identities', () => {
    const id = gymAssignmentIndexId('program-a', 'member-a');
    expect(id).toBe(gymAssignmentIndexId('program-a', 'member-a'));
    expect(id).not.toBe(gymAssignmentIndexId('program-a', 'member-b'));
  });
  it('hashes equivalent canonical content deterministically', () =>
    expect(gymDeliveryHash({ days: [{ dayId: 'day-1' }], title: 'Plan' })).toBe(
      gymDeliveryHash({ title: 'Plan', days: [{ dayId: 'day-1' }] }),
    ));
});
