/**
 * One-off migration: convert every pre-existing PNG/JPEG upload (and its
 * generated formats) to WebP, in place. New uploads are already handled by
 * strapi-plugin-webp-converter (see config/plugins.ts) — this only backfills
 * what was uploaded before that plugin existed.
 *
 * Runs from `bootstrap()` in src/index.ts, production only, and only when a
 * draft News entry with slug `images-webp-migration` exists — create it in
 * the admin (save as draft, never publish) to trigger a run. This is a
 * manual, explicit gate on purpose: without it the migration would re-scan
 * the whole upload table on every deploy/restart forever.
 *
 * It processes a small batch per `id > checkpoint` query, so it is safe to
 * resume after a crash or redeploy: already-converted files no longer match
 * `ext IN (.png, .jpg, .jpeg)` and are never re-selected, and the checkpoint
 * file just avoids re-querying from id 0 every time (losing it costs an
 * extra scan, not correctness).
 *
 * Assumes the local filesystem upload provider (this project's only provider
 * — see docker-compose's `./strapi-uploads:/opt/app/public` bind mount): the
 * original is read straight off disk (never over HTTP — `bootstrap()` runs
 * before Strapi's HTTP server is listening, so fetching the app's own public
 * URL from inside bootstrap 502s), and a file saved as `<hash>.webp` is
 * always served at `/uploads/<hash>.webp`. A provider switch (e.g. to S3)
 * would need both of those rewritten.
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

import sharp from 'sharp';
import type { Core } from '@strapi/strapi';

const CHECKPOINT_PATH = path.join(process.cwd(), 'temp', 'webp-migration-progress.json');
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
const BATCH_SIZE = 20;
const QUALITY = 80;

interface UploadFileRecord {
  id: number;
  name: string;
  hash: string;
  ext: string | null;
  mime: string | null;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  formats: Record<string, { url?: string }> | null;
}

interface UploadableFile {
  name: string;
  hash: string;
  ext: string;
  mime: string;
  size: number;
  getStream: () => NodeJS.ReadableStream;
}

type UploadProvider = {
  upload: (file: UploadableFile) => Promise<void>;
};

export async function migrateWebpImages({ strapi }: { strapi: Core.Strapi }) {
  if (process.env.NODE_ENV === 'development') return;

  // Manual trigger: only runs when a draft News entry with this slug exists.
  // Create it (title anything, slug exactly this, save as draft — do NOT
  // publish) in the admin to kick off a run; it is left untouched afterwards,
  // so delete or publish it yourself once you've confirmed the run finished —
  // otherwise it fires again on every subsequent boot (harmless once there is
  // nothing left to convert, but still a wasted full table scan each time).
  const TRIGGER_SLUG = 'images-webp-migration';
  const trigger = await strapi.db.query('api::news.news').findOne({
    where: { slug: TRIGGER_SLUG, publishedAt: null },
  });
  if (!trigger) {
    strapi.log.info(`[webp-migration] no draft News with slug "${TRIGGER_SLUG}", skipping`);
    return;
  }

  strapi.log.info('[webp-migration] starting');

  const provider = strapi.plugin('upload').service('provider') as UploadProvider;
  const tempDir = path.join(process.cwd(), 'temp');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  } else {
    cleanTempFolder(tempDir);
  }

  let lastProcessedId = 0;
  if (fs.existsSync(CHECKPOINT_PATH)) {
    lastProcessedId = (JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf-8')).lastId as number) || 0;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const files: UploadFileRecord[] = await strapi.db.query('plugin::upload.file').findMany({
      where: { id: { $gt: lastProcessedId }, ext: { $in: ALLOWED_EXTENSIONS } },
      orderBy: { id: 'asc' },
      limit: BATCH_SIZE,
    });

    if (!files.length) break;

    for (const file of files) {
      lastProcessedId = file.id;

      let webpTempPath: string | null = null;
      let thumbTempPath: string | null = null;
      const formatTempPaths: string[] = [];

      try {
        if (!file.ext || !ALLOWED_EXTENSIONS.includes(file.ext.toLowerCase())) {
          saveCheckpoint(lastProcessedId);
          continue;
        }

        strapi.log.info(`[webp-migration] converting id ${file.id}`);

        const inputBuffer = fs.readFileSync(path.join(strapi.dirs.static.public, file.url));

        const newHash = file.hash;
        const webpFilename = `${newHash}.webp`;
        webpTempPath = path.join(tempDir, webpFilename);

        const converted = await sharp(inputBuffer).webp({ quality: QUALITY }).toFile(webpTempPath);

        const sizeInKb = converted.size / 1024;

        const oldFilesToDelete: string[] = [];
        if (file.formats) {
          for (const key of Object.keys(file.formats)) {
            const url = file.formats[key]?.url;
            if (url) oldFilesToDelete.push(url);
          }
        }
        oldFilesToDelete.push(file.url);

        await uploadFile(provider, webpTempPath, webpFilename, converted.size);

        const uploadedFormats: Record<string, unknown> = {};

        // Thumbnail — Strapi's own default breakpoint.
        const THUMBNAIL_SIZE = 245;
        const thumbHash = `thumbnail_${newHash}`;
        const thumbFilename = `${thumbHash}.webp`;
        thumbTempPath = path.join(tempDir, thumbFilename);

        const resizedThumb = await sharp(webpTempPath)
          .resize({ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(thumbTempPath);

        if (resizedThumb.width !== converted.width || resizedThumb.height !== converted.height) {
          await uploadFile(provider, thumbTempPath, thumbFilename, resizedThumb.size);

          uploadedFormats.thumbnail = {
            ext: '.webp',
            url: `/uploads/${thumbFilename}`,
            hash: thumbHash,
            mime: 'image/webp',
            name: thumbFilename,
            size: resizedThumb.size / 1024,
            width: resizedThumb.width,
            height: resizedThumb.height,
            sizeInBytes: resizedThumb.size,
          };
        }

        // Strapi's other default breakpoints — only generated if the source is larger.
        const breakpoints: Record<string, number> = { large: 1000, medium: 750, small: 500 };

        for (const [key, breakpoint] of Object.entries(breakpoints)) {
          if (!converted.width || converted.width <= breakpoint) continue;

          const formatHash = `${key}_${newHash}`;
          const formatFilename = `${formatHash}.webp`;
          const formatTempPath = path.join(tempDir, formatFilename);
          formatTempPaths.push(formatTempPath);

          const resized = await sharp(webpTempPath)
            .resize({ width: breakpoint, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: QUALITY })
            .toFile(formatTempPath);

          await uploadFile(provider, formatTempPath, formatFilename, resized.size);

          uploadedFormats[key] = {
            ext: '.webp',
            url: `/uploads/${formatFilename}`,
            hash: formatHash,
            mime: 'image/webp',
            name: formatFilename,
            size: resized.size / 1024,
            width: resized.width,
            height: resized.height,
            sizeInBytes: resized.size,
          };
        }

        await strapi.db.query('plugin::upload.file').update({
          where: { id: file.id },
          data: {
            name: file.name.replace(/\.\w+$/, '.webp'),
            ext: '.webp',
            mime: 'image/webp',
            size: sizeInKb,
            width: converted.width,
            height: converted.height,
            formats: uploadedFormats,
            url: `/uploads/${webpFilename}`,
          },
        });

        for (const url of oldFilesToDelete) {
          await safeDelete(strapi, url);
        }

        strapi.log.info(`[webp-migration] converted id ${file.id}`);
        saveCheckpoint(lastProcessedId);
      } catch (error) {
        strapi.log.error(`[webp-migration] failed on id ${file.id}`, error as Error);
        saveCheckpoint(lastProcessedId);
        throw error;
      } finally {
        cleanupFile(webpTempPath);
        cleanupFile(thumbTempPath);
        formatTempPaths.forEach(cleanupFile);
      }
    }
  }

  strapi.log.info('[webp-migration] completed');
  cleanTempFolder(tempDir);
}

async function uploadFile(provider: UploadProvider, filePath: string, filename: string, size: number) {
  const buffer = fs.readFileSync(filePath);
  return provider.upload({
    name: filename,
    hash: path.basename(filename, '.webp'),
    ext: '.webp',
    mime: 'image/webp',
    size,
    getStream: () => Readable.from(buffer),
  });
}

async function safeDelete(strapi: Core.Strapi, url: string) {
  const publicDir = strapi.dirs.static.public;
  const filePath = path.join(publicDir, url);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function cleanupFile(filePath: string | null) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function saveCheckpoint(lastId: number) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ lastId }));
}

function cleanTempFolder(tempDir: string) {
  for (const entry of fs.readdirSync(tempDir)) {
    const filePath = path.join(tempDir, entry);
    try {
      if (fs.lstatSync(filePath).isFile()) fs.unlinkSync(filePath);
    } catch (e) {
      console.warn(`[webp-migration] failed to clean ${filePath}`, e);
    }
  }
}
