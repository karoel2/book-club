/**
 * Restrained sequential scale for a 1–10 score: muted red → amber → green.
 * Returns a pale fill with a dark tonal foreground so text keeps a high
 * (WCAG-AA/AAA) contrast ratio while the palette stays neutral enough to let
 * covers and ratings lead — per the project's design direction.
 */
export function scoreColor(score: number): { bg: string; fg: string; border: string } {
  const t = Math.max(0, Math.min(1, (score - 1) / 9));
  const hue = Math.round(8 + t * (140 - 8)); // 8 = warm red, 140 = green
  return {
    bg: `hsl(${hue} 58% 91%)`,
    fg: `hsl(${hue} 46% 25%)`,
    border: `hsl(${hue} 38% 80%)`,
  };
}
