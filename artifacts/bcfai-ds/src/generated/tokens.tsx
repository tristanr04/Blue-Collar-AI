/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f6f7f9",
      "foreground": "#1f2733",
      "border": "#dae0e7",
      "card": "#ffffff",
      "cardForeground": "#1f2733",
      "popover": "#ffffff",
      "popoverForeground": "#1f2733",
      "primary": "#2c9664",
      "primaryForeground": "#ffffff",
      "secondary": "#213550",
      "secondaryForeground": "#ffffff",
      "muted": "#eaedf1",
      "mutedForeground": "#647287",
      "accent": "#e9f7f0",
      "accentForeground": "#206f4a",
      "destructive": "#d92d20",
      "destructiveForeground": "#ffffff",
      "input": "#dae0e7",
      "ring": "#2c9664",
      "chart1": "#2c9664",
      "chart2": "#2c486d",
      "chart3": "#ee9d2b",
      "chart4": "#d92d20",
      "chart5": "#2e93b8",
      "sidebar": "#213550",
      "sidebarForeground": "#dee6ed",
      "sidebarBorder": "#294365",
      "sidebarPrimary": "#2c9664",
      "sidebarPrimaryForeground": "#ffffff",
      "sidebarAccent": "#294365",
      "sidebarAccentForeground": "#eef2f6",
      "sidebarRing": "#2c9664"
    },
    "dark": {
      "background": "#0f1824",
      "foreground": "#eef2f6",
      "border": "#243142",
      "card": "#131f2f",
      "cardForeground": "#eef2f6",
      "popover": "#131f2f",
      "popoverForeground": "#eef2f6",
      "primary": "#39ac77",
      "primaryForeground": "#0f1824",
      "secondary": "#213550",
      "secondaryForeground": "#eef2f6",
      "muted": "#1c293b",
      "mutedForeground": "#7589a3",
      "accent": "#203c2f",
      "accentForeground": "#79d2a9",
      "destructive": "#df453a",
      "destructiveForeground": "#ffffff",
      "input": "#273649",
      "ring": "#39ac77",
      "chart1": "#39ac77",
      "chart2": "#6692cc",
      "chart3": "#eba747",
      "chart4": "#df453a",
      "chart5": "#47acd1",
      "sidebar": "#0b131e",
      "sidebarForeground": "#cdd9e4",
      "sidebarBorder": "#1b2737",
      "sidebarPrimary": "#39ac77",
      "sidebarPrimaryForeground": "#0f1824",
      "sidebarAccent": "#18273a",
      "sidebarAccentForeground": "#dee6ed",
      "sidebarRing": "#39ac77"
    }
  },
  "fontFamily": {
    "sans": [
      "Inter",
      "sans-serif"
    ],
    "serif": [
      "Georgia",
      "serif"
    ],
    "mono": [
      "Menlo",
      "monospace"
    ]
  },
  "radius": "0.75rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
