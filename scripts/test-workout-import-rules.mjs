import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { initializeApp as initializeClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-optiform-nutrition';
if (projectId !== 'demo-optiform-nutrition' || !process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error('Demo emulator required.');
const admin = getApps()[0] ?? initializeApp({ projectId });
const authAdmin = getAdminAuth(admin);
const adminDb = getAdminFirestore(admin);
const password = 'Import-test-123!';

async function client(name) {
  const email = `p73-${name}@example.invalid`;
  try {
    await authAdmin.deleteUser((await authAdmin.getUserByEmail(email)).uid);
  } catch {
    /* first run */
  }
  const user = await authAdmin.createUser({ email, password });
  const app = initializeClientApp({ apiKey: 'demo-key', projectId }, `p73-${name}`);
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
const unauthApp = initializeClientApp({ apiKey: 'demo-key', projectId }, 'p73-unauth');
const unauthDb = getFirestore(unauthApp);
const [unauthHost, unauthPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(unauthDb, unauthHost, Number(unauthPort));
const workoutPath = `athletes/${owner.uid}/importedWorkouts/imported-safe`;
const batchPath = `athletes/${owner.uid}/workoutImportBatches/batch-safe`;
const claimPath = 'workoutImportContentClaims/claim-safe';
await adminDb.doc(workoutPath).set({ ownerUid: owner.uid });
await adminDb.doc(batchPath).set({ ownerUid: owner.uid });
await adminDb.doc(claimPath).set({ ownerUid: owner.uid });

for (const path of [workoutPath, batchPath]) {
  assert.equal((await getDoc(doc(owner.db, path))).exists(), true);
  await assert.rejects(getDoc(doc(other.db, path)));
  await assert.rejects(setDoc(doc(owner.db, path.replace(/safe$/, 'new')), { forged: true }));
  await assert.rejects(updateDoc(doc(owner.db, path), { forged: true }));
  await assert.rejects(deleteDoc(doc(owner.db, path)));
  await assert.rejects(getDoc(doc(unauthDb, path)));
}
const workoutList = await getDocs(collection(owner.db, `athletes/${owner.uid}/importedWorkouts`));
const batchList = await getDocs(collection(owner.db, `athletes/${owner.uid}/workoutImportBatches`));
assert.equal(workoutList.size, 1);
assert.equal(batchList.size, 1);
await assert.rejects(getDocs(collection(other.db, `athletes/${owner.uid}/importedWorkouts`)));
await assert.rejects(getDocs(collection(other.db, `athletes/${owner.uid}/workoutImportBatches`)));
await assert.rejects(getDoc(doc(owner.db, claimPath)));
await assert.rejects(setDoc(doc(owner.db, claimPath), { forged: true }));

console.log('P73 imported history owner-read/server-write Rules verified.');
process.exit(0);
