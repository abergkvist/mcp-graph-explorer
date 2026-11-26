// Graph colours per theme; index matches LabelStyle.color.
export const PALETTE = {
  light: {
    nodes: ["#3b6fd4", "#d9822b", "#2f9468", "#b5559a", "#7561c4", "#c4483f", "#1f8598", "#84742a"],
    placeholder: "#b4b4b4", edge: "#b8b8b8", label: "#2b2b2b", faded: "#e4e4e4",
  },
  dark: {
    nodes: ["#6b98f0", "#eda054", "#52bd8c", "#d97dbd", "#9d8ae8", "#e8766c", "#48b0c4", "#b3a14e"],
    placeholder: "#5c5c5c", edge: "#5a5a5a", label: "#e4e4e4", faded: "#2e2e2e",
  },
} as const;
export type Theme = keyof typeof PALETTE;
