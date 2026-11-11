/**
 * Small, dependency-free colour maths shared by the runtime accent override
 * (accent.ts) and the contrast audit (scripts/contrast.mjs).
 *
 * Everything works in OKLCH because that is what the panel's tokens use: lightness
 * is perceptually even, so "same L, different hue" keeps contrast roughly stable.
 */

export type Rgb = [number, number, number]; // linear-light sRGB, 0..1 when in gamut
export interface Oklch {
    l: number; // 0..1
    c: number; // 0..~0.4
    h: number; // degrees
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` to linear sRGB, or null when the string is
 * not a hex colour. Alpha digits are accepted and ignored.
 */
export function hexToLinear(hex: string): Rgb | null {
    const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
    if (!match) return null;
    let digits = match[1] as string;
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('');
    const channel = (i: number): number => toLinear(parseInt(digits.slice(i, i + 2), 16) / 255);

    return [channel(0), channel(2), channel(4)];
}

export function linearToOklch([r, g, b]: Rgb): Oklch {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

    return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

const OKLCH_SYNTAX = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)(%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i;

/**
 * Parse what the panel's `color` settings field stores: a hex colour, or a numeric
 * `oklch(L C H)` (L and C may be percentages, H may carry `deg`). Alpha is ignored.
 */
export function parseColor(value: string): Oklch | null {
    const linear = hexToLinear(value);
    if (linear) return linearToOklch(linear);

    const match = OKLCH_SYNTAX.exec(value.trim());
    if (!match) return null;
    const l = Number(match[1]) / (match[2] ? 100 : 1);
    const c = match[4] ? (Number(match[3]) / 100) * 0.4 : Number(match[3]);
    const h = Number(match[5]);
    if (![l, c, h].every(Number.isFinite)) return null;

    return { l: Math.min(1, l), c, h: ((h % 360) + 360) % 360 };
}

export function oklchToLinear({ l: L, c, h }: Oklch): Rgb {
    const A = c * Math.cos((h * Math.PI) / 180);
    const B = c * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;

    return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Reduce chroma (keeping lightness and hue) until the colour fits in sRGB. */
export function fitToSrgb(color: Oklch): Oklch {
    if (inGamut(oklchToLinear(color))) return color;
    let low = 0;
    let high = color.c;
    for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (inGamut(oklchToLinear({ ...color, c: mid }))) low = mid;
        else high = mid;
    }

    return { ...color, c: low };
}

/** WCAG 2.x relative luminance of a linear sRGB colour. */
export const luminance = ([r, g, b]: Rgb): number => {
    const clamp = (v: number): number => Math.min(1, Math.max(0, v));

    return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
};

/** WCAG 2.x contrast ratio between two luminances (order does not matter). */
export const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export const formatOklch = ({ l, c, h }: Oklch): string => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)})`;

/**
 * The lightest surface this theme puts accent-coloured text on (`--secondary`), and the
 * dark "ink" it puts on top of accent-coloured fills (`--primary-foreground`). They mirror
 * theme.css; `npm run contrast` fails if the two files drift apart.
 */
export const LIGHTEST_SURFACE: Oklch = { l: 0.285, c: 0.015, h: 264 };
export const INK: Oklch = { l: 0.17, c: 0.02, h: 264 };

export interface AccentTokens {
    '--primary': string;
    '--accent': string;
    '--ring': string;
}

/**
 * Turn any admin-chosen colour (hex or oklch) into a set of brand tokens that are guaranteed to
 * meet WCAG AA (4.5:1) both as text on every theme surface and as a fill under dark ink.
 * Only the hue and (capped) chroma of the input are kept; lightness is ours to choose.
 */
export function deriveAccent(value: string): AccentTokens | null {
    const input = parseColor(value);
    if (!input) return null;
    const surface = luminance(oklchToLinear(LIGHTEST_SURFACE));
    const ink = luminance(oklchToLinear(INK));

    const at = (l: number, chroma: number): Oklch => fitToSrgb({ l, c: Math.min(input.c, chroma), h: input.h });
    const passes = (color: Oklch): boolean => {
        const lum = luminance(oklchToLinear(color));

        return contrast(lum, surface) >= 4.5 && contrast(lum, ink) >= 4.5;
    };

    let l = 0.7;
    while (l < 0.9 && !passes(at(l, 0.15))) l += 0.005;

    return {
        '--primary': formatOklch(at(l, 0.15)),
        '--ring': formatOklch(at(Math.min(l + 0.04, 0.93), 0.14)),
        '--accent': formatOklch(at(Math.min(l + 0.08, 0.93), 0.12)),
    };
}
