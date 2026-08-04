import type { Core } from '@strapi/strapi';

// Content types the mobile app reads over the public REST API.
const PUBLIC_READABLE_UIDS = [
  'api::main-category.main-category',
  'api::topic.topic',
  'api::experience.experience',
  'api::type-of-experience.type-of-experience',
  'api::news.news',
  'api::level.level',
];
const PUBLIC_ACTIONS = ['find', 'findOne'];

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * Runs before the app starts. Grants the Public role read access
   * (find / findOne) to the content types the mobile app fetches, so the
   * permissions are reproducible across machines / CI instead of being
   * clicked manually in the admin.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });

    if (!publicRole) return;

    for (const uid of PUBLIC_READABLE_UIDS) {
      for (const action of PUBLIC_ACTIONS) {
        const permAction = `${uid}.${action}`;
        const existing = await strapi
          .query('plugin::users-permissions.permission')
          .findOne({ where: { action: permAction, role: publicRole.id } });

        if (!existing) {
          await strapi.query('plugin::users-permissions.permission').create({
            data: { action: permAction, role: publicRole.id },
          });
          strapi.log.info(`[bootstrap] granted public permission: ${permAction}`);
        }
      }
    }
  },
};
