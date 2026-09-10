import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import {
  getFirestore as getAdminFirestore,
  Timestamp as AdminTimestamp,
} from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  Timestamp as ClientTimestamp,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (
  projectId !== 'demo-optiform-nutrition' ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error('Demo Auth and Firestore emulators are required.');
const adminApp = getApps()[0] ?? initializeApp({ projectId });
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);
const email = 'p34c-athlete@example.invalid';
const password = 'Creator-execution-123!';
try {
  await adminAuth.deleteUser((await adminAuth.getUserByEmail(email)).uid);
} catch {
  /* first run */
}
const user = await adminAuth.createUser({ email, password, emailVerified: true });
const clientApp = initializeClientApp({ apiKey: 'demo-key', projectId }, 'p34c-rules');
const auth = getAuth(clientApp);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
  disableWarnings: true,
});
await signInWithEmailAndPassword(auth, email, password);
const clientDb = getFirestore(clientApp);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(clientDb, host, Number(port));

const creatorId = 'creator-p34c';
const listingId = 'listing-p34c';
await adminDb
  .doc(`creatorPublicListings/${listingId}`)
  .set({ creatorId, platformStatus: 'active' });
await adminDb
  .doc(`creatorPublicProfiles/${creatorId}`)
  .set({ creatorId, platformStatus: 'active' });

const context = {
  contractVersion: 'workout-program-provenance-v2',
  programSource: 'creator-entitled',
  enrollmentId: 'creator-enrollment-test',
  listingId,
  creatorId,
  publicationVersionId: 'publication-p34c-v1',
  deliveryDayId: 'day-1',
  programName: 'Synthetic Creator Plan',
  sessionLabel: 'Day one',
  weekNumber: 1,
  dayOfWeek: 1,
  sessionKey: 'w1-d1',
  scheduledDateLocal: '2026-09-01',
};
const permit = (workoutId, expiresAt = AdminTimestamp.fromMillis(Date.now() + 60_000)) => ({
  schemaVersion: 1,
  contractVersion: 'creator-program-execution-permit-v1',
  ownerUid: user.uid,
  workoutId,
  enrollmentId: context.enrollmentId,
  listingId: context.listingId,
  creatorId: context.creatorId,
  publicationVersionId: context.publicationVersionId,
  deliveryDayId: context.deliveryDayId,
  programName: context.programName,
  sessionLabel: context.sessionLabel,
  weekNumber: context.weekNumber,
  dayOfWeek: context.dayOfWeek,
  sessionKey: context.sessionKey,
  scheduledDateLocal: context.scheduledDateLocal,
  contentHash: 'a'.repeat(64),
  firstIssuedAt: AdminTimestamp.now(),
  lastAuthorizedAt: AdminTimestamp.now(),
  expiresAt,
  revision: 1,
});
const workout = (workoutId, override = {}) => ({
  schemaVersion: 3,
  recordOrigin: 'athlete-client',
  sourceSessionSchemaVersion: 5,
  workoutId,
  ownerUid: user.uid,
  startedAt: ClientTimestamp.fromMillis(Date.now() - 1000),
  completedAt: ClientTimestamp.now(),
  pausedDurationSeconds: 0,
  groups: [],
  exercises: [{}],
  programContext: { ...context, ...override },
});

const validId = 'p34c-valid';
await adminDb
  .doc(`creatorProgramExecutionPermits/${user.uid}/permits/${validId}`)
  .set(permit(validId));
await setDoc(doc(clientDb, 'athletes', user.uid, 'workouts', validId), workout(validId));
assert.equal(
  (await getDoc(doc(clientDb, 'athletes', user.uid, 'workouts', validId))).exists(),
  true,
);

for (const [name, prepare, override = {}] of [
  ['missing permit', async () => {}, {}],
  [
    'expired permit',
    async (id) =>
      adminDb
        .doc(`creatorProgramExecutionPermits/${user.uid}/permits/${id}`)
        .set(permit(id, AdminTimestamp.fromMillis(Date.now() - 1000))),
    {},
  ],
  [
    'other workout permit',
    async (id) =>
      adminDb
        .doc(`creatorProgramExecutionPermits/${user.uid}/permits/${id}`)
        .set({ ...permit(id), workoutId: 'different' }),
    {},
  ],
  [
    'wrong session',
    async (id) =>
      adminDb.doc(`creatorProgramExecutionPermits/${user.uid}/permits/${id}`).set(permit(id)),
    { sessionKey: 'w1-d2' },
  ],
]) {
  const id = `p34c-${name.replaceAll(' ', '-')}`;
  await prepare(id);
  await assert.rejects(
    setDoc(doc(clientDb, 'athletes', user.uid, 'workouts', id), workout(id, override)),
  );
}

await assert.rejects(
  getDoc(doc(clientDb, `creatorProgramExecutionPermits/${user.uid}/permits/${validId}`)),
);
await assert.rejects(
  setDoc(doc(clientDb, `creatorProgramEnrollments/${user.uid}/items/forged`), {
    ownerUid: user.uid,
  }),
);
await adminDb.doc(`creatorPublicListings/${listingId}`).update({ platformStatus: 'suspended' });
const suspendedId = 'p34c-suspended';
await adminDb
  .doc(`creatorProgramExecutionPermits/${user.uid}/permits/${suspendedId}`)
  .set(permit(suspendedId));
await assert.rejects(
  setDoc(doc(clientDb, 'athletes', user.uid, 'workouts', suspendedId), workout(suspendedId)),
);

console.log(
  'P34C creator execution Rules verified: matching permit accepted; forgery, expiry, collision, direct authority access and platform suspension denied.',
);
process.exit(0);
