import fs from "node:fs/promises";
import sharp from "sharp";

const directory = new URL("../public/icons/", import.meta.url);
const source = await fs.readFile(new URL("app-icon.svg", directory), "utf8");
// Maskable and Apple icons use a full opaque square; the OS applies its own mask.
const maskable = source.replace('rx="114"', 'rx="0"');
await fs.writeFile(new URL("app-icon-maskable.svg", directory), maskable);
for (const size of [32, 192, 512]) await sharp(Buffer.from(source)).resize(size, size).png().toFile(new URL(`icon-${size}.png`, directory).pathname);
for (const size of [192, 512]) await sharp(Buffer.from(maskable)).resize(size, size).png().toFile(new URL(`icon-maskable-${size}.png`, directory).pathname);
await sharp(Buffer.from(maskable)).resize(180, 180).png().toFile(new URL("apple-touch-icon.png", directory).pathname);
await fs.writeFile(new URL("../public/favicon.svg", import.meta.url), source);
console.log("Generated 32/192/512, maskable, and Apple application icons.");
