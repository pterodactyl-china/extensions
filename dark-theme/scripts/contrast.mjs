/**
 * WCAG contrast audit for src/client/theme.css.
 *
 *   npm run contrast            # prints a table, exits 1 on any failure
 *   npm run contrast -- --md    # same table as Markdown (pasted into the README)
 *
 * It reads the real token file, resolves var() aliases, and checks every text/surface
 * pairing the panel actually renders (found by grepping core for the role utilities).
 * Theme authors: change theme.css, run this, fix what turns red.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    INK,
    LIGHTEST_SURFACE,
    contrast,
    deriveAccent,
    hexToLinear,
    linearToOklch,
    luminance,
    oklchToLinear,
} from '../src/client/color.ts';

const css = readFileSync(fileURLToPath(new URL('../src/client/theme.css', import.meta.url)), 'utf8');
const tokens = Object.fromEntries(
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()])
);

/** Resolve a token or literal CSS colour to linear sRGB. */
function resolve(value) {
    value = value.trim();
    if (value.startsWith('--')) {
        if (!(value in tokens)) throw new Error(`theme.css does not define ${value}`);
        return resolve(tokens[value]);
    }
    let m;
    if ((m = /^var\((--[\w-]+)\)$/.exec(value))) return resolve(m[1]);
    if ((m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value))) {
        return oklchToLinear({ l: +m[1], c: +m[2], h: +m[3] });
    }
    if ((m = /^color-mix\(in oklab, (.+) ([\d.]+)%, black\)$/.exec(value))) {
        // Mixing with black in OKLab scales L, a and b alike - i.e. scales lightness and chroma.
        const base = linearToOklch(resolve(m[1]));
        const k = +m[2] / 100;
        return oklchToLinear({ l: base.l * k, c: base.c * k, h: base.h });
    }
    const hex = hexToLinear(value);
    if (hex) return hex;
    throw new Error(`Unsupported colour syntax: ${value}`);
}

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** `fg` at `alpha` painted over `bg`, composited in gamma-encoded sRGB like a browser does. */
const over = (fg, alpha, bg) => fg.map((c, i) => decode(encode(c) * alpha + encode(bg[i]) * (1 - alpha)));
const clamp = (rgb) => rgb.map((v) => Math.min(1, Math.max(0, v)));

const ratio = (a, b) => contrast(luminance(clamp(a)), luminance(clamp(b)));
const c = (name) => resolve(name);

const rows = [];
const check = (group, label, fg, bg, min) => rows.push({ group, label, value: ratio(fg, bg), min });

const SURFACES = ['--background', '--card', '--muted', '--popover', '--secondary', '--input'];
const TEXT = 4.5; // WCAG 1.4.3 AA, normal text
const GRAPHIC = 3; // WCAG 1.4.11 AA, graphics and UI component states

// Body and secondary text on every surface.
for (const s of SURFACES) check('Text', `foreground on ${s.slice(2)}`, c('--foreground'), c(s), TEXT);
check('Text', 'foreground on sunken', c('--foreground'), c('--sunken'), TEXT);
for (const s of ['--background', '--card', '--muted', '--popover', '--secondary']) {
    check('Text', `muted-foreground on ${s.slice(2)}`, c('--muted-foreground'), c(s), TEXT);
}
check('Text', 'muted-foreground on sunken', c('--muted-foreground'), c('--sunken'), TEXT);
// .input-help is text-foreground/70; the dimmest place it appears is a dialog (popover).
check(
    'Text',
    'foreground/70 (field help) on popover',
    over(c('--foreground'), 0.7, c('--popover')),
    c('--popover'),
    TEXT
);

// Brand: as text on surfaces, and as fills under ink.
for (const s of ['--background', '--card', '--muted', '--popover', '--secondary']) {
    check('Brand', `accent (links) on ${s.slice(2)}`, c('--accent'), c(s), TEXT);
}
check('Brand', 'accent/80 (link hover) on popover', over(c('--accent'), 0.8, c('--popover')), c('--popover'), TEXT);
check('Brand', 'accent on accent/10 badge over card', c('--accent'), over(c('--accent'), 0.1, c('--card')), TEXT);
for (const s of ['--background', '--card', '--popover'])
    check('Brand', `primary text on ${s.slice(2)}`, c('--primary'), c(s), TEXT);
check('Brand', 'primary-foreground on primary', c('--primary-foreground'), c('--primary'), TEXT);
check(
    'Brand',
    'primary-foreground on primary/80 over card',
    c('--primary-foreground'),
    over(c('--primary'), 0.8, c('--card')),
    TEXT
);
check('Brand', 'accent-foreground on accent', c('--accent-foreground'), c('--accent'), TEXT);
for (const s of ['--background', '--card', '--popover'])
    check('Brand', `focus ring on ${s.slice(2)}`, c('--ring'), c(s), GRAPHIC);

// Status colours: solid fill + ink, text on surfaces, text on its own tint.
for (const status of ['destructive', 'success', 'warning', 'caution']) {
    const fill = c(`--${status}`);
    check('Status', `${status}-foreground on ${status}`, c(`--${status}-foreground`), fill, TEXT);
    check(
        'Status',
        `${status}-foreground on ${status}/90 over card`,
        c(`--${status}-foreground`),
        over(fill, 0.9, c('--card')),
        TEXT
    );
    for (const s of ['--background', '--card', '--popover'])
        check('Status', `${status} text on ${s.slice(2)}`, fill, c(s), TEXT);
    check('Status', `${status} text on ${status}/15 tint over card`, fill, over(fill, 0.15, c('--card')), TEXT);
}

// Charts are drawn on cards.
for (let i = 1; i <= 5; i++) check('Charts', `chart-${i} on card`, c(`--chart-${i}`), c('--card'), GRAPHIC);

// Scrollbars: the thumb (its outline in WebKit/Blink, the whole thumb in Firefox) against the
// track. A transparent track shows whatever scrolls: pages, cards, dialogs, console, editor.
const tracks =
    tokens['--scrollbar-track'] === 'transparent'
        ? ['--background', '--card', '--popover', '--terminal-background', '--editor-background']
        : ['--scrollbar-track'];
for (const s of tracks) check('Chrome', `scrollbar thumb on ${s.slice(2)}`, c('--scrollbar-thumb'), c(s), GRAPHIC);

// Text selection: --selection-foreground replaces the colour of every selected run of text,
// and the highlight itself has to stand out from the surface it is painted on.
check('Selection', 'selection-foreground on selection', c('--selection-foreground'), c('--selection'), TEXT);
for (const s of SURFACES) check('Selection', `selection on ${s.slice(2)}`, c('--selection'), c(s), GRAPHIC);

// Terminal. ANSI black is a background colour by convention and is exempt.
const term = c('--terminal-background');
check('Terminal', 'foreground (uncoloured output)', c('--terminal-foreground'), term, TEXT);
for (const name of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']) {
    check('Terminal', `ansi ${name}`, c(`--terminal-ansi-${name}`), term, TEXT);
    check('Terminal', `ansi bright-${name}`, c(`--terminal-ansi-bright-${name}`), term, TEXT);
}
check('Terminal', 'ansi bright-black (dim text)', c('--terminal-ansi-bright-black'), term, TEXT);
check(
    'Terminal',
    'selection foreground on selection',
    c('--terminal-selection-foreground'),
    c('--terminal-selection'),
    TEXT
);
check('Terminal', 'selection on background', c('--terminal-selection'), term, GRAPHIC);

// Editor.
const editor = c('--editor-background');
check('Editor', 'foreground', c('--editor-foreground'), editor, TEXT);
check('Editor', 'muted (comments, line numbers)', c('--editor-muted'), editor, TEXT);
check('Editor', 'foreground on active line', c('--editor-foreground'), c('--editor-active-line'), TEXT);
check('Editor', 'foreground on selection', c('--editor-foreground'), c('--editor-selection'), TEXT);
check('Editor', 'selected-foreground on selection', c('--editor-selected-foreground'), c('--editor-selection'), TEXT);
check('Editor', 'foreground on search match', c('--editor-foreground'), c('--editor-search-match'), TEXT);
check(
    'Editor',
    'foreground on selected search match',
    c('--editor-foreground'),
    c('--editor-search-match-selected'),
    TEXT
);
check('Editor', 'foreground on tooltip', c('--editor-foreground'), c('--editor-tooltip'), TEXT);
check('Editor', 'caret', c('--editor-caret'), editor, GRAPHIC);
for (const name of ['keyword', 'name', 'function', 'constant', 'definition', 'type', 'operator', 'string', 'invalid']) {
    check('Editor', `syntax ${name}`, c(`--editor-syntax-${name}`), editor, TEXT);
}

// Informational only: decorative lines are not required to hit 3:1, but it is useful to see them.
const info = [
    ['border on background', ratio(c('--border'), c('--background'))],
    ['border on card', ratio(c('--border'), c('--card'))],
    ['input fill on card', ratio(c('--input'), c('--card'))],
    ['card on background', ratio(c('--card'), c('--background'))],
];

// color.ts hard-codes two theme values for the runtime accent maths; make sure they still match.
const drift = [];
const same = (name, expected) => {
    const actual = linearToOklch(resolve(name));
    if (Math.abs(actual.l - expected.l) > 0.001 || Math.abs(actual.c - expected.c) > 0.001) drift.push(name);
};
same('--secondary', LIGHTEST_SURFACE);
same('--primary-foreground', INK);

// Browser chrome. --color-scheme must agree with the palette; the toolbar colour should
// continue the page; and the server-rendered theme-color (DarkThemeProvider) must equal the
// token, because the panel never overwrites a tag an extension registered.
const darkPalette = luminance(clamp(c('--background'))) < luminance(clamp(c('--foreground')));
if (tokens['--color-scheme'] !== (darkPalette ? 'dark' : 'light'))
    drift.push('--color-scheme (does not match the palette)');
if (ratio(c('--theme-color'), c('--background')) > 1.05) drift.push('--theme-color (no longer matches --background)');
const providerPath = fileURLToPath(new URL('../src/DarkThemeProvider.php', import.meta.url));
if (existsSync(providerPath)) {
    const serverThemeColor = /THEME_COLOR\s*=\s*'([^']+)'/.exec(readFileSync(providerPath, 'utf8'))?.[1];
    if (serverThemeColor !== undefined && serverThemeColor.toLowerCase() !== tokens['--theme-color'].toLowerCase()) {
        drift.push('--theme-color (DarkThemeProvider::THEME_COLOR differs)');
    }
}

// Sweep the admin accent setting: 36 hues x 4 input styles, every derived token must pass too.
let accentWorst = Infinity;
let accentFailures = 0;
for (let h = 0; h < 360; h += 10) {
    for (const [l, ch] of [
        [0.3, 0.1],
        [0.6, 0.25],
        [0.9, 0.05],
        [0.5, 0],
    ]) {
        const rgb = clamp(oklchToLinear({ l, c: ch, h })).map((v) => Math.round(encode(v) * 255));
        const hex = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
        // The settings field stores hex or oklch(); alternate so both parsers are swept.
        const derived = deriveAccent((h / 10) % 2 ? `oklch(${l} ${ch} ${h})` : hex);
        const parse = (s) => resolve(s);
        for (const s of SURFACES.filter((x) => x !== '--input')) {
            for (const key of ['--primary', '--accent']) {
                const r = ratio(parse(derived[key]), c(s));
                accentWorst = Math.min(accentWorst, r);
                if (r < TEXT) accentFailures++;
            }
        }
        for (const key of ['--primary', '--accent']) {
            const r = ratio(c('--primary-foreground'), parse(derived[key]));
            accentWorst = Math.min(accentWorst, r);
            if (r < TEXT) accentFailures++;
        }
        if (ratio(parse(derived['--ring']), c('--popover')) < GRAPHIC) accentFailures++;
    }
}

const markdown = process.argv.includes('--md');
const failures = rows.filter((r) => r.value < r.min);
if (markdown) {
    console.log('| Group | Pair | Ratio | Needs |');
    console.log('| --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.group} | ${r.label} | ${r.value.toFixed(2)} | ${r.min} |`);
} else {
    for (const r of rows) {
        console.log(
            `${r.value < r.min ? 'FAIL' : ' ok '}  ${r.value.toFixed(2).padStart(6)}  (>= ${r.min})  ${r.group}: ${r.label}`
        );
    }
}
console.log('');
for (const [label, value] of info)
    console.log(`info  ${value.toFixed(2).padStart(6)}  ${label} (decorative, no requirement)`);
console.log(
    `\naccent setting sweep: 144 colours, worst text ratio ${accentWorst.toFixed(2)}, failures ${accentFailures}`
);
console.log(
    `${rows.length} pairs checked, ${failures.length} below threshold` +
        (drift.length ? `; color.ts out of sync with ${drift.join(', ')}` : '')
);
process.exit(failures.length || accentFailures || drift.length ? 1 : 0);
