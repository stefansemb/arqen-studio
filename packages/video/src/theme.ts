import { createContext, useContext } from "react";

export interface Theme {
  bg: string;
  /** Second backdrop color, for gradients behind text cards. */
  bg2: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  /** Dark middle tone of the thumbnail tint, between accent and accent2. */
  accentDeep: string;
  font: string;
}

/** The original channel look (purple/cyan). Channel profiles override parts of it. */
export const defaultTheme: Theme = {
  bg: "#0b0b10",
  bg2: "#16121f",
  panel: "#15151d",
  text: "#f4f4f7",
  muted: "#a1a1b0",
  accent: "#8b5cf6",
  accent2: "#22d3ee",
  accentDeep: "#3b1d8f",
  font: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif",
};

export type ThemeOverrides = Partial<Theme>;

export function resolveTheme(overrides?: ThemeOverrides): Theme {
  if (!overrides) return defaultTheme;
  const out = { ...defaultTheme };
  for (const [k, v] of Object.entries(overrides)) if (typeof v === "string" && v) out[k as keyof Theme] = v;
  return out;
}

const ThemeContext = createContext<Theme>(defaultTheme);
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = (): Theme => useContext(ThemeContext);

/** Fixed default theme, for channel art that is always rendered in the original look. */
export const theme = defaultTheme;
