import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';
import { defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  GoogleSignInPreflightError,
  createEmulatorGoogleIdentityVerifier,
  createFirebaseAuthDirectory,
  createGoogleIdentityVerifier,
  createGoogleSignInPreflightService,
} from './googleSignInPreflight.js';

const app = getApps()[0] ?? initializeApp();
const auth = getAuth(app);
const googleAuthWebClientId = defineString('GOOGLE_AUTH_WEB_CLIENT_ID', { default: '' });
const emulator = process.env.FUNCTIONS_EMULATOR === 'true';

export const preflightGoogleSignIn = onCall(
  {
    region: 'africa-south1',
    timeoutSeconds: 15,
    memory: '256MiB',
    minInstances: 0,
    maxInstances: 2,
    enforceAppCheck: !emulator,
  },
  async (request) => {
    const service = createGoogleSignInPreflightService({
      verifier: emulator
        ? createEmulatorGoogleIdentityVerifier()
        : createGoogleIdentityVerifier(new OAuth2Client(), googleAuthWebClientId.value()),
      directory: createFirebaseAuthDirectory(auth),
    });
    try {
      return await service(request.data);
    } catch (error) {
      const preflightError =
        error instanceof GoogleSignInPreflightError
          ? error
          : new GoogleSignInPreflightError('unavailable');
      if (preflightError.code === 'invalid-request')
        throw new HttpsError('invalid-argument', 'The Google sign-in request is invalid.');
      if (preflightError.code === 'invalid-google-identity')
        throw new HttpsError('invalid-argument', 'The Google identity could not be verified.');
      throw new HttpsError('unavailable', 'Google sign-in preflight is temporarily unavailable.');
    }
  },
);
