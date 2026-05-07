import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const indexPath = path.join(root, "data", "donations-index.json");
const detailsDir = path.join(root, "data", "donations");
const thumbSize = 96;

function safeDonationId(id) {
  return String(id || "entry").replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== null) return structuredClone(fallback);
    throw error;
  }
}

function getProfileImage(detail) {
  if (detail?.profileImage?.dataUrl) return detail.profileImage;
  if (detail?.images?.[0]?.dataUrl) return detail.images[0];
  return null;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return match ? Buffer.from(match[1], "base64") : null;
}

async function makeThumbnail(image) {
  const buffer = decodeDataUrl(image.dataUrl);
  if (!buffer) return null;

  const base = sharp(buffer, { failOn: "none" }).rotate();
  const metadata = await base.metadata();
  if (!metadata.width || !metadata.height) return null;

  const zoom = Math.max(1, Number(image.zoom || 1));
  const coverScale = Math.max(thumbSize / metadata.width, thumbSize / metadata.height) * zoom;
  const width = Math.max(thumbSize, Math.round(metadata.width * coverScale));
  const height = Math.max(thumbSize, Math.round(metadata.height * coverScale));
  const maxLeft = Math.max(0, width - thumbSize);
  const maxTop = Math.max(0, height - thumbSize);
  const left = Math.round(maxLeft * Number(image.focusX || 50) / 100);
  const top = Math.round(maxTop * Number(image.focusY || 50) / 100);

  const thumb = await base
    .resize(width, height, { fit: "fill" })
    .extract({ left, top, width: thumbSize, height: thumbSize })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();

  return { dataUrl: `data:image/jpeg;base64,${thumb.toString("base64")}` };
}

const index = await readJson(indexPath, { donations: [] });
let changed = false;
let created = 0;
let removed = 0;

for (const entry of index.donations || []) {
  const detailPath = path.join(detailsDir, `${safeDonationId(entry.id)}.json`);
  const detail = await readJson(detailPath, null);
  const profileImage = getProfileImage(detail);

  if (!profileImage) {
    if (entry.profileThumb) {
      delete entry.profileThumb;
      changed = true;
      removed += 1;
    }
    continue;
  }

  const profileThumb = await makeThumbnail(profileImage);
  if (!profileThumb) continue;

  if (entry.profileThumb?.dataUrl !== profileThumb.dataUrl) {
    entry.profileThumb = profileThumb;
    changed = true;
    created += 1;
  }
}

if (changed) {
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

console.log(`Profile thumbnail sync complete. changed=${changed} created_or_updated=${created} removed=${removed}`);
