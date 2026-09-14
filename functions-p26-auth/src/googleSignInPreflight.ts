import type { Auth, UserRecord } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT = 'google-auth-signin-preflight-v1' as const;

export const GOOGLE_SIGN_IN_PREFLIGHT_DECISIONS = [
  'ALLOW_GOOGLE_SIGN_IN',
  'EXISTING_ACCOUNT_LINK_REQUIRED',
] as const;

export type GoogleSignInPreflightDecision = (typeof GOOGLE_SIGN_IN_PREFLIGHT_DECISIONS)[number];

export type GoogleSignInPreflightResponse = {
  contractVersion: typeof GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT;
  decision: GoogleSignInPreflightDecision;
};

export type GoogleSignInPreflightCode =
  'invalid-request' | 'invalid-google-identity' | 'unavailable';

export class GoogleSignInPreflightError extends Error {
  constructor(public readonly code: GoogleSignInPreflightCode) {
    super(code);
  }
}

type VerifiedGoogleIdentity = { email: string };

export type GoogleIdentityVerifier = {
  verify(idToken: string): Promise<VerifiedGoogleIdentity>;
};

export type FirebaseAuthDirectory = {
  findByEmail(email: string): Promise<{ providerIds: string[] } | null>;
};

type SafeLogger = {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
};

type GoogleSignInPreflightDependencies = {
  verifier: GoogleIdentityVerifier;
  directory: FirebaseAuthDirectory;
  logger?: SafeLogger;
  now?: () => number;
};

function parseRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GoogleSignInPreflightError('invalid-request');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'contractVersion,googleIdToken')
    throw new GoogleSignInPreflightError('invalid-request');
  if (record.contractVersion !== GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT)
    throw new GoogleSignInPreflightError('invalid-request');
  if (
    typeof record.googleIdToken !== 'string' ||
    record.googleIdToken.length < 8 ||
    record.googleIdToken.length > 8_192 ||
    /[\r\n\0]/.test(record.googleIdToken)
  )
    throw new GoogleSignInPreflightError('invalid-request');
  return { googleIdToken: record.googleIdToken };
}

export function createGoogleIdentityVerifier(client: OAuth2Client, audience: string) {
  const expectedAudience = audience.trim();
  return {
    async verify(idToken: string): Promise<VerifiedGoogleIdentity> {
      if (!expectedAudience) throw new GoogleSignInPreflightError('unavailable');
      try {
        const ticket = await client.verifyIdToken({ idToken, audience: expectedAudience });
        const payload = ticket.getPayload();
        if (
          !payload ||
          typeof payload.email !== 'string' ||
          !payload.email.trim() ||
          payload.email_verified !== true
        )
          throw new GoogleSignInPreflightError('invalid-google-identity');
        return { email: payload.email.trim().toLowerCase() };
      } catch (error) {
        if (error instanceof GoogleSignInPreflightError) throw error;
        throw new GoogleSignInPreflightError('invalid-google-identity');
      }
    },
  } satisfies GoogleIdentityVerifier;
}

function firebaseAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  if ('code' in error && typeof error.code === 'string') return error.code;
  if (
    'errorInfo' in error &&
    error.errorInfo &&
    typeof error.errorInfo === 'object' &&
    'code' in error.errorInfo &&
    typeof error.errorInfo.code === 'string'
  )
    return error.errorInfo.code;
  return '';
}

export function createFirebaseAuthDirectory(auth: Pick<Auth, 'getUserByEmail'>) {
  return {
    async findByEmail(email: string) {
      let user: UserRecord;
      try {
        user = await auth.getUserByEmail(email);
      } catch (error) {
        if (firebaseAuthErrorCode(error) === 'auth/user-not-found') return null;
        throw new GoogleSignInPreflightError('unavailable');
      }
      return { providerIds: user.providerData.map((provider) => provider.providerId) };
    },
  } satisfies FirebaseAuthDirectory;
}

export function createGoogleSignInPreflightService(
  dependencies: GoogleSignInPreflightDependencies,
) {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? Date.now;
  return async (rawRequest: unknown): Promise<GoogleSignInPreflightResponse> => {
    const started = now();
    try {
      const request = parseRequest(rawRequest);
      const identity = await dependencies.verifier.verify(request.googleIdToken);
      const user = await dependencies.directory.findByEmail(identity.email);
      const outcome =
        !user || user.providerIds.includes('google.com')
          ? 'ALLOW_GOOGLE_SIGN_IN'
          : 'EXISTING_ACCOUNT_LINK_REQUIRED';
      logger.info('google_sign_in_preflight_complete', {
        outcome,
        durationMs: Math.max(0, now() - started),
      });
      return { contractVersion: GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT, decision: outcome };
    } catch (error) {
      const preflightError =
        error instanceof GoogleSignInPreflightError
          ? error
          : new GoogleSignInPreflightError('unavailable');
      logger.warn('google_sign_in_preflight_failed', {
        outcome: preflightError.code,
        durationMs: Math.max(0, now() - started),
      });
      throw preflightError;
    }
  };
}

const EMULATOR_IDENTITIES = new Map([
  ['synthetic-google-new-v1', 'p26-new@example.invalid'],
  ['synthetic-google-linked-v1', 'p26-google@example.invalid'],
  ['synthetic-google-password-v1', 'p26-password@example.invalid'],
]);

export function createEmulatorGoogleIdentityVerifier(): GoogleIdentityVerifier {
  return {
    async verify(idToken) {
      const email = EMULATOR_IDENTITIES.get(idToken);
      if (!email) throw new GoogleSignInPreflightError('invalid-google-identity');
      return { email };
    },
  };
}
