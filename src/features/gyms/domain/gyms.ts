export const GYM_BUSINESS_CONTRACT = 'gym-business-v1' as const;
export const GYM_MEMBERSHIP_CONTRACT = 'gym-membership-v1' as const;
export const GYM_INVITE_CONTRACT = 'gym-invite-v1' as const;
export const GYM_ANNOUNCEMENT_CONTRACT = 'gym-announcement-v1' as const;
export const GYM_STATION_CONTRACT = 'gym-station-qr-v1' as const;
export const GYM_PAGE_SIZE = 20;
export const GYM_PAGE_SIZE_MAX = 50;
export const GYM_INVITE_DAYS = 30;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const OPAQUE_ID = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const HTML = /<[^>]*>/;
const hasControlCharacter = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);

export type GymBusinessControlV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_BUSINESS_CONTRACT;
  gymId: string;
  ownerUid: string;
  currentInviteCode: string;
  createdAt: string;
  updatedAt: string;
};
export type GymBusinessProfileV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_BUSINESS_CONTRACT;
  gymId: string;
  displayName: string;
  description: string;
  status: 'active' | 'paused';
  platformStatus: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
};
export type GymInviteV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_INVITE_CONTRACT;
  code: string;
  gymId: string;
  status: 'active' | 'revoked';
  createdAt: string;
  expiresAt: string;
};
export type GymMembershipV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_MEMBERSHIP_CONTRACT;
  gymId: string;
  memberUid: string;
  memberId: string;
  displayNameSnapshot: string;
  inviteCodeUsed: string;
  cycle: number;
  status: 'active' | 'left' | 'removed';
  joinedAt: string;
  updatedAt: string;
  endedAt?: string;
};
export type GymMemberDirectoryV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_MEMBERSHIP_CONTRACT;
  gymId: string;
  memberId: string;
  displayName: string;
  status: 'active' | 'left' | 'removed';
  joinedAt: string;
  updatedAt: string;
  endedAt?: string;
};
export type GymAnnouncementV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_ANNOUNCEMENT_CONTRACT;
  gymId: string;
  announcementId: string;
  title: string;
  body: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
};
export type GymStationV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_STATION_CONTRACT;
  stationId: string;
  gymId: string;
  label: string;
  exerciseId: string;
  status: 'active' | 'paused';
  createdAt: string;
  updatedAt: string;
};

export function createGymOpaqueId(
  randomValues: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (array) =>
    crypto.getRandomValues(array),
) {
  return [...randomValues(new Uint8Array(16))].map((byte) => CROCKFORD[byte & 31]).join('');
}
export const createGymId = createGymOpaqueId;
export const createMemberId = createGymOpaqueId;
export const createInviteCode = createGymOpaqueId;
export const createStationId = createGymOpaqueId;
export const validGymOpaqueId = (value: string) => OPAQUE_ID.test(value);
export function validGymText(value: string, minimum: number, maximum: number) {
  return (
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum &&
    !HTML.test(value) &&
    !hasControlCharacter(value)
  );
}
export const validDisplayName = (value: string) => validGymText(value, 2, 40);
export function validateGymProfile(profile: GymBusinessProfileV1) {
  return (
    validGymOpaqueId(profile.gymId) &&
    validGymText(profile.displayName, 2, 80) &&
    (profile.description === '' || validGymText(profile.description, 1, 750)) &&
    ['active', 'paused'].includes(profile.status) &&
    ['active', 'suspended'].includes(profile.platformStatus)
  );
}
export function createInvite(
  gymId: string,
  now = new Date(),
  code = createInviteCode(),
): GymInviteV1 {
  const expires = new Date(now);
  expires.setUTCDate(expires.getUTCDate() + GYM_INVITE_DAYS);
  return {
    schemaVersion: 1,
    contractVersion: GYM_INVITE_CONTRACT,
    gymId,
    code,
    status: 'active',
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}
export function inviteIsUsable(invite: GymInviteV1, now = new Date()) {
  return invite.status === 'active' && Date.parse(invite.expiresAt) > now.getTime();
}
export function directoryProjection(membership: GymMembershipV1): GymMemberDirectoryV1 {
  const projection: GymMemberDirectoryV1 = {
    schemaVersion: 1,
    contractVersion: GYM_MEMBERSHIP_CONTRACT,
    gymId: membership.gymId,
    memberId: membership.memberId,
    displayName: membership.displayNameSnapshot,
    status: membership.status,
    joinedAt: membership.joinedAt,
    updatedAt: membership.updatedAt,
  };
  if (membership.endedAt) projection.endedAt = membership.endedAt;
  return projection;
}
export function createMembership(
  gymId: string,
  uid: string,
  displayName: string,
  inviteCode: string,
  previous?: GymMembershipV1 | null,
  now = new Date().toISOString(),
  memberId = createMemberId(),
): GymMembershipV1 {
  if (!validGymOpaqueId(gymId) || !validGymOpaqueId(inviteCode) || !validDisplayName(displayName))
    throw new Error('Membership details are invalid.');
  return {
    schemaVersion: 1,
    contractVersion: GYM_MEMBERSHIP_CONTRACT,
    gymId,
    memberUid: uid,
    memberId,
    displayNameSnapshot: displayName,
    inviteCodeUsed: inviteCode,
    cycle: previous ? previous.cycle + 1 : 1,
    status: 'active',
    joinedAt: now,
    updatedAt: now,
  };
}
export function endMembership(
  membership: GymMembershipV1,
  status: 'left' | 'removed',
  now = new Date().toISOString(),
): GymMembershipV1 {
  if (membership.status !== 'active') throw new Error('Only an active membership may end.');
  return { ...membership, status, updatedAt: now, endedAt: now };
}
export function validateAnnouncement(value: Pick<GymAnnouncementV1, 'title' | 'body'>) {
  return validGymText(value.title, 1, 80) && validGymText(value.body, 1, 1500);
}
export function buildGymStationUrl(origin: string, stationId: string) {
  if (!validGymOpaqueId(stationId)) throw new Error('Station ID is invalid.');
  return `${origin.replace(/\/$/, '')}/#/gym/stations/${stationId}`;
}
export function publicStation(station: GymStationV1) {
  const { stationId, gymId, label, exerciseId, status, createdAt, updatedAt } = station;
  return {
    schemaVersion: 1 as const,
    contractVersion: GYM_STATION_CONTRACT,
    stationId,
    gymId,
    label,
    exerciseId,
    status,
    createdAt,
    updatedAt,
  };
}
