import React from "react";
import { Composition } from "remotion";
import { NewsVideo } from "./NewsVideo";
import { Thumbnail, THUMB_HEIGHT, THUMB_WIDTH, type ThumbnailProps } from "./Thumbnail";
import { ShortVideo, SHORT_HEIGHT, SHORT_WIDTH, type ShortVideoProps } from "./ShortVideo";
import { BANNER, ChannelAvatar, ChannelBanner, type AvatarProps, type BannerProps } from "./ChannelArt";
import { DocAvatar, DocBanner, type DocAvatarProps, type DocBannerProps } from "./DocumentaryArt";
import { FPS, HEIGHT, WIDTH, totalSeconds, type NewsVideoProps } from "./types";

const defaultProps: NewsVideoProps = {
  title: "Preview",
  channel: "My Channel",
  badge: "AI NEWS",
  source: "example.com",
  audioSrc: "",
  durationSec: 5,
  scenes: [{ start: 0, end: 5, type: "title", text: "Preview" }],
  words: [],
  showCaptions: true,
};

const thumbnailDefaults: ThumbnailProps = {
  text: "Your video in minutes",
  highlight: "minutes",
  channel: "My Channel",
  badge: "TUTORIAL",
  layout: "right",
};

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="NewsVideo"
    component={NewsVideo}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    durationInFrames={FPS * 5}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(totalSeconds(props) * FPS)) })}
  />
  <Composition
    id="Thumbnail"
    component={Thumbnail}
    fps={1}
    width={THUMB_WIDTH}
    height={THUMB_HEIGHT}
    durationInFrames={1}
    defaultProps={thumbnailDefaults}
  />
  <Composition
    id="ShortVideo"
    component={ShortVideo}
    fps={FPS}
    width={SHORT_WIDTH}
    height={SHORT_HEIGHT}
    durationInFrames={FPS * 5}
    defaultProps={{ base: defaultProps, hookText: "The AI news that matters", audioStartSec: 0 } satisfies ShortVideoProps}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.base.durationSec * FPS)) })}
  />
  <Composition
    id="ChannelAvatar"
    component={ChannelAvatar}
    fps={1}
    width={800}
    height={800}
    durationInFrames={1}
    defaultProps={{ variant: "monogram", channel: "My Channel" } satisfies AvatarProps}
  />
  <Composition
    id="ChannelBanner"
    component={ChannelBanner}
    fps={1}
    width={BANNER.width}
    height={BANNER.height}
    durationInFrames={1}
    defaultProps={{ channel: "My Channel", tagline: "AI news and hands-on builds", topics: ["AI News", "Tutorials"] } satisfies BannerProps}
  />
  <Composition
    id="DocAvatar"
    component={DocAvatar}
    fps={1}
    width={800}
    height={800}
    durationInFrames={1}
    defaultProps={{ variant: "monogram", channel: "My Channel" } satisfies DocAvatarProps}
  />
  <Composition
    id="DocBanner"
    component={DocBanner}
    fps={1}
    width={BANNER.width}
    height={BANNER.height}
    durationInFrames={1}
    defaultProps={{ channel: "My Channel", tagline: "The real stories behind the legends", topics: "Myths · Legends · The record" } satisfies DocBannerProps}
  />
  </>
);
