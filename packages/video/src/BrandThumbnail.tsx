import React, { useEffect, useRef, useState } from "react";
import { AbsoluteFill, continueRender, delayRender } from "remotion";
import { findBrand, type Brand } from "./brands";
import type { Theme } from "./theme";

const W = 1280;
const H = 720;
/** The frame's width; YouTube rounds the corners itself, the frame follows the same curve. */
const FRAME = 14;
/** The product name fills this width; short names stop at NAME_MAX px so they still fit above the frame. */
const NAME_WIDTH = 1130;
const NAME_MAX = 400;
/** Long names are squeezed to at least this share of their width, so they stay tall instead of only getting smaller. */
const SQUEEZE = 0.75;
/** Size the name is measured at before it is scaled to fit. */
const PROBE = 100;

/** Deterministic noise in [0, 1) so every render of the same thumbnail is identical. */
function rand(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A field of dots in perspective that swells into a wave rising to the right, brightest on the crests.
 * Far rows are small and faint near the horizon, near rows big and bright below the frame.
 */
const ParticleWave: React.FC<{ brand: Brand }> = ({ brand }) => {
  const dots: React.ReactElement[] = [];
  const rows = 38;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const spacing = 7 + t * 26;
    const cols = Math.ceil((W + 400) / spacing);
    for (let i = 0; i < cols; i++) {
      const x = -200 + i * spacing + (j % 2) * spacing * 0.5;
      const u = x / W;
      const wave = Math.sin(u * 7 - j * 0.32) * 0.6 + Math.sin(u * 3.1 + j * 0.15) * 0.4;
      const y = 350 + Math.pow(t, 1.4) * 440 - u * 170 - wave * (24 + t * 72);
      if (y < -10 || y > H + 10) continue;
      const crest = (wave + 1) / 2;
      const r = (0.8 + t * 2.6) * (0.6 + crest * 0.7);
      const opacity = Math.min(1, (0.25 + t * 0.75) * (0.4 + crest) * (0.55 + u * 0.6) * (0.75 + rand(i, j) * 0.5));
      dots.push(<circle key={`${i}-${j}`} cx={x} cy={y} r={r} fill={crest > 0.72 ? brand.color2 : brand.color} opacity={opacity} />);
    }
  }
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <filter id="dotglow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#dotglow)">{dots}</g>
    </svg>
  );
};

/** Blue "verified" seal beside the company name. */
const Verified: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flex: "none", marginTop: -12 }}>
    <circle cx={12} cy={12} r={11} fill="#3b9cff" />
    <path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Brand launch thumbnail: the company's logo and name, a kicker ("INTRODUCING") in its colors and the product
 * name huge and glowing in white, over a particle wave inside a frame in the company color. No photo or presenter,
 * so it reads at a glance and every launch looks like part of one series.
 */
export const BrandThumbnail: React.FC<{ company: string; kicker: string; text: string; theme: Theme }> = ({ company, kicker, text, theme }) => {
  const brand = findBrand(company, { color: theme.accent, color2: theme.accent2 });
  const name = text.toUpperCase().trim();
  const kick = kicker.toUpperCase().trim();
  // One line across the frame: measured once the font has loaded, then scaled to fill the width.
  const probe = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ size: number; scaleX: number } | null>(null);
  const [handle] = useState(() => delayRender("Measuring the product name"));
  useEffect(() => {
    void document.fonts.ready.then(() => {
      const w = probe.current?.offsetWidth || 1;
      // The size at which it fills the width unsqueezed; the squeeze buys the rest of the height up to NAME_MAX.
      const fill = (PROBE * NAME_WIDTH) / w;
      const size = Math.floor(Math.min(NAME_MAX, fill / SQUEEZE));
      setFit({ size, scaleX: Math.min(1, fill / size) });
      continueRender(handle);
    });
  }, [handle]);
  const kickSize = Math.min(84, Math.floor(1000 / (0.6 * Math.max(kick.length, 1))));
  return (
    <AbsoluteFill style={{ background: "#05060a", fontFamily: theme.font, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 60% 45% at 75% 62%, ${brand.color}55, transparent 70%), radial-gradient(ellipse 50% 40% at 20% 20%, ${brand.color}1c, transparent 70%)`,
        }}
      />
      <ParticleWave brand={brand} />
      {/* Darkens the top left a little so the text stands off the dots. */}
      <AbsoluteFill style={{ background: "linear-gradient(170deg, #05060acc 0%, #05060a66 40%, transparent 65%)" }} />

      <div style={{ position: "absolute", left: 76, top: 92, right: 60, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, height: 64 }}>
          {brand.icon ? (
            <svg width={54} height={54} viewBox="0 0 24 24" style={{ flex: "none", filter: `drop-shadow(0 0 10px ${brand.color}aa)` }}>
              <path d={brand.icon} fill="#fff" />
            </svg>
          ) : null}
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 50, letterSpacing: 1, textTransform: "uppercase", textShadow: `0 0 18px ${brand.color}99` }}>
            {brand.name}
          </span>
          <Verified size={26} />
        </div>
        {kick ? (
          <div
            style={{
              marginTop: 22,
              fontSize: kickSize,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: 1,
              whiteSpace: "nowrap",
              alignSelf: "flex-start",
              background: `linear-gradient(90deg, ${brand.color} 0%, ${brand.color2} 100%)`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              filter: `drop-shadow(0 0 14px ${brand.color}88)`,
            }}
          >
            {kick}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 8,
            marginLeft: -6,
            fontSize: fit?.size ?? PROBE,
            transform: `scaleX(${fit?.scaleX ?? 1})`,
            transformOrigin: "left center",
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
            color: "#fff",
            textShadow: `0 0 12px #ffffffcc, 0 0 34px ${brand.color2}aa, 0 0 70px ${brand.color}88, 0 10px 30px #000`,
          }}
        >
          {name}
        </div>
      </div>

      <span ref={probe} style={{ position: "absolute", visibility: "hidden", whiteSpace: "nowrap", fontSize: PROBE, fontWeight: 900, letterSpacing: "-0.01em" }}>
        {name}
      </span>

      <AbsoluteFill style={{ border: `${FRAME}px solid ${brand.color}`, borderRadius: 34, boxShadow: `inset 0 0 40px ${brand.color}66` }} />
    </AbsoluteFill>
  );
};
