import fs from "node:fs";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import type { AvatarProps, BannerProps } from "@yta/video";
import { CHANNEL_NAME, DATA_DIR } from "./paths";
import { getBundle } from "./steps/render";

/**
 * Renders the channel's profile picture variants and banner into data/channel/.
 * Usage: npm run channel-art -- [--tagline "..."] [--topics "AI News,Tutorials"]
 */
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const channel = CHANNEL_NAME || "My Channel";
const tagline = opt("tagline") ?? "AI news and hands-on builds";
const topics = (opt("topics") ?? "AI News,Tutorials").split(",").map((t) => t.trim()).filter(Boolean);

const out = path.join(DATA_DIR, "channel");
fs.mkdirSync(out, { recursive: true });
const serveUrl = await getBundle();

async function still(id: string, inputProps: Record<string, unknown>, file: string) {
  const composition = await selectComposition({ serveUrl, id, inputProps });
  await renderStill({ composition, serveUrl, inputProps, output: path.join(out, file), imageFormat: "png" });
  console.log("wrote", path.join(out, file));
}

for (const variant of ["monogram", "blocks", "bar", "a3d-light", "a3d-purple", "a3d-chrome"] as const) {
  await still("ChannelAvatar", { variant, channel } satisfies AvatarProps, `avatar-${variant}.png`);
}
// Transparent version of the chosen 3D letter, for the YouTube video watermark (Customization → Branding).
await still("ChannelAvatar", { variant: "a3d-purple", channel, transparent: true } satisfies AvatarProps, "watermark.png");
await still("ChannelBanner", { channel, tagline, topics } satisfies BannerProps, "banner.png");
process.exit(0);
