import type { NotificationEvent } from './notifications';

export type ObservableNotificationEvent = NotificationEvent & { observationId: string };

export function achievementNotification(input: {
  achievementId: string;
  title: string;
  achievedAt: string;
}): ObservableNotificationEvent {
  return {
    observationId: `achievement:${input.achievementId}`,
    category: 'training-program',
    eventType: 'achievement-unlocked',
    sourceDomain: 'motivation',
    sourceEventId: input.achievementId,
    title: 'Achievement unlocked',
    body: input.title.slice(0, 150),
    destination: 'progress',
    createdAt: input.achievedAt,
  };
}

export function personalSeasonNotification(input: {
  seasonId: string;
  completedAt: string;
}): ObservableNotificationEvent {
  return {
    observationId: `personal-season:${input.seasonId}:completed`,
    category: 'training-program',
    eventType: 'personal-season-finalized',
    sourceDomain: 'personal-seasons',
    sourceEventId: input.seasonId,
    title: 'Personal season complete',
    body: 'Your finalized personal season result is ready to review.',
    destination: 'progress',
    createdAt: input.completedAt,
  };
}

export function challengeSettledNotification(input: {
  challengeId: string;
  completedAt: string;
}): ObservableNotificationEvent {
  return {
    observationId: `challenge:${input.challengeId}:settled`,
    category: 'challenge-community',
    eventType: 'challenge-settled',
    sourceDomain: 'friend-challenges',
    sourceEventId: input.challengeId,
    title: 'Challenge result ready',
    body: 'A completed challenge is ready to review.',
    destination: 'challenges',
    createdAt: input.completedAt,
  };
}

export function accountExportNotification(createdAt: string): NotificationEvent {
  return {
    category: 'account-security',
    eventType: 'account-export-generated',
    sourceDomain: 'account-export',
    sourceEventId: createdAt,
    title: 'Account export generated',
    body: 'Your private account-data export was generated on this device.',
    destination: 'account-privacy',
    createdAt,
  };
}
