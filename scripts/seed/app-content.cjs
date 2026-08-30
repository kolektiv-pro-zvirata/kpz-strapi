// Reads the kpz-app content sources (TypeScript) and returns plain JS data for seeding.
//
// The app keeps its content in TS files (not JSON):
//   - src/content/generated/data.ts   → `categories` + `experiences`
//   - src/content/extra.ts            → `extraExperiences` + `topicExtraExperiences`
//   - src/state/news.ts               → `NEWS`
//   - src/constants/category-visuals.ts → `CATEGORY_VISUALS`
//   - src/constants/levels.ts         → `LEVEL_NAMES` + `POINTS_PER_LEVEL`
//
// We slice the exported object/array literals out of each file (balanced-bracket
// scan that is string-aware), turn `require('@/assets/content/…')` calls into plain
// asset-key strings, and eval the literal. No app runtime / bundler needed.

const fs = require('node:fs');
const path = require('node:path');

/** Turn `require('@/assets/content/x/y.jpg')` → the asset key `x/y.jpg`. */
function assetKey(p) {
  return p.replace(/^@\/assets\/content\//, '').replace(/^\/+/, '');
}

/** Replace every require(...) with a JSON string of its normalized asset key. */
function transformRequires(code) {
  return code.replace(/require\(\s*(['"])(.*?)\1\s*\)/g, (_, _q, p) =>
    JSON.stringify(assetKey(p))
  );
}

/**
 * Extract the object/array literal assigned to `const <declName> = …` from source.
 * String-aware bracket matching so markdown/backtick bodies don't confuse it.
 */
function sliceLiteral(src, declName) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${declName}\\b[^=]*?=\\s*`);
  const m = re.exec(src);
  if (!m) throw new Error(`Declaration "${declName}" not found`);

  const start = m.index + m[0].length;
  const open = src[start];
  if (open !== '[' && open !== '{') {
    throw new Error(`Expected [ or { for "${declName}", got "${open}"`);
  }

  let depth = 0;
  let str = null; // active quote char, or null
  let esc = false;

  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      str = c;
    } else if (c === '[' || c === '{') {
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced literal for "${declName}"`);
}

/** Read a TS file and eval the named literal into a JS value. */
function readLiteral(file, declName) {
  const src = fs.readFileSync(file, 'utf8');
  const literal = transformRequires(sliceLiteral(src, declName));
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${literal});`)();
}

function loadAppContent(appDir) {
  const dataFile = path.join(appDir, 'src/content/generated/data.ts');
  const extraFile = path.join(appDir, 'src/content/extra.ts');
  const newsFile = path.join(appDir, 'src/state/news.ts');
  const levelsFile = path.join(appDir, 'src/constants/levels.ts');

  for (const f of [dataFile, newsFile]) {
    if (!fs.existsSync(f)) {
      throw new Error(`Expected app content file not found: ${f}`);
    }
  }

  const categories = readLiteral(dataFile, 'categories');
  const experiences = readLiteral(dataFile, 'experiences');

  let extraExperiences = {};
  let topicExtraExperiences = {};
  if (fs.existsSync(extraFile)) {
    try {
      extraExperiences = readLiteral(extraFile, 'extraExperiences');
      topicExtraExperiences = readLiteral(extraFile, 'topicExtraExperiences');
    } catch (e) {
      console.warn(`  ⚠ Could not read extra.ts: ${e.message}`);
    }
  }

  const news = readLiteral(newsFile, 'NEWS');

  let levelNames = [];
  let pointsPerLevel = 4;
  if (fs.existsSync(levelsFile)) {
    try {
      levelNames = readLiteral(levelsFile, 'LEVEL_NAMES');
      const src = fs.readFileSync(levelsFile, 'utf8');
      const m = /POINTS_PER_LEVEL\s*=\s*(\d+)/.exec(src);
      if (m) pointsPerLevel = Number(m[1]);
    } catch (e) {
      console.warn(`  ⚠ Could not read levels.ts: ${e.message}`);
    }
  }

  // Merge generated + manually-authored experiences.
  const allExperiences = { ...experiences, ...extraExperiences };

  return {
    categories,
    experiences: allExperiences,
    topicExtraExperiences,
    news,
    levelNames,
    pointsPerLevel,
  };
}

module.exports = { loadAppContent };
