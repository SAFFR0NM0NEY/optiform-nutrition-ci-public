import { describe, expect, it } from 'vitest';
import {
  createStaffInvite,
  createStaffMembership,
  endStaffAccess,
  reviseStaffAccess,
  validStaffCapabilities,
} from './gymStaff';

describe('P41A gym staff domain', () => {
  it('enforces manager and assistant capability ceilings', () => {
    expect(validStaffCapabilities('manager', ['gym-profile-edit'])).toBe(true);
    expect(validStaffCapabilities('assistant', ['gym-stations-manage'])).toBe(true);
    expect(validStaffCapabilities('assistant', ['gym-profile-edit'])).toBe(false);
    expect(validStaffCapabilities('manager', ['all'])).toBe(false);
  });
  it('creates a seven-day one-time invitation model', () => {
    const invite = createStaffInvite(
      '1111111111111111',
      'manager',
      ['gym-profile-edit'],
      new Date('2026-01-01T00:00:00Z'),
      '2222222222222222',
    );
    expect(invite.expiresAt).toBe('2026-01-08T00:00:00.000Z');
  });
  it('creates and rejoins with fresh identity and monotonic audit revisions', () => {
    const invite = createStaffInvite(
      '1111111111111111',
      'assistant',
      ['gym-stations-manage'],
      new Date(),
      '2222222222222222',
    );
    const first = createStaffMembership(invite, 'uid-a', 'Alex', null, 'a', '3333333333333333');
    const left = endStaffAccess(first, 'left', 'b');
    const second = createStaffMembership(
      { ...invite, code: '4444444444444444' },
      'uid-a',
      'Alex',
      left,
      'c',
      '5555555555555555',
    );
    expect(second).toMatchObject({
      cycle: 2,
      revision: 3,
      staffId: '5555555555555555',
      status: 'active',
    });
  });
  it('increments role/capability revision without changing identity', () => {
    const invite = createStaffInvite(
      '1111111111111111',
      'manager',
      ['gym-profile-edit'],
      new Date(),
      '2222222222222222',
    );
    const staff = createStaffMembership(invite, 'uid-a', 'Alex', null, 'a', '3333333333333333');
    expect(reviseStaffAccess(staff, 'assistant', ['gym-stations-manage'], 'b')).toMatchObject({
      revision: 2,
      staffId: staff.staffId,
      role: 'assistant',
    });
  });
});
