import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
const project = process.argv[process.argv.indexOf('--project') + 1];
const expected = 'demo-optiform-nutrition';
if (project !== expected || process.env.GCLOUD_PROJECT !== expected)
  throw new Error('Exact demo project is required.');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Emulator hosts are required.');
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Credentials are forbidden.');
const finalize = process.argv.includes('--finalize');
const verifyOnly = process.argv.includes('--verify-only');
if (!getApps().length) initializeApp({ projectId: expected });
const db = getFirestore();
const markerRef = db.doc('systemMigrations/social-pair-security-v1');
const marker = await markerRef.get();
if (verifyOnly) {
  if (!marker.exists || marker.data()?.status !== 'complete')
    throw new Error('Synthetic reconciliation marker is incomplete.');
  console.log('Synthetic social-pair reconciliation verified.');
  process.exit(0);
}
if (marker.exists && marker.data()?.status === 'complete') {
  console.log('Synthetic reconciliation already complete.');
  process.exit(0);
}
const canonical = (a, b) => {
  if (!a || !b || a === b || !/^[A-Za-z0-9]+$/.test(a) || !/^[A-Za-z0-9]+$/.test(b))
    throw new Error('Malformed synthetic identity.');
  const participantUids = [a, b].sort();
  return { pairId: participantUids.join('__'), participantUids };
};
const pairs = new Map();
const ensure = (a, b) => {
  const id = canonical(a, b);
  if (!pairs.has(id.pairId))
    pairs.set(id.pairId, {
      ...id,
      friendshipAccepted: false,
      lowBlocksHigh: false,
      highBlocksLow: false,
    });
  return pairs.get(id.pairId);
};
for (const snapshot of (await db.collection('friendships').get()).docs) {
  const value = snapshot.data();
  if (!Array.isArray(value.participantUids) || value.participantUids.length !== 2)
    throw new Error('Malformed synthetic friendship.');
  if (value.status === 'accepted') ensure(...value.participantUids).friendshipAccepted = true;
}
for (const snapshot of (await db.collectionGroup('blockedUsers').get()).docs) {
  const owner = snapshot.ref.parent.parent?.id;
  const pair = ensure(owner, snapshot.id);
  if (owner === pair.participantUids[0]) pair.lowBlocksHigh = true;
  else pair.highBlocksLow = true;
  pair.friendshipAccepted = false;
}
for (const snapshot of (await db.collection('socialPairSecurity').get()).docs)
  if (!pairs.has(snapshot.id)) {
    const [a, b] = snapshot.id.split('__');
    pairs.set(snapshot.id, {
      ...canonical(a, b),
      friendshipAccepted: false,
      lowBlocksHigh: false,
      highBlocksLow: false,
    });
  }
const batch = db.batch();
for (const value of pairs.values())
  batch.set(db.doc('socialPairSecurity/' + value.pairId), {
    schemaVersion: 1,
    projectionVersion: 'social-pair-security-v1',
    ...value,
    updatedAt: FieldValue.serverTimestamp(),
  });
if (finalize)
  batch.set(markerRef, {
    schemaVersion: 1,
    projectionVersion: 'social-pair-security-v1',
    status: 'complete',
    completedAt: FieldValue.serverTimestamp(),
    projectedPairCount: pairs.size,
  });
await batch.commit();
console.log('Synthetic emulator-only social-pair reconciliation complete.');
