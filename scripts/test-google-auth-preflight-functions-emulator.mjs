import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const project = process.env.GCLOUD_PROJECT || 'demo-optiform-nutrition';
if (project !== 'demo-optiform-nutrition' || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Google auth preflight integration requires the demo Auth emulator.');

const functionsHost = process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001';
const endpoint = `http://${functionsHost}/${project}/africa-south1/preflightGoogleSignIn`;
const app = getApps()[0] ?? initializeApp({ projectId: project });
const auth = getAuth(app);

await auth.createUser({
  uid: 'p26-password-user',
  email: 'p26-password@example.invalid',
  emailVerified: true,
  password: 'SyntheticPassword123!',
});
const imported = await auth.importUsers([
  {
    uid: 'p26-google-user',
    email: 'p26-google@example.invalid',
    emailVerified: true,
    providerData: [
      {
        uid: 'synthetic-google-subject',
        providerId: 'google.com',
        email: 'p26-google@example.invalid',
      },
    ],
  },
]);
if (imported.successCount !== 1 || imported.failureCount !== 0)
  throw new Error('Could not seed the synthetic Google-linked Auth user.');

const call = async (data) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, body: await response.json() };
};

const request = (googleIdToken) => ({
  contractVersion: 'google-auth-signin-preflight-v1',
  googleIdToken,
});

for (const [token, decision] of [
  ['synthetic-google-new-v1', 'ALLOW_GOOGLE_SIGN_IN'],
  ['synthetic-google-linked-v1', 'ALLOW_GOOGLE_SIGN_IN'],
  ['synthetic-google-password-v1', 'EXISTING_ACCOUNT_LINK_REQUIRED'],
]) {
  const result = await call(request(token));
  if (
    result.body.result?.contractVersion !== 'google-auth-signin-preflight-v1' ||
    result.body.result?.decision !== decision ||
    Object.keys(result.body.result).sort().join(',') !== 'contractVersion,decision'
  )
    throw new Error(`Synthetic ${decision} preflight failed.`);
}

const arbitraryEmail = await call({
  ...request('synthetic-google-new-v1'),
  email: 'target@example.invalid',
});
if (arbitraryEmail.body.error?.status !== 'INVALID_ARGUMENT')
  throw new Error('Arbitrary email lookup payload was not rejected.');

const invalidIdentity = await call(request('synthetic-google-invalid-v1'));
if (invalidIdentity.body.error?.status !== 'INVALID_ARGUMENT')
  throw new Error('Invalid Google identity proof was not rejected.');

console.log(
  'P26 Google Auth preflight Functions emulator verified: anonymous identity proof, new/already-linked allow, password-only link-required, minimal response, arbitrary-email rejection, and invalid-proof denial passed.',
);
