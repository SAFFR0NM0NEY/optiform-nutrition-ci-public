import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  Timestamp,
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (
  projectId !== 'demo-optiform-nutrition' ||
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error('Demo Auth and Firestore emulators are required.');

const admin = getApps()[0] ?? initializeApp({ projectId });
const authAdmin = getAdminAuth(admin);
const password = 'Limitations-test-123!';
let appSequence = 0;

async function client(name, customClaims) {
  const email = `p65-${name}@example.invalid`;
  try {
    await authAdmin.deleteUser((await authAdmin.getUserByEmail(email)).uid);
  } catch {
    // First run.
  }
  const user = await authAdmin.createUser({ email, password });
  if (customClaims) await authAdmin.setCustomUserClaims(user.uid, customClaims);
  const app = initializeClientApp(
    { apiKey: 'demo-key', projectId },
    `p65-${name}-${appSequence++}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  return { uid: user.uid, db };
}

const owner = await client('owner');
const other = await client('other');
const operator = await client('operator', {
  optiformRoles: ['platform-admin', 'moderator', 'support', 'verifier'],
});
const unauthApp = initializeClientApp({ apiKey: 'demo-key', projectId }, 'p65-unauth');
const unauthDb = getFirestore(unauthApp);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(unauthDb, host, Number(port));

const path = `athletes/${owner.uid}/limitationProfile/current`;
const ref = doc(owner.db, path);
const valid = (overrides = {}) => ({
  schemaVersion: 1,
  contractVersion: 'athlete-limitation-profile-v1',
  ownerUid: owner.uid,
  excludedMovementPatterns: ['squat', 'horizontal-push'],
  excludedSystemExerciseIds: ['back-squat', 'barbell-bench-press'],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

await setDoc(ref, valid());
assert.equal((await getDoc(ref)).exists(), true);
await assert.rejects(getDoc(doc(other.db, path)));
await assert.rejects(getDoc(doc(operator.db, path)));
await assert.rejects(getDoc(doc(unauthDb, path)));
await assert.rejects(getDocs(collection(owner.db, `athletes/${owner.uid}/limitationProfile`)));

await updateDoc(ref, {
  excludedMovementPatterns: ['hinge'],
  excludedSystemExerciseIds: ['deadlift'],
  updatedAt: serverTimestamp(),
});

await assert.rejects(setDoc(doc(other.db, path), valid({ ownerUid: other.uid })));
await assert.rejects(updateDoc(doc(other.db, path), { updatedAt: serverTimestamp() }));
await assert.rejects(deleteDoc(doc(other.db, path)));
await assert.rejects(setDoc(doc(unauthDb, path), valid()));
await assert.rejects(updateDoc(doc(unauthDb, path), { updatedAt: serverTimestamp() }));
await assert.rejects(deleteDoc(doc(unauthDb, path)));
await assert.rejects(
  setDoc(doc(owner.db, `athletes/${owner.uid}/limitationProfile/history`), valid()),
);
await assert.rejects(setDoc(doc(owner.db, path), valid({ ownerUid: other.uid })));
await assert.rejects(setDoc(doc(owner.db, path), valid({ contractVersion: 'wrong' })));
await assert.rejects(setDoc(doc(owner.db, path), valid({ note: 'unsupported' })));
await assert.rejects(
  setDoc(doc(owner.db, path), valid({ excludedMovementPatterns: ['unknown-pattern'] })),
);
await assert.rejects(
  setDoc(doc(owner.db, path), valid({ excludedMovementPatterns: ['squat', 'squat'] })),
);
await assert.rejects(
  setDoc(
    doc(owner.db, path),
    valid({
      excludedMovementPatterns: [
        'horizontal-push',
        'vertical-push',
        'horizontal-pull',
        'vertical-pull',
        'squat',
        'hinge',
        'lunge',
        'carry',
        'integrated',
        'rotation',
        'anti-rotation',
        'flexion-extension',
        'isolation',
        'locomotion-conditioning',
        'extra',
      ],
    }),
  ),
);
await assert.rejects(
  setDoc(doc(owner.db, path), valid({ excludedSystemExerciseIds: ['deadlift', 'deadlift'] })),
);
await assert.rejects(
  setDoc(
    doc(owner.db, path),
    valid({
      excludedSystemExerciseIds: Array.from({ length: 41 }, (_, index) => `exercise-${index}`),
    }),
  ),
);
await assert.rejects(
  setDoc(
    doc(owner.db, path),
    valid({ createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')) }),
  ),
);
await assert.rejects(
  updateDoc(ref, {
    createdAt: Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z')),
    updatedAt: serverTimestamp(),
  }),
);
await assert.rejects(
  updateDoc(ref, {
    updatedAt: Timestamp.fromDate(new Date('2026-01-03T00:00:00.000Z')),
  }),
);

await deleteDoc(ref);
assert.equal((await getDoc(ref)).exists(), false);

console.log('P65 owner-private training limitation Rules verified.');
process.exit(0);
