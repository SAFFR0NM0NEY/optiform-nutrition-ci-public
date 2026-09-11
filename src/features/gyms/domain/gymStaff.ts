import { createGymOpaqueId, validDisplayName, validGymOpaqueId } from './gyms';

export const GYM_STAFF_MEMBERSHIP_CONTRACT = 'gym-staff-membership-v1' as const;
export const GYM_STAFF_INVITE_CONTRACT = 'gym-staff-invite-v1' as const;
export const GYM_STAFF_CAPABILITIES_CONTRACT = 'gym-staff-capabilities-v1' as const;
export const GYM_STAFF_HISTORY_CONTRACT = 'gym-staff-access-history-v1' as const;
export const GYM_STAFF_INVITE_DAYS = 7;
export const GYM_STAFF_PAGE_SIZE = 20;
export const GYM_STAFF_PAGE_SIZE_MAX = 50;

export const GYM_STAFF_CAPABILITIES = [
  'gym-profile-edit',
  'gym-member-invite-manage',
  'gym-member-directory-read',
  'gym-announcements-manage',
  'gym-stations-manage',
] as const;
export const ASSISTANT_CAPABILITIES = [
  'gym-member-directory-read',
  'gym-announcements-manage',
  'gym-stations-manage',
] as const;
export type GymStaffCapability = (typeof GYM_STAFF_CAPABILITIES)[number];
export type GymStaffRole = 'manager' | 'assistant';
export type GymStaffStatus = 'active' | 'left' | 'revoked';

export type GymStaffInviteV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_STAFF_INVITE_CONTRACT;
  code: string;
  gymId: string;
  role: GymStaffRole;
  capabilities: GymStaffCapability[];
  status: 'active' | 'accepted' | 'revoked';
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
};
export type GymStaffMembershipV1 = {
  schemaVersion: 1;
  contractVersion: typeof GYM_STAFF_MEMBERSHIP_CONTRACT;
  historyContractVersion: typeof GYM_STAFF_HISTORY_CONTRACT;
  capabilityContractVersion: typeof GYM_STAFF_CAPABILITIES_CONTRACT;
  gymId: string;
  staffUid: string;
  staffId: string;
  displayNameSnapshot: string;
  role: GymStaffRole;
  capabilities: GymStaffCapability[];
  status: GymStaffStatus;
  cycle: number;
  revision: number;
  inviteCodeUsed: string;
  joinedAt: string;
  updatedAt: string;
  endedAt?: string;
};

export const createStaffId = createGymOpaqueId;
export const createStaffInviteCode = createGymOpaqueId;
export function validStaffCapabilities(role: GymStaffRole, capabilities: readonly string[]) {
  const allowed = role === 'manager' ? GYM_STAFF_CAPABILITIES : ASSISTANT_CAPABILITIES;
  return (
    capabilities.length > 0 &&
    new Set(capabilities).size === capabilities.length &&
    capabilities.every((capability) => (allowed as readonly string[]).includes(capability))
  );
}
export function createStaffInvite(
  gymId: string,
  role: GymStaffRole,
  capabilities: GymStaffCapability[],
  now = new Date(),
  code = createStaffInviteCode(),
): GymStaffInviteV1 {
  if (!validGymOpaqueId(gymId) || !validStaffCapabilities(role, capabilities))
    throw new Error('Staff invitation is invalid.');
  return {
    schemaVersion: 1,
    contractVersion: GYM_STAFF_INVITE_CONTRACT,
    code,
    gymId,
    role,
    capabilities: [...capabilities].sort(),
    status: 'active',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GYM_STAFF_INVITE_DAYS * 86400000).toISOString(),
  };
}
export function createStaffMembership(
  invite: GymStaffInviteV1,
  staffUid: string,
  displayName: string,
  previous?: GymStaffMembershipV1 | null,
  now = new Date().toISOString(),
  staffId = createStaffId(),
): GymStaffMembershipV1 {
  if (!validDisplayName(displayName) || !validStaffCapabilities(invite.role, invite.capabilities))
    throw new Error('Staff membership is invalid.');
  return {
    schemaVersion: 1,
    contractVersion: GYM_STAFF_MEMBERSHIP_CONTRACT,
    historyContractVersion: GYM_STAFF_HISTORY_CONTRACT,
    capabilityContractVersion: GYM_STAFF_CAPABILITIES_CONTRACT,
    gymId: invite.gymId,
    staffUid,
    staffId,
    displayNameSnapshot: displayName,
    role: invite.role,
    capabilities: [...invite.capabilities].sort(),
    status: 'active',
    cycle: previous ? previous.cycle + 1 : 1,
    revision: previous ? previous.revision + 1 : 1,
    inviteCodeUsed: invite.code,
    joinedAt: now,
    updatedAt: now,
  };
}
export function reviseStaffAccess(
  membership: GymStaffMembershipV1,
  role: GymStaffRole,
  capabilities: GymStaffCapability[],
  now = new Date().toISOString(),
) {
  if (membership.status !== 'active' || !validStaffCapabilities(role, capabilities))
    throw new Error('Staff access revision is invalid.');
  return {
    ...membership,
    role,
    capabilities: [...capabilities].sort(),
    revision: membership.revision + 1,
    updatedAt: now,
  };
}
export function endStaffAccess(
  membership: GymStaffMembershipV1,
  status: 'left' | 'revoked',
  now = new Date().toISOString(),
) {
  if (membership.status !== 'active') throw new Error('Only active staff access may end.');
  return { ...membership, status, revision: membership.revision + 1, updatedAt: now, endedAt: now };
}
export function buildStaffInviteUrl(origin: string, code: string) {
  if (!validGymOpaqueId(code)) throw new Error('Staff invite code is invalid.');
  return `${origin.replace(/\/$/, '')}/#/gym/staff/invite/${code}`;
}
