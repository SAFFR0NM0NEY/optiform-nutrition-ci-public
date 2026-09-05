const expected = 'demo-optiform-nutrition';
if (process.env.GCLOUD_PROJECT !== expected)
  throw new Error('GCLOUD_PROJECT must be the exact demo project.');
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CONFIG'])
  if (process.env[name]) throw new Error(name + ' must be absent in public CI.');
console.log('Demo-only emulator boundary verified.');
