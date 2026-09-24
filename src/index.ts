import type { Core } from '@strapi/strapi';

// Content types the mobile app reads over the public REST API.
const PUBLIC_READABLE_UIDS = [
  'api::main-category.main-category',
  'api::topic.topic',
  'api::experience.experience',
  'api::news.news',
  'api::level.level',
];
const PUBLIC_ACTIONS = ['find', 'findOne'];
// Single types only ever expose `find`.
const PUBLIC_READABLE_SINGLE_UIDS = [
  'api::point-setting.point-setting',
  'api::consent.consent',
];

// Signed-in users may append their progress events and read back their own
// (the controller takes the user from the JWT in both cases, so they can never
// touch anyone else's history). `me` restores progress after a reinstall or on
// a second device.
const AUTHENTICATED_GRANTS = [
  { uid: 'api::progress-event.progress-event', actions: ['create', 'me'] },
  // Account deletion. `destroy` stays ungranted on purpose — see the
  // users-permissions extension.
  { uid: 'plugin::users-permissions.user', actions: ['deleteMe'] },
];

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
    const grant = async (roleType: string, uid: string, actions: string[]) => {
      const role = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: roleType } });
      if (!role) return;

      for (const action of actions) {
        const permAction = `${uid}.${action}`;
        const existing = await strapi
          .query('plugin::users-permissions.permission')
          .findOne({ where: { action: permAction, role: role.id } });

        if (!existing) {
          await strapi.query('plugin::users-permissions.permission').create({
            data: { action: permAction, role: role.id },
          });
          strapi.log.info(`[bootstrap] granted ${roleType} permission: ${permAction}`);
        }
      }
    };

    for (const uid of PUBLIC_READABLE_UIDS) {
      await grant('public', uid, PUBLIC_ACTIONS);
    }
    for (const uid of PUBLIC_READABLE_SINGLE_UIDS) {
      await grant('public', uid, ['find']);
    }
    for (const { uid, actions } of AUTHENTICATED_GRANTS) {
      await grant('authenticated', uid, actions);
    }
  },
};
