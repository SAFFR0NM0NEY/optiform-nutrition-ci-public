import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  INSTALLATION_CONTRACT,
  INSTALLATION_FRESHNESS_MS,
  MAX_REMOTE_NOTIFICATIONS,
  MAX_WEB_INSTALLATIONS,
  PUSH_DELIVERY_CONTRACT,
  REMOTE_INBOX_CONTRACT,
  REMOTE_PREFERENCES_CONTRACT,
  mergeState,
  registrationId,
  sameSemantics,
  sortAndPrune,
  validFid,
  validNotification,
  type NotificationRecord,
} from './contracts.js';

export type PushResult = { ok: boolean; invalid?: boolean; classification?: string };
export interface PushSender {
  send(
    fid: string,
    payload: { kind: 'optiform-notification'; notificationId: string },
  ): Promise<PushResult>;
}

type RemotePreferences = { trainingProgram: boolean; challengeCommunity: boolean };
const liveCategories = ['training-program', 'challenge-community', 'account-security'];
const mirrorCategories = ['training-program', 'challenge-community'];
const exactKeys = (value: unknown, keys: string[]) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value as object)
    .sort()
    .join('|') === [...keys].sort().join('|');
const requireUid = (uid: string | null) => {
  if (!uid) throw new Error('unauthenticated');
  return uid;
};

const inbox = (db: Firestore, uid: string) => db.collection(`notificationRemoteInbox/${uid}/items`);
const installations = (db: Firestore, uid: string) =>
  db.collection(`notificationInstallations/${uid}/items`);

export async function syncMyNotificationCentreService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!exactKeys(data, ['records'])) throw new Error('invalid-request');
  const records = (data as { records: unknown }).records;
  if (!Array.isArray(records) || records.length > 50) throw new Error('invalid-request');
  const now = Date.now();
  for (const candidate of records) {
    if (!validNotification(candidate, uid, now)) throw new Error('invalid-notification');
    const record = candidate as NotificationRecord;
    const ref = inbox(db, uid).doc(record.id);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        if (!mirrorCategories.includes(record.category))
          throw new Error('category-not-client-creatable');
        transaction.create(ref, {
          schemaVersion: 1,
          contractVersion: REMOTE_INBOX_CONTRACT,
          ownerUid: uid,
          notificationId: record.id,
          origin: 'client-mirror',
          notification: record,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }
      const existing = snapshot.data()?.notification as NotificationRecord;
      if (!validNotification(existing, uid, now) || !sameSemantics(existing, record))
        throw new Error('notification-id-collision');
      transaction.update(ref, {
        notification: mergeState(existing, record),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
  await pruneInbox(db, uid, now);
  return { synchronized: records.length };
}

export async function getMyRemoteNotificationStateService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!exactKeys(data, [])) throw new Error('invalid-request');
  await pruneInbox(db, uid);
  const [items, preference] = await Promise.all([
    inbox(db, uid).limit(MAX_REMOTE_NOTIFICATIONS).get(),
    db.doc(`notificationRemotePreferences/${uid}`).get(),
  ]);
  return {
    records: sortAndPrune(items.docs.map((doc) => doc.data().notification as NotificationRecord)),
    preferences: preference.exists
      ? {
          trainingProgram: preference.data()?.trainingProgram === true,
          challengeCommunity: preference.data()?.challengeCommunity === true,
        }
      : null,
    serverTime: new Date().toISOString(),
  };
}

export async function updateMyRemoteNotificationPreferencesService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!exactKeys(data, ['trainingProgram', 'challengeCommunity']))
    throw new Error('invalid-request');
  const value = data as RemotePreferences;
  if (typeof value.trainingProgram !== 'boolean' || typeof value.challengeCommunity !== 'boolean')
    throw new Error('invalid-request');
  const ref = db.doc(`notificationRemotePreferences/${uid}`);
  const snapshot = await ref.get();
  await ref.set({
    schemaVersion: 1,
    contractVersion: REMOTE_PREFERENCES_CONTRACT,
    ownerUid: uid,
    ...value,
    createdAt: snapshot.data()?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return value;
}

export async function registerNotificationInstallationService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!exactKeys(data, ['fid']) || !validFid((data as { fid?: unknown }).fid))
    throw new Error('invalid-request');
  const fid = (data as { fid: string }).fid;
  const id = registrationId(fid);
  const ownerRef = db.doc(`notificationInstallationOwners/${id}`);
  await db.runTransaction(async (transaction) => {
    const owner = await transaction.get(ownerRef);
    const previousUid = owner.data()?.ownerUid as string | undefined;
    const currentRef = installations(db, uid).doc(id);
    const current = await transaction.get(currentRef);
    if (previousUid && previousUid !== uid)
      transaction.delete(installations(db, previousUid).doc(id));
    transaction.set(currentRef, {
      schemaVersion: 1,
      contractVersion: INSTALLATION_CONTRACT,
      ownerUid: uid,
      registrationId: id,
      fid,
      platform: 'web',
      status: 'active',
      createdAt: current.data()?.createdAt ?? FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    });
    transaction.set(ownerRef, {
      registrationId: id,
      ownerUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await pruneInstallations(db, uid, id);
  return { registrationId: id };
}

export async function unregisterNotificationInstallationService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!exactKeys(data, ['fid']) || !validFid((data as { fid?: unknown }).fid))
    throw new Error('invalid-request');
  const id = registrationId((data as { fid: string }).fid);
  const ownerRef = db.doc(`notificationInstallationOwners/${id}`);
  await db.runTransaction(async (transaction) => {
    const owner = await transaction.get(ownerRef);
    if (owner.data()?.ownerUid !== uid) return;
    transaction.delete(ownerRef);
    transaction.delete(installations(db, uid).doc(id));
  });
  return { unregistered: true };
}

export async function deliverTrustedNotification(
  db: Firestore,
  uid: string,
  notification: NotificationRecord,
  sender: PushSender,
  now = Date.now(),
) {
  if (!validNotification(notification, uid, now) || !liveCategories.includes(notification.category))
    throw new Error('invalid-notification');
  const preferenceSnapshot = await db.doc(`notificationRemotePreferences/${uid}`).get();
  const preferences = preferenceSnapshot.data() as RemotePreferences | undefined;
  const allowed =
    notification.category === 'account-security' ||
    (notification.category === 'training-program' && preferences?.trainingProgram !== false) ||
    (notification.category === 'challenge-community' && preferences?.challengeCommunity !== false);
  if (!allowed) return { inboxCreated: false, attempted: 0, successful: 0, invalid: 0 };
  const ref = inbox(db, uid).doc(notification.id);
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const value = snapshot.data();
      if (!sameSemantics(value?.notification as NotificationRecord, notification))
        throw new Error('notification-id-collision');
      if (value?.pushAttemptedAt) return { created: false, shouldPush: false };
      transaction.update(ref, {
        pushAttemptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        pushDeliveryContract: PUSH_DELIVERY_CONTRACT,
      });
      return { created: false, shouldPush: true };
    }
    transaction.create(ref, {
      schemaVersion: 1,
      contractVersion: REMOTE_INBOX_CONTRACT,
      ownerUid: uid,
      notificationId: notification.id,
      origin: 'server',
      notification,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      pushAttemptedAt: FieldValue.serverTimestamp(),
      pushDeliveryContract: PUSH_DELIVERY_CONTRACT,
    });
    return { created: true, shouldPush: true };
  });
  await pruneInbox(db, uid, now);
  const survivedRetention = (await ref.get()).exists;
  if (!claim.shouldPush || !survivedRetention)
    return {
      inboxCreated: claim.created && survivedRetention,
      attempted: 0,
      successful: 0,
      invalid: 0,
    };
  const freshAfter = Timestamp.fromMillis(now - INSTALLATION_FRESHNESS_MS);
  const targets = (await installations(db, uid).limit(MAX_WEB_INSTALLATIONS).get()).docs.filter(
    (doc) =>
      doc.data().status === 'active' && doc.data().lastSeenAt?.toMillis() >= freshAfter.toMillis(),
  );
  let successful = 0;
  let invalid = 0;
  for (const target of targets) {
    try {
      const result = await sender.send(target.data().fid, {
        kind: 'optiform-notification',
        notificationId: notification.id,
      });
      if (result.ok) successful += 1;
      else if (result.invalid) {
        invalid += 1;
        await removeInstallation(db, uid, target.id);
      }
    } catch {
      /* Inbox is authoritative; transient push failures are bounded and non-fatal. */
    }
  }
  return { inboxCreated: claim.created, attempted: targets.length, successful, invalid };
}

async function pruneInbox(db: Firestore, uid: string, now = Date.now()) {
  const repairLimit = MAX_REMOTE_NOTIFICATIONS * 2 + 1;
  const snapshot = await inbox(db, uid).limit(repairLimit).get();
  if (snapshot.size >= repairLimit) throw new Error('notification-inbox-repair-bound-exceeded');
  const records = snapshot.docs.map((doc) => ({
    doc,
    notification: doc.data().notification as NotificationRecord,
  }));
  const keep = new Set(
    sortAndPrune(
      records.map((item) => item.notification),
      now,
    ).map((item) => item.id),
  );
  const batch = db.batch();
  let changed = false;
  for (const item of records)
    if (!keep.has(item.doc.id)) {
      batch.delete(item.doc.ref);
      changed = true;
    }
  if (changed) await batch.commit();
}

async function pruneInstallations(db: Firestore, uid: string, currentId: string) {
  const snapshot = await installations(db, uid)
    .limit(MAX_WEB_INSTALLATIONS + 2)
    .get();
  const ordered = snapshot.docs
    .filter((item) => item.id !== currentId)
    .sort(
      (a, b) =>
        (b.data().lastSeenAt?.toMillis() ?? 0) - (a.data().lastSeenAt?.toMillis() ?? 0) ||
        a.id.localeCompare(b.id),
    );
  for (const item of ordered.slice(MAX_WEB_INSTALLATIONS - 1))
    await removeInstallation(db, uid, item.id);
}
async function removeInstallation(db: Firestore, uid: string, id: string) {
  await db.runTransaction(async (transaction) => {
    const ownerRef = db.doc(`notificationInstallationOwners/${id}`);
    const owner = await transaction.get(ownerRef);
    transaction.delete(installations(db, uid).doc(id));
    if (owner.data()?.ownerUid === uid) transaction.delete(ownerRef);
  });
}
