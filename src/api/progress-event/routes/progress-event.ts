import { factories } from '@strapi/strapi';

// Events are append-only: the app only ever appends them. No update/delete over
// the REST API — history must stay intact. `find`/`findOne` are not exposed
// either: reading is done through the custom `GET /progress-events/me` route
// (see routes/me.ts), which is scoped to the caller's own events. Leaving
// `findOne` out also keeps `/progress-events/:id` from shadowing `/me`.
export default factories.createCoreRouter('api::progress-event.progress-event', {
  only: ['create'],
});
