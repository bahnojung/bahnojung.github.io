/**
 * collections 변경 감지 → images.json·collections.json 갱신만 (Git/서버 없음)
 * 컬렉션 순서는 폴더 생성 시간 기준으로 정렬됩니다.
 */

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname);
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];

function isImage(name) {
  return IMAGE_EXT.includes(path.extname(name).toLowerCase());
}

function getLeadingNumber(name) {
  const base = path.parse(name).name;
  const m = base.match(/^(\d+(?:\.\d+)?)/);
  return m ? Number.parseFloat(m[1]) : null;
}

function sortImageNamesByNumericAsc(a, b) {
  const an = getLeadingNumber(a);
  const bn = getLeadingNumber(b);
  if (an !== null && bn !== null && an !== bn) return an - bn;
  if (an !== null && bn === null) return -1;
  if (an === null && bn !== null) return 1;
  return a.localeCompare(b, "en", { numeric: true });
}

function sortImageNamesByNumericDesc(a, b) {
  return sortImageNamesByNumericAsc(b, a);
}

async function getCollectionSortOrder(collectionId) {
  const file = path.join(ROOT, "collections", collectionId, "about.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const about = JSON.parse(raw);
    return String(about.sort || "").toLowerCase() === "desc" ? "desc" : "asc";
  } catch {
    return "asc";
  }
}

async function getCollectionDirs() {
  const dir = path.join(ROOT, "collections");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function getCollectionDirsByCreationOrder() {
  const dir = path.join(ROOT, "collections");
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const withBirth = await Promise.all(
      dirs.map(async (e) => {
        const stat = await fs.stat(path.join(dir, e.name));
        // 폴더 생성 시간 기준 정렬 (생성 시간이 없으면 mtime 대체)
        const t = (stat.birthtime && stat.birthtime.getTime)
          ? stat.birthtime.getTime()
          : ((stat.mtime && stat.mtime.getTime) ? stat.mtime.getTime() : 0);
        return { id: e.name, birthtime: t };
      })
    );
    // 최근 생성된 컬렉션이 위, 먼저 생성된 컬렉션이 아래
    withBirth.sort((a, b) => b.birthtime - a.birthtime);
    return withBirth.map((d) => d.id);
  } catch {
    return [];
  }
}

async function getCollectionImageList(collectionId) {
  const dir = path.join(ROOT, "collections", collectionId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return [];
  }
}

async function getCollectionJsonList(collectionId) {
  const file = path.join(ROOT, "collections", collectionId, "images.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    return (list || [])
      .filter((item) => item && item.src)
      .map((item) => path.basename(item.src))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch {
    return null;
  }
}

/** images.json 안의 src가 모두 현재 폴더명(id)과 일치하는지 검사. 이름 변경 시 false */
async function imagesJsonPathsMatchId(collectionId) {
  const file = path.join(ROOT, "collections", collectionId, "images.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : (data.images || []);
    const srcList = (list || []).filter((item) => item && item.src).map((item) => item.src);
    if (srcList.length === 0) return true;
    const prefix = `collections/${collectionId}/`;
    return srcList.every((src) => src.startsWith(prefix));
  } catch {
    return false;
  }
}

function arraysEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

async function loadCollectionsJson() {
  const file = path.join(ROOT, "collections.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCollectionsJson(list) {
  const file = path.join(ROOT, "collections.json");
  await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
}

const SITE_ORIGIN = "https://bahnojung.github.io";

function formatSitemapDate(date) {
  return date.toISOString().slice(0, 10);
}

async function getPathLastmod(relPath) {
  try {
    const stat = await fs.stat(path.join(ROOT, relPath));
    return formatSitemapDate(stat.mtime);
  } catch {
    return formatSitemapDate(new Date());
  }
}

async function getCollectionLastmod(collectionId) {
  const dir = path.join(ROOT, "collections", collectionId);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let newest = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name === "images.json" || e.name === "about.json") continue;
      if (!isImage(e.name)) continue;
      try {
        const stat = await fs.stat(path.join(dir, e.name));
        newest = Math.max(newest, stat.mtimeMs || 0);
      } catch {
        /* ignore */
      }
    }
    if (!newest) {
      const stat = await fs.stat(dir);
      newest = stat.mtimeMs || Date.now();
    }
    return formatSitemapDate(new Date(newest));
  } catch {
    return formatSitemapDate(new Date());
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** encodeURIComponent는 ' 를 남기므로 사이트맵 URL용으로 %27 처리 */
function collectionLoc(collectionId) {
  const q = encodeURIComponent(collectionId).replace(/'/g, "%27");
  return `${SITE_ORIGIN}/collection.html?collection=${q}`;
}

/** collections.json 기준으로 sitemap.xml 생성 (컬렉션·사진 변경 시 lastmod 갱신) */
async function generateSitemap(collections) {
  const urls = [];

  urls.push({
    loc: `${SITE_ORIGIN}/`,
    lastmod: await getPathLastmod("index.html"),
    changefreq: "weekly",
    priority: "1.0",
  });

  try {
    await fs.access(path.join(ROOT, "wall.html"));
    urls.push({
      loc: `${SITE_ORIGIN}/wall.html`,
      lastmod: await getPathLastmod("wall.html"),
      changefreq: "monthly",
      priority: "0.6",
    });
  } catch {
    /* wall.html 없음 */
  }

  for (const c of collections || []) {
    if (!c || !c.id) continue;
    urls.push({
      loc: collectionLoc(c.id),
      lastmod: await getCollectionLastmod(c.id),
      changefreq: "monthly",
      priority: "0.8",
    });
  }

  const body = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

  const outFile = path.join(ROOT, "sitemap.xml");
  let prev = null;
  try {
    prev = await fs.readFile(outFile, "utf8");
  } catch {
    prev = null;
  }
  if (prev === xml) return false;
  await fs.writeFile(outFile, xml, "utf8");
  return true;
}

function run(cmd, cwd = ROOT) {
  execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

/** 컬렉션 폴더의 사진 목록을 읽어 images.json 생성/갱신 (프로세스 분리 없이 직접 실행) */
async function generateCollectionImagesJson(collectionId) {
  const dir = path.join(ROOT, "collections", collectionId);
  const outFile = path.join(dir, "images.json");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {}
  const sortOrder = await getCollectionSortOrder(collectionId);
  const sorter =
    sortOrder === "desc" ? sortImageNamesByNumericDesc : sortImageNamesByNumericAsc;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name !== "images.json" && isImage(e.name))
    .map((e) => e.name)
    .sort(sorter);
  const data = files.map((file) => ({
    src: `collections/${collectionId}/${file}`,
    alt: path.parse(file).name,
  }));
  await fs.writeFile(outFile, JSON.stringify(data, null, 2), "utf8");
  return data.length;
}

async function runSync() {
  process.chdir(ROOT);
  console.log("📷 collections 동기화\n");
  console.log("   작업 폴더:", ROOT, "\n");

  let changed = false;

  const collectionDirs = await getCollectionDirs();
  let collections = await loadCollectionsJson();
  const byId = new Map(collections.map((c) => [c.id, c]));

  const kept = collections.filter((c) => collectionDirs.includes(c.id));
  if (kept.length !== collections.length) {
    collections = kept;
    byId.clear();
    collections.forEach((c) => byId.set(c.id, c));
    changed = true;
    console.log("📁 삭제된 컬렉션 폴더 반영 (collections.json 정리)");
  }

  const newIds = new Set();
  for (const id of collectionDirs) {
    if (byId.has(id)) continue;
    newIds.add(id);
    byId.set(id, {
      id,
      name: id,
      path: `collection.html?collection=${encodeURIComponent(id)}`,
    });
    changed = true;
    console.log(`📁 새 컬렉션 추가: ${id}`);
  }

  // collections.json에 적어 둔 순서를 유지 (새 컬렉션만 맨 앞에 추가)
  const orderedIds = [];
  for (const c of collections) {
    if (collectionDirs.includes(c.id)) orderedIds.push(c.id);
  }
  for (const id of collectionDirs) {
    if (!orderedIds.includes(id)) orderedIds.unshift(id);
  }
  const ordered = orderedIds.map((id) => ({
    ...byId.get(id),
    path: `collection.html?collection=${encodeURIComponent(id)}`,
  }));
  await saveCollectionsJson(ordered);

  // 모든 컬렉션의 images.json을 매번 재생성 (사진 추가/삭제/변경 반영)
  for (const id of collectionDirs) {
    try {
      const count = await generateCollectionImagesJson(id);
      console.log(`🖼 컬렉션 "${id}" → images.json 갱신 (${count}개 이미지)`);
      changed = true;
    } catch (err) {
      console.error(`❌ 컬렉션 "${id}" images.json 생성 실패:`, err.message);
    }
  }

  try {
    const sitemapChanged = await generateSitemap(ordered);
    if (sitemapChanged) {
      changed = true;
      console.log(`🗺 sitemap.xml 갱신 (${ordered.length}개 컬렉션)`);
    } else {
      console.log("🗺 sitemap.xml 변경 없음");
    }
  } catch (err) {
    console.error("❌ sitemap.xml 생성 실패:", err.message);
  }

  if (!changed) {
    console.log("\n✅ 적용할 변경 없음 (컬렉션 폴더 없음).");
  } else {
    console.log("\n✅ 모든 컬렉션 갱신 완료.");
  }

  return changed;
}

module.exports = { runSync, generateSitemap };
