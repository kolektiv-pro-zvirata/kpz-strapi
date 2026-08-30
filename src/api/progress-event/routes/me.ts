/**
 * Custom route: the signed-in user's own progress.
 *
 * Kept in its own file (next to the core router) because it is not a CRUD
 * action. The core router deliberately exposes only `create`, so there is no
 * `/progress-events/:id` route that could swallow `/progress-events/me`.
 */
export default {
  routes: [
    {
      method: 'GET',
      path: '/progress-events/me',
      handler: 'progress-event.me',
      config: {
        policies: [],
      },
    },
  ],
};
