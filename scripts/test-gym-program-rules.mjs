import assert from 'node:assert/strict';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
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
const admin = getApps()[0] ?? initializeApp({ projectId }),
  authAdmin = getAdminAuth(admin),
  email = 'p38d-rules@example.invalid',
  password = 'Gym-program-123!';
try {
  await authAdmin.deleteUser((await authAdmin.getUserByEmail(email)).uid);
} catch {
  /* first run */
}
await authAdmin.createUser({ email, password });
const app = initializeClientApp({ apiKey: 'demo', projectId }, 'p38d-rules'),
  auth = getAuth(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
  disableWarnings: true,
});
await signInWithEmailAndPassword(auth, email, password);
const db = getFirestore(app),
  [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(db, host, Number(port));
for (const path of [
  'gymProgramPublications/gym/programs/program',
  'gymProgramDeliveryVersions/version',
  'gymProgramAssignments/gym/assignments/assignment',
  'gymProgramAssignmentIndexes/gym/items/index',
  'gymProgramPublicationRequests/gym/items/request',
]) {
  const ref = doc(db, path);
  await assert.rejects(getDoc(ref));
  await assert.rejects(setDoc(ref, { forged: true }));
  await assert.rejects(updateDoc(ref, { forged: true }));
  await assert.rejects(deleteDoc(ref));
  await assert.rejects(getDocs(collection(db, path.split('/').slice(0, -1).join('/'))));
}
console.log('P38D direct Firestore denial verified with unchanged Rules.');
process.exit(0);
