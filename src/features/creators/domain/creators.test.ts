import { describe, expect, it } from 'vitest';
import {
  createCreatorId,
  publicCreatorProfile,
  transitionCreatorMode,
  validCreatorId,
  validCreatorText,
  validateCreatorProfile,
  validateSocialLinks,
  validateSpecialties,
  type CreatorPublicProfileV1,
} from './creators';
const profile: CreatorPublicProfileV1 = {
  schemaVersion: 1,
  contractVersion: 'creator-profile-v1',
  creatorId: '0123456789ABCDEF',
  displayName: 'Strong Coach',
  bio: 'Plain training guidance.',
  specialties: ['strength'],
  socialLinks: [{ provider: 'website', url: 'https://example.com/profile' }],
  status: 'draft',
  platformStatus: 'active',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};
describe('P34 creator domain', () => {
  it('generates opaque Crockford creator IDs from cryptographic bytes', () => {
    const id = createCreatorId((bytes) => {
      bytes.fill(31);
      return bytes;
    });
    expect(id).toBe('ZZZZZZZZZZZZZZZZ');
    expect(validCreatorId(id)).toBe(true);
    expect(id).not.toContain('athlete');
  });
  it('rejects invalid creator IDs', () => expect(validCreatorId('athlete-user-1')).toBe(false));
  it('validates bounded plain display name and bio', () => {
    expect(validCreatorText('Creator', 2, 40)).toBe(true);
    expect(validCreatorText('<b>Name</b>', 2, 40)).toBe(false);
    expect(validateCreatorProfile(profile)).toBe(true);
    expect(validateCreatorProfile({ ...profile, bio: 'x'.repeat(751) })).toBe(false);
  });
  it('allows controlled unique specialties only', () => {
    expect(validateSpecialties(['strength', 'mobility'])).toBe(true);
    expect(validateSpecialties(['strength', 'strength'])).toBe(false);
    expect(validateSpecialties(['medical-treatment'])).toBe(false);
  });
  it('accepts bounded HTTPS social links and rejects unsafe URLs/duplicates', () => {
    expect(validateSocialLinks(profile.socialLinks)).toBe(true);
    expect(validateSocialLinks([{ provider: 'website', url: 'javascript:alert(1)' }])).toBe(false);
    expect(
      validateSocialLinks([{ provider: 'website', url: 'https://user:pass@example.com' }]),
    ).toBe(false);
    expect(validateSocialLinks([...profile.socialLinks, ...profile.socialLinks])).toBe(false);
  });
  it('pauses and resumes without changing identity', () => {
    const account = {
      schemaVersion: 1 as const,
      contractVersion: 'creator-mode-v1' as const,
      ownerUid: 'athlete-a',
      creatorId: profile.creatorId,
      status: 'active' as const,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
    expect(transitionCreatorMode(account, 'paused', '2026-09-06T00:00:00.000Z')).toMatchObject({
      creatorId: profile.creatorId,
      status: 'paused',
    });
  });
  it('projects no UID or private athlete/provider fields', () => {
    const value = publicCreatorProfile({
      ...profile,
      ...({ ownerUid: 'secret', email: 'private', optiformRoles: ['admin'] } as object),
    });
    expect(JSON.stringify(value)).not.toMatch(/ownerUid|email|optiformRoles/);
  });
});
