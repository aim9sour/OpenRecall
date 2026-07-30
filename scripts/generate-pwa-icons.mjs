import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourcePath = resolve(
  repositoryRoot,
  "apps/web/assets/icon-source.svg",
);
const outputDirectory = resolve(repositoryRoot, "apps/web/public");

async function writeIcon(source, filename, size) {
  await sharp(source)
    .resize(size, size, { fit: "fill" })
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
    })
    .toFile(resolve(outputDirectory, filename));
}

async function writeMaskableIcon(source, filename, size) {
  const artwork = await sharp(source)
    .resize(size, size, { fit: "fill" })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#103d32",
    },
  })
    .composite([{ input: artwork }])
    .png({
      adaptiveFiltering: false,
      compressionLevel: 9,
      palette: false,
    })
    .toFile(resolve(outputDirectory, filename));
}

export async function generatePwaIcons() {
  const source = await readFile(sourcePath);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeIcon(source, "icon-192.png", 192),
    writeIcon(source, "icon-512.png", 512),
    writeMaskableIcon(source, "icon-maskable-512.png", 512),
  ]);
}

await generatePwaIcons();
