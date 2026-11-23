import { describe, expect, it, vi } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import {
  GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT,
  GoogleSignInPreflightError,
  createFirebaseAuthDirectory,
  createGoogleIdentityVerifier,
  createGoogleSignInPreflightService,
} from './googleSignInPreflight.js';

const request = (token = 'synthetic-google-token') => ({
  contractVersion: GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT,
  googleIdToken: token,
});

function setup(providerIds: string[] | null = null) {
  const verifier = { verify: vi.fn(async () => ({ email: 'athlete@gmail.com' })) };
  const directory = {
    findByEmail: vi.fn(async () => (providerIds ? { providerIds } : null)),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  return {
    verifier,
    directory,
    logger,
    service: createGoogleSignInPreflightService({ verifier, directory, logger }),
  };
}

describe('google-auth-signin-preflight-v1', () => {
  it('allows a verified Google identity when no Firebase user exists', async () => {
    const { service } = setup();
    await expect(service(request())).resolves.toEqual({
      contractVersion: GOOGLE_AUTH_SIGNIN_PREFLIGHT_CONTRACT,
      decision: 'ALLOW_GOOGLE_SIGN_IN',
    });
  });

  it('allows an existing user only when Google is already linked', async () => {
    const { service } = setup(['password', 'google.com']);
    await expect(service(request())).resolves.toMatchObject({ decision: 'ALLOW_GOOGLE_SIGN_IN' });
  });

  it('requires explicit linking for an existing password-only account', async () => {
    const { service } = setup(['password']);
    await expect(service(request())).resolves.toMatchObject({
      decision: 'EXISTING_ACCOUNT_LINK_REQUIRED',
    });
  });

  it('accepts identity proof only and makes arbitrary plain-email lookup impossible', async () => {
    const { service, verifier, directory } = setup();
    await expect(service({ ...request(), email: 'target@example.invalid' })).rejects.toMatchObject({
      code: 'invalid-request',
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(directory.findByEmail).not.toHaveBeenCalled();
  });

  it.each(['malformed token', 'wrong audience', 'expired token'])(
    'denies a %s through supported token verification',
    async () => {
      const { service, verifier, directory } = setup();
      verifier.verify.mockRejectedValue(new GoogleSignInPreflightError('invalid-google-identity'));
      await expect(service(request())).rejects.toMatchObject({
        code: 'invalid-google-identity',
      });
      expect(directory.findByEmail).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ email: undefined, email_verified: true }, 'missing email'],
    [{ email: 'athlete@gmail.com', email_verified: false }, 'unverified email'],
  ])('rejects Google payload with %s', async (payload) => {
    const client = {
      verifyIdToken: vi.fn(async () => ({ getPayload: () => payload })),
    } as unknown as OAuth2Client;
    await expect(
      createGoogleIdentityVerifier(client, 'client-id').verify('token'),
    ).rejects.toMatchObject({ code: 'invalid-google-identity' });
  });

  it('passes the exact configured audience to the supported verifier', async () => {
    const client = {
      verifyIdToken: vi.fn(async () => ({
        getPayload: () => ({ email: ' Athlete@Gmail.com ', email_verified: true }),
      })),
    } as unknown as OAuth2Client;
    await expect(
      createGoogleIdentityVerifier(client, 'web-client-id').verify('token'),
    ).resolves.toEqual({ email: 'athlete@gmail.com' });
    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'token',
      audience: 'web-client-id',
    });
  });

  it('fails closed when the configured audience is absent', async () => {
    const client = { verifyIdToken: vi.fn() } as unknown as OAuth2Client;
    await expect(createGoogleIdentityVerifier(client, ' ').verify('token')).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(client.verifyIdToken).not.toHaveBeenCalled();
  });

  it('maps an Admin user-not-found result without hiding other backend failures', async () => {
    const missing = createFirebaseAuthDirectory({
      getUserByEmail: vi.fn(async () => {
        throw { code: 'auth/user-not-found' };
      }),
    });
    await expect(missing.findByEmail('athlete@gmail.com')).resolves.toBeNull();

    const failed = createFirebaseAuthDirectory({
      getUserByEmail: vi.fn(async () => {
        throw new Error('backend details');
      }),
    });
    await expect(failed.findByEmail('athlete@gmail.com')).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('fails closed on unexpected Admin lookup failure', async () => {
    const { service, directory } = setup();
    directory.findByEmail.mockRejectedValue(new Error('backend details'));
    await expect(service(request())).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('logs no token, verified email, Firebase UID, or provider metadata', async () => {
    const { service, logger } = setup(['password']);
    await service(request('sensitive-google-id-token'));
    const serialized = JSON.stringify(logger.info.mock.calls);
    expect(serialized).not.toContain('sensitive-google-id-token');
    expect(serialized).not.toContain('athlete@gmail.com');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('uid');
  });
});
