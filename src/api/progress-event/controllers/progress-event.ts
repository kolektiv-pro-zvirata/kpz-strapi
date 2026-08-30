import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::progress-event.progress-event',
  ({ strapi }) => ({
    /**
     * The app only ever creates events. The owning user always comes from the
     * JWT — never from the request body — so nobody can write history for
     * someone else. `clientEventId` makes retries idempotent: the app may send
     * its offline queue twice (e.g. the connection drops mid-sync) and the
     * duplicate is answered with the already-stored event instead of an error.
     */
    async create(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) return ctx.unauthorized();

      const body = (ctx.request.body?.data ?? {}) as Record<string, unknown>;

      const clientEventId = body.clientEventId;
      if (typeof clientEventId === 'string' && clientEventId) {
        const existing = await strapi
          .documents('api::progress-event.progress-event')
          .findFirst({ filters: { clientEventId } });
        if (existing) {
          const sanitized = (await this.sanitizeOutput?.(existing, ctx)) ?? existing;
          return this.transformResponse?.(sanitized) ?? { data: sanitized };
        }
      }

      // Drop everything the client may not write (including any `user` it
      // tries to smuggle in), then attach the user from the JWT ourselves —
      // input sanitization rejects `user` in the request body, so the create
      // goes through the documents API instead of the core action.
      const input = ((await this.sanitizeInput?.(body, ctx)) ?? body) as Record<string, unknown>;
      const created = await strapi
        .documents('api::progress-event.progress-event')
        .create({ data: { ...input, user: userId } as any });

      const sanitized = (await this.sanitizeOutput?.(created, ctx)) ?? created;
      ctx.status = 201;
      return this.transformResponse?.(sanitized) ?? { data: sanitized };
    },

    /**
     * `GET /progress-events/me` — the caller's current progress, derived by
     * replaying their own event log in chronological order.
     *
     * The log is append-only, so the completed set is not stored anywhere: a
     * `completed` event adds a slug and a `reset` clears everything before it.
     * The user comes from the JWT, so this can only ever return the caller's
     * own history.
     *
     * Response: `{ data: { completed: string[], points: number } }`
     */
    async me(ctx) {
      const userId = ctx.state.user?.id;
      if (!userId) return ctx.unauthorized();

      // Read the whole log page by page — a long-time user can accumulate more
      // events than a single default-limited query would return.
      const PAGE = 500;
      const events: { type: string; experienceSlug?: string | null }[] = [];
      for (let start = 0; ; start += PAGE) {
        const page = await strapi.documents('api::progress-event.progress-event').findMany({
          filters: { user: { id: userId } },
          fields: ['type', 'experienceSlug', 'occurredAt'],
          sort: ['occurredAt:asc', 'id:asc'],
          start,
          limit: PAGE,
        });
        events.push(...(page as any[]));
        if (page.length < PAGE) break;
      }

      const completed = new Set<string>();
      for (const event of events) {
        if (event.type === 'reset') completed.clear();
        else if (event.experienceSlug) completed.add(event.experienceSlug);
      }

      return { data: { completed: [...completed], points: completed.size } };
    },
  }),
);
