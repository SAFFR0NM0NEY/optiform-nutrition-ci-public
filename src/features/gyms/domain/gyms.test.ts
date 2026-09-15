import { describe, expect, it } from 'vitest';
import {
  buildGymStationUrl,
  createGymId,
  createInvite,
  createMembership,
  directoryProjection,
  endMembership,
  inviteIsUsable,
  publicStation,
  validateAnnouncement,
  validateGymProfile,
} from './gyms';

const random = (value: number) => (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(value);
describe('P38A gym domain', () => {
  it('creates opaque IDs without source identity', () => {
    expect(createGymId(random(1))).toBe('1111111111111111');
    expect(createGymId(random(255))).toBe('ZZZZZZZZZZZZZZZZ');
  });
  it('validates bounded plain-text profiles and announcements', () => {
    expect(
      validateGymProfile({
        schemaVersion: 1,
        contractVersion: 'gym-business-v1',
        gymId: '1111111111111111',
        displayName: 'Harbour Strength',
        description: 'A private training community.',
        status: 'active',
        platformStatus: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(validateAnnouncement({ title: '<b>Unsafe</b>', body: 'Body' })).toBe(false);
  });
  it('expires invitations after 30 days', () => {
    const invite = createInvite(
      '1111111111111111',
      new Date('2026-01-01T00:00:00Z'),
      '2222222222222222',
    );
    expect(invite.expiresAt).toBe('2026-01-31T00:00:00.000Z');
    expect(inviteIsUsable(invite, new Date('2026-01-30T23:59:59Z'))).toBe(true);
    expect(inviteIsUsable(invite, new Date('2026-01-31T00:00:00Z'))).toBe(false);
  });
  it('creates new member identity and cycle on rejoin', () => {
    const first = createMembership(
      '1111111111111111',
      'uid-a',
      'Jean',
      '2222222222222222',
      null,
      '2026-01-01T00:00:00Z',
      '3333333333333333',
    );
    const left = endMembership(first, 'left', '2026-01-02T00:00:00Z');
    const next = createMembership(
      first.gymId,
      first.memberUid,
      'Jean',
      first.inviteCodeUsed,
      left,
      '2026-02-01T00:00:00Z',
      '4444444444444444',
    );
    expect(next).toMatchObject({ cycle: 2, memberId: '4444444444444444', status: 'active' });
    expect(directoryProjection(left)).not.toHaveProperty('memberUid');
  });
  it('builds a local hash route and strips private values from stations', () => {
    expect(buildGymStationUrl('https://optiform.example/', '5555555555555555')).toBe(
      'https://optiform.example/#/gym/stations/5555555555555555',
    );
    const projected = publicStation({
      schemaVersion: 1,
      contractVersion: 'gym-station-qr-v1',
      stationId: '5555555555555555',
      gymId: '1111111111111111',
      label: 'Rack 1',
      exerciseId: 'back-squat',
      status: 'active',
      createdAt: 'x',
      updatedAt: 'x',
      ...({ ownerUid: 'secret' } as object),
    });
    expect(JSON.stringify(projected)).not.toContain('ownerUid');
  });
});
