import type { Core } from '@strapi/strapi';

const config: Core.Config.Middlewares = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  {
    name: 'strapi::session',
    config: {
      cookie: {
        // Roští's reverse proxy terminates HTTPS; the hop it forwards to this
        // container is plain HTTP and doesn't reliably surface that via
        // X-Forwarded-Proto, so Koa sees the request as insecure and refuses
        // to set a "secure" cookie — even though the real, browser-facing
        // connection genuinely is HTTPS. This only affects the transient
        // session cookie used during the OAuth (Google/Facebook) redirect
        // dance, not the app's own JWTs.
        secure: false,
      },
    },
  },
  'strapi::favicon',
  'strapi::public',
];

export default config;
