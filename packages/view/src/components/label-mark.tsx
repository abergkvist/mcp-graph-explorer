import type { LabelStyle } from "../model.ts";

const paths: Record<LabelStyle["shape"], string> = {
  circle: "M5 0a5 5 0 1 1 0 10a5 5 0 1 1 0-10",
  square: "M1 1h8v8H1z",
  diamond: "M5 0l5 5-5 5-5-5z",
  triangle: "M5 0l5 9H0z",
};

export function LabelMark({ shape, color }: { shape: LabelStyle["shape"]; color: string }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
      <path d={paths[shape]} fill={color} />
    </svg>
  );
}
