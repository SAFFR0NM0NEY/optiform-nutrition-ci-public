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
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (projectId !== 'demo-optiform-nutrition' || !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error('Demo emulator required.');
const admin = getApps()[0] ?? initializeApp({ projectId });
const authAdmin = getAdminAuth(admin),
  adminDb = getAdminFirestore(admin);
const email = 'p38e-rules@example.invalid',
  password = 'Gym-execution-123!';
try {
  await authAdmin.deleteUser((await authAdmin.getUserByEmail(email)).uid);
} catch {
  /* first run */
}
const user = await authAdmin.createUser({ email, password });
const app = initializeClientApp({ apiKey: 'demo', projectId }, 'p38e-rules');
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
  disableWarnings: true,
});
await signInWithEmailAndPassword(auth, email, password);
const db = getFirestore(app),
  [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(db, host, Number(port));
const gymId = 'gym-p38e';
await adminDb
  .doc(`gymBusinessProfiles/${gymId}`)
  .set({ gymId, status: 'active', platformStatus: 'active' });
const context = {
  contractVersion: 'workout-program-provenance-v3',
  programSource: 'gym-program',
  enrollmentId: 'gym-program-enrollment-test',
  gymId,
  gymProgramId: 'gym-program-a',
  publicationVersionId: 'publication-a',
  deliveryDayId: 'day-a',
  programName: 'Gym strength',
  sessionLabel: 'Day one',
  weekNumber: 1,
  dayOfWeek: 1,
  sessionKey: 'w1-d1',
  scheduledDateLocal: '2026-09-01',
};
const permit = (
  workoutId,
  expiresAt = AdminTimestamp.fromMillis(Date.now() + 60_000),
  override = {},
) => ({
  schemaVersion: 1,
  contractVersion: 'gym-program-execution-permit-v1',
  ownerUid: user.uid,
  workoutId,
  enrollmentId: context.enrollmentId,
  gymId: context.gymId,
  gymProgramId: context.gymProgramId,
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
  ...override,
});
const workout = (workoutId, override = {}) => ({
  schemaVersion: 3,
  recordOrigin: 'athlete-client',
  sourceSessionSchemaVersion: 5,
  workoutId,
  ownerUid: user.uid,
  startedAt: Timestamp.fromMillis(Date.now() - 1000),
  completedAt: Timestamp.now(),
  pausedDurationSeconds: 0,
  groups: [],
  exercises: [{}],
  programContext: { ...context, ...override },
});
const valid = 'p38e-valid';
await adminDb.doc(`gymProgramExecutionPermits/${user.uid}/permits/${valid}`).set(permit(valid));
await setDoc(doc(db, 'athletes', user.uid, 'workouts', valid), workout(valid));
assert.equal((await getDoc(doc(db, 'athletes', user.uid, 'workouts', valid))).exists(), true);
for (const [label, permitOverride, contextOverride, expired] of [
  ['missing', null, {}, false],
  ['expired', {}, {}, true],
  ['wrong-workout', { workoutId: 'other' }, {}, false],
  ['wrong-enrollment', {}, { enrollmentId: 'gym-program-enrollment-other' }, false],
  ['wrong-gym', {}, { gymId: 'other-gym' }, false],
  ['wrong-program', {}, { gymProgramId: 'other' }, false],
  ['wrong-version', {}, { publicationVersionId: 'other' }, false],
  ['wrong-day', {}, { deliveryDayId: 'other' }, false],
  ['wrong-session', {}, { sessionKey: 'w1-d2' }, false],
  ['wrong-date', {}, { scheduledDateLocal: '2026-09-02' }, false],
  ['wrong-label', {}, { sessionLabel: 'Other' }, false],
]) {
  const id = `p38e-${label}`;
  if (permitOverride)
    await adminDb
      .doc(`gymProgramExecutionPermits/${user.uid}/permits/${id}`)
      .set(
        permit(
          id,
          expired ? AdminTimestamp.fromMillis(Date.now() - 1000) : undefined,
          permitOverride,
        ),
      );
  await assert.rejects(
    setDoc(doc(db, 'athletes', user.uid, 'workouts', id), workout(id, contextOverride)),
  );
}
await adminDb.doc(`gymBusinessProfiles/${gymId}`).update({ status: 'paused' });
for (const [id, update] of [
  ['p38e-paused', {}],
  ['p38e-suspended', { status: 'active', platformStatus: 'suspended' }],
]) {
  if (Object.keys(update).length) await adminDb.doc(`gymBusinessProfiles/${gymId}`).update(update);
  await adminDb.doc(`gymProgramExecutionPermits/${user.uid}/permits/${id}`).set(permit(id));
  await assert.rejects(setDoc(doc(db, 'athletes', user.uid, 'workouts', id), workout(id)));
}
await adminDb
  .doc(`gymBusinessProfiles/${gymId}`)
  .update({ status: 'active', platformStatus: 'active' });
for (const id of ['p38e-resumed', 'p38e-access-loss-grace']) {
  await adminDb.doc(`gymProgramExecutionPermits/${user.uid}/permits/${id}`).set(permit(id));
  await setDoc(doc(db, 'athletes', user.uid, 'workouts', id), workout(id));
}
for (const path of [
  `gymProgramEnrollments/${user.uid}/gyms/${gymId}/items/x`,
  `gymProgramActiveEnrollmentIndexes/${user.uid}/gyms/${gymId}/items/x`,
  `gymProgramExecutionPermits/${user.uid}/permits/x`,
]) {
  await assert.rejects(getDoc(doc(db, path)));
  await assert.rejects(setDoc(doc(db, path), { forged: true }));
  await assert.rejects(updateDoc(doc(db, path), { forged: true }));
  await assert.rejects(deleteDoc(doc(db, path)));
  await assert.rejects(getDocs(collection(db, path.split('/').slice(0, -1).join('/'))));
}
console.log(
  'P38E Rules verified: exact V3 permit and grace/resume writes accepted; malformed, mismatched, expired, paused and suspended cases denied.',
);
process.exit(0);
