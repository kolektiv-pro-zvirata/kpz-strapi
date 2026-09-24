import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  'users-permissions': {
    config: {
      jwtManagement: 'refresh',
      sessions: {
        // The API's only client is the React Native app, which has no cookie
        // jar — the rotated refresh token must come back in the response body
        // (httpOnly cookies are a browser-only protection).
        httpOnly: false,
      },
      callback: {
        /**
         * Where `/api/connect/:provider?callback=…` is allowed to send the
         * browser once the OAuth dance is done.
         *
         * The stock validator compares `origin` and `pathname`. That works for
         * https callbacks but silently stops validating for custom schemes:
         * `new URL('kpzapp://auth')` and `new URL('evil://auth')` both yield
         * origin `null` and an empty pathname, so they compare equal and any
         * attacker-supplied scheme would be handed the access token.
         *
         * So: https callbacks keep origin+pathname matching, and app callbacks
         * must match one of the prefixes below exactly.
         *
         *   kpzapp://  — the built app (see `scheme` in app.json)
         *   exp://     — Expo Go during development, hence dev-only
         */
        validate(callback: string, provider: { callback?: string }) {
          const APP_PREFIXES = ['kpzapp://'];
          if (process.env.NODE_ENV !== 'production') {
            APP_PREFIXES.push('exp://');
          }

          if (APP_PREFIXES.some((prefix) => callback.startsWith(prefix))) return;

          let target: URL;
          let configured: URL;
          try {
            target = new URL(callback);
            configured = new URL(provider.callback ?? '');
          } catch {
            throw new Error('The callback is not a valid URL');
          }
          if (target.origin === 'null' || configured.origin === 'null') {
            throw new Error('Forbidden callback provided: unknown scheme.');
          }
          if (target.origin !== configured.origin) {
            throw new Error("Forbidden callback provided: origins don't match.");
          }
          if (target.pathname !== configured.pathname) {
            throw new Error("Forbidden callback provided: pathname doesn't match.");
          }
        },
      },
    },
  },
  upload: {
    config: {
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes: deniedExecutableTypes,
      },
    },
  },
});

export default config;
