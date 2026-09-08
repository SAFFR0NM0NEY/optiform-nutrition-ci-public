export const EXTERNAL_IDENTITY_GOOGLE_CONTRACT = 'external-identity-google-v1' as const;
export const ACCOUNT_PROVIDER_LINKING_CONTRACT = 'account-provider-linking-v1' as const;

export const supportedAuthProviders = ['password', 'google.com'] as const;
export type SupportedAuthProvider = (typeof supportedAuthProviders)[number];

export function normalizeAuthProviders(providerIds: readonly unknown[]) {
  return [
    ...new Set(
      providerIds.filter((item): item is SupportedAuthProvider =>
        supportedAuthProviders.includes(item as SupportedAuthProvider),
      ),
    ),
  ].sort();
}

export function canLinkGoogle(providers: readonly SupportedAuthProvider[]) {
  return !providers.includes('google.com');
}

export function canUnlinkGoogle(providers: readonly SupportedAuthProvider[]) {
  return (
    providers.includes('google.com') && providers.some((provider) => provider !== 'google.com')
  );
}

export function providerLabel(provider: SupportedAuthProvider) {
  return provider === 'password' ? 'Email/Password' : 'Google';
}

export function googleAuthEnabled() {
  return import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';
}

export const ACCOUNT_COLLISION_MESSAGE =
  'An Optiform account already exists for this email. Sign in using your existing method, then link Google from Profile → Sign-in methods.';
