/**
 * Account linking for third-party sign-in.
 *
 * Strapi's stock `providers.connect` matches an existing user on **email AND
 * provider together**. So somebody who registered with a password and later
 * taps "Sign in with Google" hits `Email is already taken.` and cannot get in —
 * the two records are treated as different people even though it is one human
 * with one mailbox. Turning off `unique_email` is worse: it creates a second
 * account, and this app hangs progress off `user.id`, so the user would lose
 * every completed experience.
 *
 * This override keeps one account per email address and attaches the provider
 * to it.
 *
 * ## Why not link every provider automatically
 *
 * Linking on email alone is an account-takeover path when the provider does not
 * guarantee the address belongs to the person signing in. Google and Apple do
 * (Google requires a verified address on the account; Apple issues the address
 * itself). Facebook historically did not, and Strapi's built-in Facebook
 * profile mapper does not return a verification flag at all, so there is
 * nothing to check even if we wanted to.
 *
 * Providers listed in `TRUSTED_PROVIDERS` therefore link silently. Anything
 * else is refused with a message telling the user to sign in with their
 * password first — deliberately a dead end rather than a silent takeover.
 */

const TRUSTED_PROVIDERS = ['google', 'apple'];

/** Message the app matches on to offer "sign in with your password instead". */
const UNTRUSTED_LINK_ERROR =
  'Tento e-mail už u nás účet má. Přihlas se prosím heslem — účty pak propojíme.';

export default (plugin: any) => {
  addDeleteMe(plugin);

  const baseProvidersFactory = plugin.services.providers;

  plugin.services.providers = ({ strapi }: { strapi: any }) => {
    const base = baseProvidersFactory({ strapi });

    /** Same as the plugin's internal helper, which is not exported. */
    const getProfile = async (provider: string, query: any) => {
      const accessToken = query.access_token || query.code || query.oauth_token;
      const providers = await strapi
        .store({ type: 'plugin', name: 'users-permissions', key: 'grant' })
        .get();
      return strapi
        .plugin('users-permissions')
        .service('providers-registry')
        .run({ provider, query, accessToken, providers });
    };

    return {
      ...base,

      async connect(provider: string, query: any) {
        const accessToken = query.access_token || query.code || query.oauth_token;
        if (!accessToken) throw new Error('No access_token.');

        const profile = await getProfile(provider, query);
        const email = String(profile.email ?? '').toLowerCase();
        if (!email) throw new Error('Email was not available.');

        const userQuery = strapi.db.query('plugin::users-permissions.user');
        const existing = await userQuery.findMany({ where: { email } });

        // Already signed in with this exact provider before — nothing to do.
        const sameProvider = existing.find((u: any) => u.provider === provider);
        if (sameProvider) {
          if (sameProvider.blocked) throw new Error('Your account has been blocked.');
          return sameProvider;
        }

        const advanced = await strapi
          .store({ type: 'plugin', name: 'users-permissions', key: 'advanced' })
          .get();

        if (existing.length === 0) {
          if (!advanced.allow_register) {
            throw new Error('Register action is actually not available.');
          }
          return createUser(strapi, { profile, email, provider, advanced });
        }

        // The email is known under a different provider (typically 'local').
        const [user] = existing;
        if (user.blocked) throw new Error('Your account has been blocked.');

        if (!TRUSTED_PROVIDERS.includes(provider)) {
          throw new Error(UNTRUSTED_LINK_ERROR);
        }

        // Link: keep the same user id (and therefore all their progress), just
        // record which provider they came in with. `confirmed` is set because
        // the provider has already established they control the mailbox.
        strapi.log.info(
          `[users-permissions] linking ${provider} to existing user ${user.id} (${email})`,
        );
        return userQuery.update({
          where: { id: user.id },
          data: { provider, confirmed: true },
        });
      },
    };
  };

  return plugin;
};

/** Mirrors the plugin's own user creation for a first-time provider sign-in. */
async function createUser(
  strapi: any,
  {
    profile,
    email,
    provider,
    advanced,
  }: { profile: any; email: string; provider: string; advanced: any },
) {
  const defaultRole = await strapi.db
    .query('plugin::users-permissions.role')
    .findOne({ where: { type: advanced.default_role } });

  const base = (profile.username && String(profile.username).trim()) || email.split('@')[0];
  const username = await findValidUsername(strapi, base);

  return strapi.db.query('plugin::users-permissions.user').create({
    data: { ...profile, username, email, provider, role: defaultRole.id, confirmed: true },
  });
}

/** Append a suffix until the username is free, like the plugin does. */
async function findValidUsername(strapi: any, base: string) {
  const userQuery = strapi.db.query('plugin::users-permissions.user');
  let candidate = base;
  for (let i = 0; i < 20; i++) {
    const taken = await userQuery.findOne({ where: { username: candidate } });
    if (!taken) return candidate;
    candidate = `${base}${Math.floor(Math.random() * 10000)}`;
  }
  return `${base}${Date.now()}`;
}


/**
 * `DELETE /users/me` — the caller deletes their own account.
 *
 * The id comes from the JWT, never from the path, so this can only ever remove
 * the caller. That is also why the stock `DELETE /users/:id` (the `destroy`
 * action) stays ungranted: handing it to signed-in users would let anyone
 * delete anyone by guessing an id.
 *
 * The route is **unshifted**, not pushed: `/users/:id` is already registered
 * and would otherwise match `/users/me` first, with `:id = 'me'`.
 */
function addDeleteMe(plugin: any) {
  plugin.controllers.user.deleteMe = async (ctx: any) => {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized();

    // The progress log has a required relation to the user, so it goes first.
    const removed = await strapi.db
      .query('api::progress-event.progress-event')
      .deleteMany({ where: { user: userId } });

    await strapi.db.query('plugin::users-permissions.user').delete({ where: { id: userId } });

    strapi.log.info(
      `[users-permissions] user ${userId} deleted their account (${removed?.count ?? 0} progress events)`,
    );
    ctx.status = 204;
  };

  plugin.routes['content-api'].routes.unshift({
    method: 'DELETE',
    path: '/users/me',
    handler: 'user.deleteMe',
    config: { prefix: '', policies: [] },
  });
}
