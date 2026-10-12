import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Vertical data Short for Arqen WoW from the Forever Census (forevercensus.com): who plays
// what in WoW Forever. No voice: text, numbers and animation carry it, with optional music.
// Content stays inside YouTube's Shorts safe area (bottom ~20% and right edge are UI).

export const CENSUS_SHORT = { width: 1080, height: 1920, fps: 30, durationInFrames: 990 };

export interface CensusShortProps {
  [key: string]: unknown;
  /** Where the class and race icons live, e.g. https://www.forevercensus.com/icons */
  iconBase: string;
  /** Optional background music (URL). */
  musicSrc?: string;
  realm: string;
  date: string;
  online: { alliance: number; horde: number } | null;
  /** Unique characters counted, when there is no online estimate. */
  counted: number;
  classes: { token: string; name: string; color: string; share: number }[];
  combos: { race: string; raceIcon: string; className: string; classIcon: string; share: number; isNew: boolean }[];
  /** Share (0-100) on a race + class combo that is new in Forever. */
  newShare: number;
}

const C = {
  bg: "#070b16",
  bg2: "#101a33",
  panel: "#0d1528",
  text: "#f4f6fb",
  muted: "#9aa6c2",
  gold: "#ffcc00",
  alliance: "#4C8DFF",
  horde: "#E5484D",
};
const HEAVY = "'Arial Black', 'Segoe UI', sans-serif";
const BODY = "'Segoe UI', Arial, sans-serif";
const SAFE = { left: 80, right: 150, top: 200 };

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const round100 = (n: number) => Math.round(n / 100) * 100;

/** Fades a scene in over 8 frames and out over its last 8. */
function useSceneFade(length: number): number {
  const f = useCurrentFrame();
  return interpolate(f, [0, 8, length - 8, length], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: C.gold, fontFamily: BODY, fontWeight: 800, fontSize: 34, letterSpacing: 6, textTransform: "uppercase" }}>
      {children}
    </div>
  );
}

function Icon({ src, ring, size }: { src: string; ring: string; size: number }) {
  return (
    <Img src={src} style={{ width: size, height: size, borderRadius: "50%", border: `5px solid ${ring}`, boxShadow: "0 0 0 2px rgba(0,0,0,0.6)" }} />
  );
}

function Hook({ online, counted }: Pick<CensusShortProps, "online" | "counted">) {
  const f = useCurrentFrame();
  const opacity = useSceneFade(150);
  const total = online ? online.alliance + online.horde : counted;
  const shown = total * Math.min(1, interpolate(f, [6, 42], [0, 1], { extrapolateLeft: "clamp" }) ** 0.6);
  const bar = interpolate(f, [40, 70], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const aShare = online ? online.alliance / total : 0.5;
  return (
    <AbsoluteFill style={{ opacity, padding: `${SAFE.top + 260}px ${SAFE.right}px 0 ${SAFE.left}px` }}>
      <Eyebrow>WoW Forever beta · census</Eyebrow>
      <div style={{ color: C.gold, fontFamily: HEAVY, fontSize: 180, lineHeight: 1.05, marginTop: 40, whiteSpace: "nowrap" }}>
        {online ? <span style={{ fontSize: "0.55em", verticalAlign: "0.35em", marginRight: 16 }}>≈</span> : null}
        {fmt(online ? round100(shown) : shown)}
      </div>
      <div style={{ color: C.text, fontFamily: BODY, fontWeight: 700, fontSize: 64, lineHeight: 1.15, marginTop: 10 }}>
        {online ? "players online at once" : "characters counted"}
      </div>
      {online && (
        <div style={{ marginTop: 90, opacity: bar }}>
          <div style={{ display: "flex", height: 34, borderRadius: 17, overflow: "hidden", gap: 4 }}>
            <div style={{ width: `${aShare * 100 * bar}%`, background: C.alliance }} />
            <div style={{ flex: 1, background: C.horde }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, fontFamily: BODY, fontWeight: 700, fontSize: 44 }}>
            <span style={{ color: C.alliance }}>Alliance {Math.round(aShare * 100)}%</span>
            <span style={{ color: C.horde }}>Horde {100 - Math.round(aShare * 100)}%</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

function Classes({ classes, iconBase }: Pick<CensusShortProps, "classes" | "iconBase">) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = useSceneFade(330);
  const max = Math.max(...classes.map((c) => c.share));
  return (
    <AbsoluteFill style={{ opacity, padding: `${SAFE.top}px ${SAFE.right}px 0 ${SAFE.left}px` }}>
      <Eyebrow>What they play</Eyebrow>
      <div style={{ color: C.text, fontFamily: HEAVY, fontSize: 82, marginTop: 14, marginBottom: 40 }}>Classes</div>
      {classes.map((c, i) => {
        const s = spring({ frame: f - 10 - i * 7, fps, config: { damping: 18 } });
        return (
          <div key={c.token} style={{ display: "flex", alignItems: "center", gap: 26, marginBottom: 34, opacity: s, transform: `translateX(${(1 - s) * -60}px)` }}>
            <Icon src={`${iconBase}/classes/${c.token.toLowerCase()}.jpg`} ring={c.color} size={96} />
            <div style={{ width: 230, color: C.text, fontFamily: BODY, fontWeight: 700, fontSize: 44 }}>{c.name}</div>
            <div style={{ flex: 1, height: 26, background: "rgba(255,255,255,0.07)", borderRadius: 13, overflow: "hidden" }}>
              <div style={{ width: `${(c.share / max) * 100 * s}%`, height: "100%", background: c.color, borderRadius: 13 }} />
            </div>
            <div style={{ width: 150, textAlign: "right", color: C.text, fontFamily: HEAVY, fontSize: 44 }}>{c.share.toFixed(1)}%</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Combos({ combos, iconBase }: Pick<CensusShortProps, "combos" | "iconBase">) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = useSceneFade(270);
  return (
    <AbsoluteFill style={{ opacity, padding: `${SAFE.top + 120}px ${SAFE.right}px 0 ${SAFE.left}px` }}>
      <Eyebrow>Most played</Eyebrow>
      <div style={{ color: C.text, fontFamily: HEAVY, fontSize: 82, marginTop: 14, marginBottom: 50 }}>Top combos</div>
      {combos.map((c, i) => {
        const s = spring({ frame: f - 12 - i * 18, fps, config: { damping: 16 } });
        return (
          <div key={c.race + c.className} style={{
            display: "flex", alignItems: "center", gap: 30, padding: "34px 36px", marginBottom: 30, borderRadius: 28,
            background: C.panel, border: `2px solid ${i === 0 ? "rgba(255,204,0,0.6)" : "rgba(154,166,194,0.18)"}`,
            opacity: s, transform: `translateY(${(1 - s) * 80}px)`,
          }}>
            <div style={{ color: C.gold, fontFamily: HEAVY, fontSize: 64, width: 56 }}>{i + 1}</div>
            <div style={{ position: "relative", width: 170, height: 110 }}>
              <div style={{ position: "absolute", left: 0, top: 0 }}><Icon src={`${iconBase}/races/${c.raceIcon}.jpg`} ring="rgba(255,204,0,0.7)" size={110} /></div>
              <div style={{ position: "absolute", left: 70, top: 0 }}><Icon src={`${iconBase}/classes/${c.classIcon}.jpg`} ring="rgba(255,204,0,0.7)" size={110} /></div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.text, fontFamily: BODY, fontWeight: 800, fontSize: 50, lineHeight: 1.1 }}>{c.race} {c.className}</div>
              {c.isNew && (
                <div style={{ display: "inline-block", marginTop: 10, padding: "4px 14px", borderRadius: 10, background: C.gold, color: "#1a1300", fontFamily: BODY, fontWeight: 900, fontSize: 28 }}>
                  NEW IN FOREVER
                </div>
              )}
            </div>
            <div style={{ color: C.gold, fontFamily: HEAVY, fontSize: 56 }}>{c.share.toFixed(1)}%</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function NewCombos({ newShare }: Pick<CensusShortProps, "newShare">) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = useSceneFade(120);
  const s = spring({ frame: f - 4, fps, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ opacity, padding: `${SAFE.top + 380}px ${SAFE.right}px 0 ${SAFE.left}px` }}>
      <div style={{ color: C.gold, fontFamily: HEAVY, fontSize: 260, lineHeight: 1, transform: `scale(${0.7 + 0.3 * s})`, transformOrigin: "left center" }}>
        {Math.round(newShare)}%
      </div>
      <div style={{ color: C.text, fontFamily: BODY, fontWeight: 700, fontSize: 66, lineHeight: 1.2, marginTop: 30 }}>
        play a race and class combo that didn&apos;t exist in 2004
      </div>
    </AbsoluteFill>
  );
}

function Outro({ realm, date }: Pick<CensusShortProps, "realm" | "date">) {
  const f = useCurrentFrame();
  const opacity = useSceneFade(120);
  const draw = interpolate(f, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  const r = 120;
  const circ = 2 * Math.PI * r;
  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", paddingTop: SAFE.top + 260, paddingRight: SAFE.right - SAFE.left }}>
      <svg width={300} height={300} viewBox="0 0 300 300">
        <circle cx={150} cy={150} r={r} fill="none" stroke={C.gold} strokeWidth={20} strokeDasharray={circ} strokeDashoffset={circ * (1 - draw)} transform="rotate(-90 150 150)" />
        {[[95, 185, 155], [130, 185, 105], [165, 185, 130], [200, 185, 80]].map(([x, y1, y2], i) => (
          <line key={i} x1={x} x2={x} y1={y1} y2={y1 - (y1 - y2) * Math.min(1, Math.max(0, draw * 4 - i * 0.6))} stroke={C.gold} strokeWidth={26} strokeLinecap="round" />
        ))}
      </svg>
      <div style={{ color: C.text, fontFamily: HEAVY, fontSize: 80, marginTop: 50 }}>
        FOREVER <span style={{ color: C.gold }}>CENSUS</span>
      </div>
      <div style={{ color: C.gold, fontFamily: BODY, fontWeight: 800, fontSize: 56, marginTop: 20 }}>forevercensus.com</div>
      <div style={{ color: C.muted, fontFamily: BODY, fontWeight: 600, fontSize: 40, marginTop: 30, textAlign: "center" }}>
        Live numbers · become a scanner
      </div>
      <div style={{ color: C.muted, fontFamily: BODY, fontSize: 30, marginTop: 70 }}>{realm} · {date}</div>
    </AbsoluteFill>
  );
}

export const CensusShort: React.FC<CensusShortProps> = (p) => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 900px at 10% 0%, rgba(255,204,0,0.10), transparent 60%), linear-gradient(180deg, ${C.bg} 0%, ${C.bg2} 100%)` }}>
    {p.musicSrc ? <Audio src={p.musicSrc} volume={(f) => interpolate(f, [0, 20, 950, 990], [0, 0.6, 0.6, 0], { extrapolateRight: "clamp" })} /> : null}
    <Sequence durationInFrames={150}><Hook online={p.online} counted={p.counted} /></Sequence>
    <Sequence from={150} durationInFrames={330}><Classes classes={p.classes} iconBase={p.iconBase} /></Sequence>
    <Sequence from={480} durationInFrames={270}><Combos combos={p.combos} iconBase={p.iconBase} /></Sequence>
    <Sequence from={750} durationInFrames={120}><NewCombos newShare={p.newShare} /></Sequence>
    <Sequence from={870} durationInFrames={120}><Outro realm={p.realm} date={p.date} /></Sequence>
  </AbsoluteFill>
);
