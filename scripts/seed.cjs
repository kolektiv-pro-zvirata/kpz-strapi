/**
 * Seeds Strapi with the content bundled in the kpz-app project.
 *
 * Usage (from the kpz-strapi project root):
 *   node scripts/seed.cjs                 # upsert everything (safe to re-run)
 *   SEED_FRESH=1 node scripts/seed.cjs    # wipe seeded content first, then re-create
 *   APP_DIR=/path/to/kpz-app node scripts/seed.cjs
 *
 * It:
 *   1. boots Strapi programmatically,
 *   2. uploads referenced images/videos from kpz-app/assets/content into the media library,
 *   3. creates Type of Experience, Main Category, Experience, Topic, News and Level entries,
 *   4. wires up all relations, and publishes everything.
 *
 * Idempotent: entries are matched by slug (or a natural key) and updated in place,
 * media by file name, so re-running does not create duplicates.
 */

const path = require('node:path');
const fs = require('node:fs');
const { createStrapi, compileStrapi } = require('@strapi/strapi');
const { loadAppContent } = require('./seed/app-content.cjs');
const { mdToBlocks } = require('./seed/md-to-blocks.cjs');

const STRAPI_ROOT = path.resolve(__dirname, '..');
const APP_DIR = process.env.APP_DIR
  ? path.resolve(process.env.APP_DIR)
  : path.resolve(STRAPI_ROOT, '..', 'kpz-app');
const ASSETS_DIR = path.join(APP_DIR, 'assets', 'content');
const FRESH = ['1', 'true', 'yes'].includes(String(process.env.SEED_FRESH).toLowerCase());

const UIDS = {
  type: 'api::type-of-experience.type-of-experience',
  category: 'api::main-category.main-category',
  experience: 'api::experience.experience',
  topic: 'api::topic.topic',
  news: 'api::news.news',
  level: 'api::level.level',
};

/** Map the app's experience `type` to a Type of Experience name. */
const TYPE_LABELS = {
  markdown: 'Recipe',
  video: 'Video',
  quiz: 'Quiz',
  task: 'Task',
};
// All type-of-experience records we want to exist (Task has no source data yet).
const ALL_TYPES = ['Recipe', 'Video', 'Quiz', 'Task'];

// Maps the app's category names to the Strapi color + icon enums (the FE maps
// these enum values to actual colors / SF symbols) plus the list description.
// Unknown categories → schema defaults + empty description.
const APPEARANCE_BY_NAME = {
  Vaření: { color: 'brown', icon: 'fork', description: 'Recepty a tipy do kuchyně' },
  Výživa: { color: 'green', icon: 'leaf', description: 'Bílkoviny, vitamíny a zdraví' },
  Etika: { color: 'purple', icon: 'heart', description: 'Proč na zvířatech záleží' },
  Ekologie: { color: 'teal', icon: 'globe', description: 'Dopady stravy na planetu' },
};

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function main() {
  console.log('› Booting Strapi…');
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error'; // quiet down request/db noise during seeding

  try {
    const content = loadAppContent(APP_DIR);
    console.log(
      `› Loaded app content: ${content.categories.length} categories, ` +
        `${Object.keys(content.experiences).length} experiences, ` +
        `${content.news.length} news, ${content.levelNames.length} levels`
    );

    if (FRESH) await wipe(app);

    const mediaCache = new Map();

    /** Upload an asset by key (relative to assets/content), return the file id or null. */
    async function media(key) {
      if (!key) return null;
      if (mediaCache.has(key)) return mediaCache.get(key);

      const abs = path.join(ASSETS_DIR, key);
      if (!fs.existsSync(abs)) {
        console.warn(`  ⚠ Asset missing, skipping: ${key}`);
        mediaCache.set(key, null);
        return null;
      }

      const name = key.replace(/[\\/]/g, '__'); // unique, stable file name
      const existing = await app.db
        .query('plugin::upload.file')
        .findOne({ where: { name } });
      if (existing) {
        mediaCache.set(key, existing.id);
        return existing.id;
      }

      const ext = path.extname(abs).toLowerCase();
      const stat = fs.statSync(abs);
      const [file] = await app.plugin('upload').service('upload').upload({
        data: { fileInfo: { name } },
        files: {
          filepath: abs,
          originalFileName: name,
          mimetype: MIME[ext] || 'application/octet-stream',
          size: stat.size,
        },
      });
      mediaCache.set(key, file.id);
      return file.id;
    }

    /** Create or update a document matched by `where`, always published. */
    async function upsert(uid, where, data) {
      const existing = await app.documents(uid).findFirst({ filters: where });
      if (existing) {
        return app.documents(uid).update({
          documentId: existing.documentId,
          data,
          status: 'published',
        });
      }
      return app.documents(uid).create({ data, status: 'published' });
    }

    // 1) Type of Experience -------------------------------------------------
    console.log('› Type of Experience…');
    const typeIdByLabel = {};
    for (const label of ALL_TYPES) {
      const doc = await upsert(UIDS.type, { slug: slugify(label) }, {
        name: label,
        slug: slugify(label),
      });
      typeIdByLabel[label] = doc.documentId;
    }

    // 2) Main Categories ----------------------------------------------------
    console.log('› Main Categories…');
    const categoryIdByName = {};
    for (let i = 0; i < content.categories.length; i++) {
      const cat = content.categories[i];
      const look = APPEARANCE_BY_NAME[cat.name] || { color: 'green', icon: 'leaf' };
      const doc = await upsert(UIDS.category, { slug: slugify(cat.name) }, {
        name: cat.name,
        slug: slugify(cat.name),
        description: look.description || null,
        color: look.color,
        icon: look.icon,
        order: i,
      });
      categoryIdByName[cat.name] = doc.documentId;
    }

    // 3) Experiences --------------------------------------------------------
    console.log('› Experiences…');
    const experienceIdByAppId = {};
    for (const [appId, exp] of Object.entries(content.experiences)) {
      const label = TYPE_LABELS[exp.type] || 'Recipe';
      const thumbnailId = await media(exp.thumbnail);
      const videoId = exp.video ? await media(exp.video) : null;

      const quiz = Array.isArray(exp.quiz)
        ? exp.quiz.map((q) => ({
            question: q.question,
            explanation: q.explanation || null,
            answers: (q.answers || []).map((text, idx) => ({
              text,
              isCorrect: idx === 0, // app convention: first answer is the correct one
            })),
          }))
        : [];

      const doc = await upsert(UIDS.experience, { slug: appId }, {
        name: exp.name,
        slug: appId,
        content: mdToBlocks(exp.markdown),
        thumbnail: thumbnailId,
        video: videoId,
        quiz,
        typeOfExperience: typeIdByLabel[label],
      });
      experienceIdByAppId[appId] = doc.documentId;
    }

    // 4) Topics -------------------------------------------------------------
    console.log('› Topics…');
    for (let ci = 0; ci < content.categories.length; ci++) {
      const cat = content.categories[ci];
      const topics = cat.topics || [];
      for (let ti = 0; ti < topics.length; ti++) {
        const topic = topics[ti];
        const imageId = await media(topic.thumbnail);

        const extra =
          (content.topicExtraExperiences && content.topicExtraExperiences[topic.name]) || [];
        const expAppIds = [...(topic.experienceIds || []), ...extra];
        const expDocIds = [];
        for (const id of expAppIds) {
          const docId = experienceIdByAppId[id];
          if (docId) expDocIds.push(docId);
          else console.warn(`  ⚠ Topic "${topic.name}" references unknown experience "${id}"`);
        }

        await upsert(UIDS.topic, { slug: slugify(topic.name) }, {
          title: topic.name,
          slug: slugify(topic.name),
          content: mdToBlocks(topic.info),
          image: imageId,
          order: ti,
          mainCategory: categoryIdByName[cat.name],
          experiences: expDocIds,
        });
      }
    }

    // 5) News ---------------------------------------------------------------
    console.log('› News…');
    for (const item of content.news) {
      const imageId = await media(item.image);
      await upsert(UIDS.news, { slug: item.id }, {
        title: item.title,
        slug: item.id,
        excerpt: item.excerpt || null,
        content: mdToBlocks(item.content),
        image: imageId,
      });
    }

    // 6) Levels -------------------------------------------------------------
    if (content.levelNames.length) {
      console.log('› Levels…');
      for (let i = 0; i < content.levelNames.length; i++) {
        const level = i + 1;
        await upsert(UIDS.level, { level }, {
          level,
          name: content.levelNames[i],
          pointsRequired: i * content.pointsPerLevel,
        });
      }
    }

    console.log('✓ Seed complete.');
  } finally {
    await app.destroy();
  }
}

/** Delete all previously-seeded documents (used with SEED_FRESH=1). */
async function wipe(app) {
  console.log('› SEED_FRESH: removing existing seeded content…');
  for (const uid of Object.values(UIDS)) {
    const docs = await app.documents(uid).findMany({ fields: ['documentId'], limit: -1 });
    for (const d of docs) {
      await app.documents(uid).delete({ documentId: d.documentId });
    }
    console.log(`  – cleared ${docs.length} × ${uid}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Seed failed:', err);
    process.exit(1);
  });
