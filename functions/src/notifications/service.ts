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
import {
  DELIVERY_QUEUE_CONTRACT,
  MAX_DELIVERY_QUEUE_PER_UID,
  MAX_DELIVERY_SWEEP,
  classifyDelivery,
  createDeliveryControls,
  decideDelivery,
  deliveryQueueIdentity,
  modeForNotification,
  nextDigestAt,
  nextQuietEnd,
  parseRemoteDeliveryControls,
  validDeliveryControlsInput,
  type DeliveryClass,
  type DeliveryControls,
  type DeliveryControlsInput,
  type DeliveryMode,
} from './delivery-controls.js';

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
const deliveryControls = (db: Firestore, uid: string) =>
  db.doc(`notificationDeliveryControls/${uid}`);
const deliveryQueue = (db: Firestore) => db.collection('notificationDeliveryQueue');

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
  const [items, preference, controlsSnapshot] = await Promise.all([
    inbox(db, uid).limit(MAX_REMOTE_NOTIFICATIONS).get(),
    db.doc(`notificationRemotePreferences/${uid}`).get(),
    deliveryControls(db, uid).get(),
  ]);
  const controls = controlsSnapshot.exists
    ? parseRemoteDeliveryControls(controlsSnapshot.data(), uid)
    : null;
  if (controlsSnapshot.exists && !controls) throw new Error('invalid-delivery-controls-state');
  return {
    records: sortAndPrune(items.docs.map((doc) => doc.data().notification as NotificationRecord)),
    preferences: preference.exists
      ? {
          trainingProgram: preference.data()?.trainingProgram === true,
          challengeCommunity: preference.data()?.challengeCommunity === true,
        }
      : null,
    deliveryControls: controls,
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

export async function updateMyNotificationDeliveryControlsService(
  db: Firestore,
  authUid: string | null,
  data: unknown,
) {
  const uid = requireUid(authUid);
  if (!validDeliveryControlsInput(data)) throw new Error('invalid-request');
  const input = data as DeliveryControlsInput;
  const ref = deliveryControls(db, uid);
  const snapshot = await ref.get();
  await ref.set({
    schemaVersion: 1,
    contractVersion: 'notification-remote-delivery-controls-v1',
    ownerUid: uid,
    ...input,
    createdAt: snapshot.data()?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const controls = createDeliveryControls(uid, input);
  await recomputePendingDeliveryQueue(db, uid, controls);
  return controls;
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
  options: { notAfter?: Date | number } = {},
) {
  if (!validNotification(notification, uid, now) || !liveCategories.includes(notification.category))
    throw new Error('invalid-notification');
  const preferenceSnapshot = await db.doc(`notificationRemotePreferences/${uid}`).get();
  const preferences = preferenceSnapshot.data() as RemotePreferences | undefined;
  const allowed = preferenceAllowsNotification(notification, preferences);
  if (!allowed) return { inboxCreated: false, attempted: 0, successful: 0, invalid: 0 };
  const ref = inbox(db, uid).doc(notification.id);
  const inboxResult = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const value = snapshot.data();
      if (!sameSemantics(value?.notification as NotificationRecord, notification))
        throw new Error('notification-id-collision');
      return { created: false };
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
    });
    return { created: true };
  });
  await pruneInbox(db, uid, now);
  const retainedSnapshot = await ref.get();
  const survivedRetention = retainedSnapshot.exists;
  if (!survivedRetention)
    return {
      inboxCreated: false,
      attempted: 0,
      successful: 0,
      invalid: 0,
    };
  const notAfter =
    options.notAfter instanceof Date
      ? options.notAfter.getTime()
      : typeof options.notAfter === 'number'
        ? options.notAfter
        : undefined;
  const deliveryClass = classifyDelivery(notification);
  const controlsState = await readDeliveryControlsState(db, uid);
  if (deliveryClass !== 'mandatory' && controlsState.kind === 'invalid')
    return {
      inboxCreated: inboxResult.created,
      attempted: 0,
      successful: 0,
      invalid: 0,
      delivery: 'suppressed-invalid-controls' as const,
    };
  if (retainedSnapshot.data()?.pushAttemptedAt)
    return {
      inboxCreated: inboxResult.created,
      attempted: 0,
      successful: 0,
      invalid: 0,
      delivery: 'already-attempted' as const,
    };
  const decision =
    controlsState.kind === 'valid'
      ? decideDelivery(notification, controlsState.controls, now, notAfter)
      : notAfter !== undefined && now >= notAfter
        ? ({ kind: 'none', deliveryClass, reason: 'expired' } as const)
        : ({ kind: 'immediate', deliveryClass } as const);
  if (decision.kind === 'none') {
    await deliveryQueue(db)
      .doc(deliveryQueueIdentity(uid, notification.id))
      .delete()
      .catch(() => undefined);
    return {
      inboxCreated: inboxResult.created,
      attempted: 0,
      successful: 0,
      invalid: 0,
      delivery: 'expired' as const,
    };
  }
  if (decision.kind === 'queue') {
    const queued = await queueNotificationDelivery(
      db,
      uid,
      notification,
      decision.deliveryClass,
      decision.deliveryMode,
      decision.deliveryAt,
      notAfter,
      now,
    );
    return {
      inboxCreated: inboxResult.created,
      attempted: 0,
      successful: 0,
      invalid: 0,
      delivery: queued ? ('queued' as const) : ('queue-cap-reached' as const),
    };
  }
  const claimed = await claimImmediatePush(db, ref, uid, notification.id);
  if (!claimed)
    return {
      inboxCreated: inboxResult.created,
      attempted: 0,
      successful: 0,
      invalid: 0,
      delivery: 'already-attempted' as const,
    };
  const sent = await sendPushToInstallations(db, uid, notification.id, sender, now);
  return { inboxCreated: inboxResult.created, ...sent, delivery: 'immediate' as const };
}

type QueueRecord = {
  schemaVersion: 1;
  contractVersion: typeof DELIVERY_QUEUE_CONTRACT;
  queueId: string;
  ownerUid: string;
  notificationId: string;
  category: NotificationRecord['category'];
  deliveryClass: DeliveryClass;
  deliveryMode: DeliveryMode;
  deliveryAt: Timestamp;
  queuedAt: Timestamp;
  notAfter?: Timestamp;
  attemptedAt?: Timestamp;
};

function preferenceAllowsNotification(
  notification: Pick<NotificationRecord, 'category'>,
  preferences?: RemotePreferences,
) {
  return (
    notification.category === 'account-security' ||
    (notification.category === 'training-program' && preferences?.trainingProgram !== false) ||
    (notification.category === 'challenge-community' && preferences?.challengeCommunity !== false)
  );
}

async function readDeliveryControlsState(db: Firestore, uid: string) {
  const snapshot = await deliveryControls(db, uid).get();
  if (!snapshot.exists) return { kind: 'missing' as const };
  const controls = parseRemoteDeliveryControls(snapshot.data(), uid);
  return controls ? { kind: 'valid' as const, controls } : { kind: 'invalid' as const };
}

async function claimImmediatePush(
  db: Firestore,
  ref: FirebaseFirestore.DocumentReference,
  uid: string,
  notificationId: string,
) {
  const queueRef = deliveryQueue(db).doc(deliveryQueueIdentity(uid, notificationId));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.pushAttemptedAt) return false;
    transaction.update(ref, {
      pushAttemptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      pushDeliveryContract: PUSH_DELIVERY_CONTRACT,
    });
    transaction.delete(queueRef);
    return true;
  });
}

async function sendPushToInstallations(
  db: Firestore,
  uid: string,
  notificationId: string,
  sender: PushSender,
  now: number,
) {
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
        notificationId,
      });
      if (result.ok) successful += 1;
      else if (result.invalid) {
        invalid += 1;
        await removeInstallation(db, uid, target.id);
      }
    } catch {
      /* The inbox is authoritative; a claimed transient failure is intentionally not retried. */
    }
  }
  return { attempted: targets.length, successful, invalid };
}

function validQueueRecord(value: unknown, id: string): value is QueueRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const optionalTimestamp = (candidate: unknown) =>
    candidate === undefined || candidate instanceof Timestamp;
  return (
    item.schemaVersion === 1 &&
    item.contractVersion === DELIVERY_QUEUE_CONTRACT &&
    item.queueId === id &&
    typeof item.ownerUid === 'string' &&
    item.queueId === deliveryQueueIdentity(item.ownerUid, String(item.notificationId ?? '')) &&
    typeof item.notificationId === 'string' &&
    liveCategories.includes(String(item.category)) &&
    ['mandatory', 'time-sensitive', 'digest-eligible', 'suppressible-instant'].includes(
      String(item.deliveryClass),
    ) &&
    ['instant', 'daily-digest'].includes(String(item.deliveryMode)) &&
    item.deliveryAt instanceof Timestamp &&
    item.queuedAt instanceof Timestamp &&
    optionalTimestamp(item.notAfter) &&
    optionalTimestamp(item.attemptedAt)
  );
}

async function queueNotificationDelivery(
  db: Firestore,
  uid: string,
  notification: NotificationRecord,
  deliveryClass: DeliveryClass,
  deliveryMode: DeliveryMode,
  deliveryAt: number,
  notAfter: number | undefined,
  now: number,
) {
  const queueId = deliveryQueueIdentity(uid, notification.id);
  const ref = deliveryQueue(db).doc(queueId);
  const existing = await ref.get();
  if (existing.exists) {
    const value = existing.data();
    if (
      !validQueueRecord(value, queueId) ||
      value.ownerUid !== uid ||
      value.notificationId !== notification.id
    )
      throw new Error('notification-queue-collision');
    return !value.attemptedAt;
  }
  const pending = await pruneDeliveryQueueForUid(db, uid, now);
  if (pending >= MAX_DELIVERY_QUEUE_PER_UID) return false;
  return db.runTransaction(async (transaction) => {
    const [raced, current] = await Promise.all([
      transaction.get(ref),
      transaction.get(
        deliveryQueue(db)
          .where('ownerUid', '==', uid)
          .limit(MAX_DELIVERY_QUEUE_PER_UID + 1),
      ),
    ]);
    if (raced.exists) {
      const value = raced.data();
      if (
        !validQueueRecord(value, queueId) ||
        value.ownerUid !== uid ||
        value.notificationId !== notification.id
      )
        throw new Error('notification-queue-collision');
      return !value.attemptedAt;
    }
    if (
      current.docs.filter((item) => !item.data().attemptedAt).length >= MAX_DELIVERY_QUEUE_PER_UID
    )
      return false;
    transaction.create(ref, {
      schemaVersion: 1,
      contractVersion: DELIVERY_QUEUE_CONTRACT,
      queueId,
      ownerUid: uid,
      notificationId: notification.id,
      category: notification.category,
      deliveryClass,
      deliveryMode,
      deliveryAt: Timestamp.fromMillis(deliveryAt),
      queuedAt: Timestamp.fromMillis(now),
      ...(notAfter === undefined ? {} : { notAfter: Timestamp.fromMillis(notAfter) }),
    });
    return true;
  });
}

async function pruneDeliveryQueueForUid(db: Firestore, uid: string, now = Date.now()) {
  const snapshot = await deliveryQueue(db)
    .where('ownerUid', '==', uid)
    .limit(MAX_DELIVERY_QUEUE_PER_UID + 1)
    .get();
  if (snapshot.size > MAX_DELIVERY_QUEUE_PER_UID)
    throw new Error('notification-delivery-queue-bound-exceeded');
  let pending = 0;
  const batch = db.batch();
  const candidates = snapshot.docs.map((document) => {
    const value = document.data();
    return { document, item: validQueueRecord(value, document.id) ? value : null };
  });
  const sources = await Promise.all(
    candidates.map(({ item }) =>
      item ? inbox(db, uid).doc(item.notificationId).get() : Promise.resolve(null),
    ),
  );
  for (let index = 0; index < candidates.length; index += 1) {
    const { document, item } = candidates[index];
    const source = sources[index];
    const notification = source?.data()?.notification as NotificationRecord | undefined;
    if (
      !item ||
      item.attemptedAt ||
      !source?.exists ||
      !validNotification(notification, uid, now) ||
      notification.readAt ||
      notification.dismissedAt ||
      (item.notAfter && item.notAfter.toMillis() <= now)
    )
      batch.delete(document.ref);
    else pending += 1;
  }
  if (snapshot.size !== pending) await batch.commit();
  return pending;
}

async function recomputePendingDeliveryQueue(
  db: Firestore,
  uid: string,
  controls: DeliveryControls,
  now = Date.now(),
) {
  await pruneDeliveryQueueForUid(db, uid, now);
  const [queueSnapshot, preferenceSnapshot] = await Promise.all([
    deliveryQueue(db).where('ownerUid', '==', uid).limit(MAX_DELIVERY_QUEUE_PER_UID).get(),
    db.doc(`notificationRemotePreferences/${uid}`).get(),
  ]);
  const preferences = preferenceSnapshot.data() as RemotePreferences | undefined;
  const batch = db.batch();
  const candidates = queueSnapshot.docs.map((document) => {
    const value = document.data();
    return { document, item: validQueueRecord(value, document.id) ? value : null };
  });
  const sources = await Promise.all(
    candidates.map(({ item }) =>
      item ? inbox(db, uid).doc(item.notificationId).get() : Promise.resolve(null),
    ),
  );
  for (let index = 0; index < candidates.length; index += 1) {
    const { document, item } = candidates[index];
    if (!validQueueRecord(item, document.id) || item.attemptedAt) {
      batch.delete(document.ref);
      continue;
    }
    const source = sources[index];
    const notification = source?.data()?.notification as NotificationRecord | undefined;
    if (
      !source?.exists ||
      !validNotification(notification, uid, now) ||
      notification.readAt ||
      notification.dismissedAt ||
      !preferenceAllowsNotification(notification, preferences)
    ) {
      batch.delete(document.ref);
      continue;
    }
    const notAfter = item.notAfter?.toMillis();
    const decision = decideDelivery(notification, controls, now, notAfter);
    if (decision.kind === 'none') batch.delete(document.ref);
    else
      batch.update(document.ref, {
        deliveryClass: decision.deliveryClass,
        deliveryMode: decision.kind === 'queue' ? decision.deliveryMode : 'instant',
        deliveryAt: Timestamp.fromMillis(decision.kind === 'queue' ? decision.deliveryAt : now),
      });
  }
  if (!queueSnapshot.empty) await batch.commit();
  return { recomputed: queueSnapshot.size };
}

export async function sweepQueuedNotificationDeliveriesService(
  db: Firestore,
  now: Date,
  sender: PushSender,
) {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('invalid-request');
  const firstPage = await deliveryQueue(db)
    .where('deliveryAt', '<=', Timestamp.fromMillis(nowMs))
    .orderBy('deliveryAt')
    .limit(MAX_DELIVERY_SWEEP)
    .get();
  const pendingDue = firstPage.docs.filter(
    (item) => !item.data().attemptedAt && validQueueRecord(item.data(), item.id),
  );
  const cleanupItems = firstPage.docs.filter((item) => !pendingDue.includes(item));
  if (cleanupItems.length) {
    const cleanup = db.batch();
    for (const item of cleanupItems) cleanup.delete(item.ref);
    await cleanup.commit();
  }
  const dueOwners = [...new Set(pendingDue.map((item) => String(item.data().ownerUid)))];
  let processed = 0;
  let delivered = 0;
  let ownerQueueReadBudget = MAX_DELIVERY_SWEEP;
  let budgetTruncated = false;
  for (const uid of dueOwners) {
    if (ownerQueueReadBudget === 0) {
      budgetTruncated = true;
      break;
    }
    const ownerQueue = await deliveryQueue(db)
      .where('ownerUid', '==', uid)
      .limit(Math.min(MAX_DELIVERY_QUEUE_PER_UID + 1, ownerQueueReadBudget + 1))
      .get();
    if (ownerQueue.size > MAX_DELIVERY_QUEUE_PER_UID)
      throw new Error('notification-delivery-queue-bound-exceeded');
    if (ownerQueue.size > ownerQueueReadBudget) {
      budgetTruncated = true;
      break;
    }
    ownerQueueReadBudget -= ownerQueue.size;
    const due = ownerQueue.docs.filter(
      (item) => item.data().deliveryAt?.toMillis?.() <= nowMs && !item.data().attemptedAt,
    );
    processed += due.length;
    if (!due.length) continue;
    const [preferenceSnapshot, controlsState] = await Promise.all([
      db.doc(`notificationRemotePreferences/${uid}`).get(),
      readDeliveryControlsState(db, uid),
    ]);
    const preferences = preferenceSnapshot.data() as RemotePreferences | undefined;
    const digest: Array<{
      document: FirebaseFirestore.QueryDocumentSnapshot;
      notification: NotificationRecord;
    }> = [];
    const immediate: Array<{
      document: FirebaseFirestore.QueryDocumentSnapshot;
      notification: NotificationRecord;
    }> = [];
    const dueItems = due.map((document) => {
      const value = document.data();
      return { document, queueItem: validQueueRecord(value, document.id) ? value : null };
    });
    const sources = await Promise.all(
      dueItems.map(({ queueItem }) =>
        queueItem ? inbox(db, uid).doc(queueItem.notificationId).get() : Promise.resolve(null),
      ),
    );
    for (let index = 0; index < dueItems.length; index += 1) {
      const { document, queueItem } = dueItems[index];
      const source = sources[index];
      const notification = source?.data()?.notification as NotificationRecord | undefined;
      if (
        !queueItem ||
        !source?.exists ||
        source.data()?.pushAttemptedAt ||
        !validNotification(notification, uid, nowMs) ||
        notification.readAt ||
        notification.dismissedAt ||
        !preferenceAllowsNotification(notification, preferences) ||
        (queueItem.notAfter && queueItem.notAfter.toMillis() <= nowMs)
      ) {
        await document.ref.delete();
        continue;
      }
      if (controlsState.kind === 'invalid') {
        await document.ref.update({ deliveryAt: Timestamp.fromMillis(nowMs + 60 * 60 * 1000) });
        continue;
      }
      if (controlsState.kind === 'valid') {
        const controls = controlsState.controls;
        const quietEnd = nextQuietEnd(nowMs, controls);
        if (quietEnd !== null) {
          if (queueItem.notAfter && quietEnd >= queueItem.notAfter.toMillis())
            await document.ref.delete();
          else await document.ref.update({ deliveryAt: Timestamp.fromMillis(quietEnd) });
          continue;
        }
        const currentMode =
          classifyDelivery(notification) === 'digest-eligible'
            ? modeForNotification(notification, controls)
            : 'instant';
        if (currentMode !== queueItem.deliveryMode && currentMode === 'daily-digest') {
          const next = nextDigestAt(nowMs, controls);
          if (queueItem.notAfter && next >= queueItem.notAfter.toMillis())
            await document.ref.delete();
          else
            await document.ref.update({
              deliveryMode: 'daily-digest',
              deliveryAt: Timestamp.fromMillis(next),
            });
          continue;
        }
        if (currentMode === 'daily-digest') digest.push({ document, notification });
        else immediate.push({ document, notification });
      } else immediate.push({ document, notification });
    }
    if (
      digest.length &&
      (await claimQueueGroup(
        db,
        digest.map((item) => item.document),
        'daily-digest',
        nowMs,
      ))
    ) {
      const representative = [...digest].sort((a, b) =>
        a.notification.id.localeCompare(b.notification.id),
      )[0].notification.id;
      const result = await sendPushToInstallations(db, uid, representative, sender, nowMs);
      if (result.attempted > 0) delivered += 1;
    }
    for (const item of immediate)
      if (await claimQueueGroup(db, [item.document], 'instant', nowMs)) {
        const result = await sendPushToInstallations(db, uid, item.notification.id, sender, nowMs);
        if (result.attempted > 0) delivered += 1;
      }
  }
  return {
    processed,
    delivered,
    truncated: firstPage.size === MAX_DELIVERY_SWEEP || budgetTruncated,
  };
}

async function claimQueueGroup(
  db: Firestore,
  documents: FirebaseFirestore.QueryDocumentSnapshot[],
  expectedMode: DeliveryMode,
  now: number,
) {
  return db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(documents.map((item) => transaction.get(item.ref)));
    const items = snapshots.map((snapshot) => {
      const value = snapshot.data();
      return snapshot.exists && !value?.attemptedAt && validQueueRecord(value, snapshot.id)
        ? value
        : null;
    });
    if (items.some((item) => !item)) return false;
    const ownerUid = items[0]?.ownerUid;
    if (!ownerUid || items.some((item) => item?.ownerUid !== ownerUid)) return false;
    const [preferenceSnapshot, controlsSnapshot, ...inboxSnapshots] = await Promise.all([
      transaction.get(db.doc(`notificationRemotePreferences/${ownerUid}`)),
      transaction.get(deliveryControls(db, ownerUid)),
      ...items.map((item) => transaction.get(inbox(db, ownerUid).doc(item!.notificationId))),
    ]);
    const preferences = preferenceSnapshot.data() as RemotePreferences | undefined;
    const currentControls = controlsSnapshot.exists
      ? parseRemoteDeliveryControls(controlsSnapshot.data(), ownerUid)
      : null;
    if (controlsSnapshot.exists && !currentControls) return false;
    for (let index = 0; index < inboxSnapshots.length; index += 1) {
      const source = inboxSnapshots[index];
      const queueItem = items[index]!;
      const notification = source.data()?.notification as NotificationRecord | undefined;
      if (
        !source.exists ||
        source.data()?.pushAttemptedAt ||
        !validNotification(notification, ownerUid, now) ||
        notification.readAt ||
        notification.dismissedAt ||
        !preferenceAllowsNotification(notification, preferences) ||
        (queueItem.notAfter && queueItem.notAfter.toMillis() <= now)
      )
        return false;
      const currentMode =
        currentControls && classifyDelivery(notification) === 'digest-eligible'
          ? modeForNotification(notification, currentControls)
          : 'instant';
      if (
        currentMode !== expectedMode ||
        (currentControls && nextQuietEnd(now, currentControls) !== null)
      )
        return false;
    }
    for (let index = 0; index < snapshots.length; index += 1) {
      transaction.update(snapshots[index].ref, { attemptedAt: FieldValue.serverTimestamp() });
      transaction.update(inboxSnapshots[index].ref, {
        pushAttemptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        pushDeliveryContract: PUSH_DELIVERY_CONTRACT,
      });
    }
    return true;
  });
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
