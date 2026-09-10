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
const admin = getApps()[0] ?? initializeApp({ projectId });
const authAdmin = getAdminAuth(admin);
const email = 'p38c-rules@example.invalid',
  password = 'Community-test-123!';
try {
  await authAdmin.deleteUser((await authAdmin.getUserByEmail(email)).uid);
} catch {
  /* first run */
}
await authAdmin.createUser({ email, password });
const app = initializeClientApp({ apiKey: 'demo-key', projectId }, 'p38c-rules');
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
  disableWarnings: true,
});
await signInWithEmailAndPassword(auth, email, password);
const db = getFirestore(app);
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
connectFirestoreEmulator(db, host, Number(port));
const paths = [
  'gymCommunityGroups/1111111111111111/groups/test',
  'gymCommunityGroups/1111111111111111/groups/test/posts/test',
  'gymCommunityGroups/1111111111111111/groups/test/posts/test/comments/test',
  'gymCommunityGroups/1111111111111111/groups/test/posts/test/likes/test',
];
for (const path of paths) {
  const ref = doc(db, path);
  await assert.rejects(getDoc(ref));
  await assert.rejects(setDoc(ref, { forged: true }));
  await assert.rejects(updateDoc(ref, { forged: true }));
  await assert.rejects(deleteDoc(ref));
  await assert.rejects(getDocs(collection(db, path.split('/').slice(0, -1).join('/'))));
}
console.log('P38C direct Firestore denial verified with unchanged Rules.');
process.exit(0);
