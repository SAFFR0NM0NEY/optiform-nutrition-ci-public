export const CREATOR_MODE_CONTRACT = 'creator-mode-v1' as const;
export const CREATOR_PROFILE_CONTRACT = 'creator-profile-v1' as const;
export const CREATOR_STOREFRONT_CONTRACT = 'creator-storefront-v1' as const;
export const CREATOR_PUBLICATION_CONTRACT = 'creator-program-publication-v1' as const;
export const CREATOR_PAGE_SIZE = 20;
export const CREATOR_PAGE_SIZE_MAX = 50;
export const CREATOR_SPECIALTIES = [
  'strength',
  'hypertrophy',
  'general-fitness',
  'conditioning',
  'mobility',
  'beginner-training',
] as const;
export const CREATOR_SOCIAL_PROVIDERS = ['instagram', 'youtube', 'tiktok', 'website'] as const;
export type CreatorSpecialty = (typeof CREATOR_SPECIALTIES)[number];
export type CreatorSocialProvider = (typeof CREATOR_SOCIAL_PROVIDERS)[number];
export type CreatorSocialLink = { provider: CreatorSocialProvider; url: string };
export type CreatorAccountV1 = {
  schemaVersion: 1;
  contractVersion: typeof CREATOR_MODE_CONTRACT;
  ownerUid: string;
  creatorId: string;
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
};
export type CreatorPublicProfileV1 = {
  schemaVersion: 1;
  contractVersion: typeof CREATOR_PROFILE_CONTRACT;
  creatorId: string;
  displayName: string;
  bio: string;
  specialties: CreatorSpecialty[];
  socialLinks: CreatorSocialLink[];
  status: 'draft' | 'published' | 'paused';
  platformStatus: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
};

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CREATOR_ID = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const HTML = /<[^>]*>/;
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

export function createCreatorId(
  randomValues: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (array) =>
    crypto.getRandomValues(array),
) {
  const bytes = randomValues(new Uint8Array(16));
  return [...bytes].map((byte) => CROCKFORD[byte & 31]).join('');
}
export const validCreatorId = (value: string) => CREATOR_ID.test(value);
export function validCreatorText(value: string, minimum: number, maximum: number) {
  return (
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum &&
    !hasControlCharacter(value) &&
    !HTML.test(value)
  );
}
export function validateSpecialties(values: readonly string[]) {
  return (
    values.length <= 6 &&
    new Set(values).size === values.length &&
    values.every((value) => CREATOR_SPECIALTIES.includes(value as CreatorSpecialty))
  );
}
export function validateSocialLinks(values: readonly CreatorSocialLink[]) {
  if (values.length > 4 || new Set(values.map((item) => item.provider)).size !== values.length)
    return false;
  return values.every((item) => {
    if (!CREATOR_SOCIAL_PROVIDERS.includes(item.provider)) return false;
    try {
      const url = new URL(item.url);
      return url.protocol === 'https:' && !url.username && !url.password && item.url.length <= 300;
    } catch {
      return false;
    }
  });
}
export function validateCreatorProfile(profile: CreatorPublicProfileV1) {
  return (
    validCreatorId(profile.creatorId) &&
    validCreatorText(profile.displayName, 2, 40) &&
    (profile.bio === '' || validCreatorText(profile.bio, 1, 750)) &&
    validateSpecialties(profile.specialties) &&
    validateSocialLinks(profile.socialLinks) &&
    ['draft', 'published', 'paused'].includes(profile.status) &&
    ['active', 'suspended'].includes(profile.platformStatus) &&
    Number.isFinite(Date.parse(profile.createdAt)) &&
    Number.isFinite(Date.parse(profile.updatedAt))
  );
}
export function transitionCreatorMode(
  account: CreatorAccountV1,
  status: 'active' | 'paused',
  now: string,
): CreatorAccountV1 {
  return { ...account, status, updatedAt: now };
}
export function publicCreatorProfile(profile: CreatorPublicProfileV1) {
  const {
    creatorId,
    displayName,
    bio,
    specialties,
    socialLinks,
    status,
    platformStatus,
    createdAt,
    updatedAt,
  } = profile;
  return {
    schemaVersion: 1 as const,
    contractVersion: CREATOR_PROFILE_CONTRACT,
    creatorId,
    displayName,
    bio,
    specialties: [...specialties],
    socialLinks: socialLinks.map((item) => ({ ...item })),
    status,
    platformStatus,
    createdAt,
    updatedAt,
  };
}
