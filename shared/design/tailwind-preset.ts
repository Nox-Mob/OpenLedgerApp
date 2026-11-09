// Tailwind preset for apps that still use a JavaScript Tailwind config
// (`@config "./tailwind.config.ts"` with `presets: [oahPreset]`). Apps on
// Tailwind v4's CSS config should import shared/design/tailwind.css instead;
// both map the same tokens from shared/design/tokens.css.

const colorTokens = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "success",
  "warning",
  "info",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "app-accent",
  "app-accent-foreground",
] as const;

export const oahPreset = {
  darkMode: "class" as const,
  theme: {
    extend: {
      colors: Object.fromEntries(colorTokens.map((t) => [t, `var(--${t})`])),
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "calc(var(--radius) - 2px)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 2px)",
        xl: "calc(var(--radius) + 4px)",
      },
      boxShadow: { sm: "var(--shadow-sm)", md: "var(--shadow-md)", lg: "var(--shadow-lg)" },
      spacing: { control: "var(--control-h)", row: "var(--row-h)" },
    },
  },
};

export default oahPreset;
