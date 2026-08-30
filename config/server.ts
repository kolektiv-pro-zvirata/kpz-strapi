import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  // Public URL + proxy trust: in production Strapi runs behind Roští's reverse
  // proxy, so it must know its external HTTPS address and honour the
  // X-Forwarded-* headers. Locally PUBLIC_URL is unset and both are no-ops.
  url: env('PUBLIC_URL', undefined),
  proxy: env.bool('IS_PROXIED', !!env('PUBLIC_URL')),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;
