import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  friendChallengeNotification,
  friendChallengeTransition,
  validPendingFriendChallenge,
} from './friend-challenge-producer.js';

const challengeId = 'challenge-one';
const at = (hours: number) => Timestamp.fromMillis(1_800_000_000_000 + hours * 3_600_000);
const pending = () => ({
  schemaVersion: 1,
  contractVersion: 'friend-challenges-v1',
  challengeId,
  participantUids: ['athlete-a', 'athlete-b'],
  creatorUid: 'athlete-a',
  inviteeUid: 'athlete-b',
  creatorDisplayName: 'Athlete A',
  inviteeDisplayName: 'Athlete B',
  type: 'training-days',
  status: 'pending',
  createdAt: at(0),
  inviteExpiresAt: at(72),
  updatedAt: at(0),
});
const active = () => ({
  ...pending(),
  status: 'active',
  acceptedAt: at(2),
  startsAt: at(2),
  endsAt: at(170),
  finalizeAfter: at(218),
  updatedAt: at(2),
});
const resolved = (status: 'declined' | 'cancelled') => ({
  ...pending(),
  status,
  resolvedAt: at(2),
  updatedAt: at(2),
});

describe('P45D friend challenge producer contracts', () => {
  it('validates the exact pending shape and 72-hour contract', () => {
    expect(validPendingFriendChallenge(pending(), challengeId)).toBe(true);
    expect(
      validPendingFriendChallenge({ ...pending(), inviteExpiresAt: at(71) }, challengeId),
    ).toBe(false);
    expect(validPendingFriendChallenge({ ...pending(), extra: true }, challengeId)).toBe(false);
  });
  it('enforces challenge type and canonical muscle semantics', () => {
    expect(
      validPendingFriendChallenge({ ...pending(), targetMuscleId: 'quadriceps' }, challengeId),
    ).toBe(false);
    expect(
      validPendingFriendChallenge(
        { ...pending(), type: 'muscle-training-days', targetMuscleId: 'quadriceps' },
        challengeId,
      ),
    ).toBe(true);
    expect(
      validPendingFriendChallenge(
        { ...pending(), type: 'muscle-training-days', targetMuscleId: 'invented' },
        challengeId,
      ),
    ).toBe(false);
  });
  it('accepts only the exact active timing transition', () => {
    expect(friendChallengeTransition(pending(), active(), challengeId)).toBe('accepted');
    expect(
      friendChallengeTransition(pending(), { ...active(), endsAt: at(169) }, challengeId),
    ).toBeNull();
  });
  it('accepts exact declined and cancelled transitions', () => {
    expect(friendChallengeTransition(pending(), resolved('declined'), challengeId)).toBe(
      'declined',
    );
    expect(friendChallengeTransition(pending(), resolved('cancelled'), challengeId)).toBe(
      'cancelled',
    );
  });
  it('ignores expired, completed, unchanged and immutable mutations', () => {
    expect(
      friendChallengeTransition(pending(), resolved('expired' as never), challengeId),
    ).toBeNull();
    expect(
      friendChallengeTransition(
        active(),
        { ...active(), status: 'completed', completedAt: at(220), updatedAt: at(220) },
        challengeId,
      ),
    ).toBeNull();
    expect(friendChallengeTransition(pending(), pending(), challengeId)).toBeNull();
    expect(
      friendChallengeTransition(pending(), { ...active(), inviteeUid: 'other' }, challengeId),
    ).toBeNull();
  });
  it('builds deterministic generic records from event time', () => {
    const eventTime = new Date('2026-09-07T10:00:00.000Z');
    const invite = friendChallengeNotification(pending(), 'invite', eventTime);
    expect(invite).toMatchObject({
      recipientUid: 'athlete-b',
      category: 'challenge-community',
      eventType: 'friend-challenge-invite',
      sourceDomain: 'friend-challenges',
      sourceEventId: challengeId,
      title: 'Friend challenge invite',
      body: 'You have a new friend challenge invite.',
      destination: 'challenges',
      createdAt: eventTime.toISOString(),
    });
    expect(friendChallengeNotification(pending(), 'invite', eventTime)).toEqual(invite);
    expect(JSON.stringify(invite)).not.toContain('Athlete A');
    expect(friendChallengeNotification(active(), 'accepted', eventTime).recipientUid).toBe(
      'athlete-a',
    );
  });
});
