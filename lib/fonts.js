// Font helpers for widget labels.
//
// The widget fonts (Barlow Condensed, SF Pro Display/Rounded) are vendored in
// fonts/ and installed system-wide by provision.sh, together with a fontconfig
// alias file (provision/fontconfig/49-peachos-widgets.conf) that maps
// keyword-free names -- Pango parses a literal "Barlow Condensed" as family
// "Barlow" + condensed-stretch and fails otherwise. Use the alias names below
// in St `font-family` (via fontStyle()).

import Pango from 'gi://Pango';

export const FONT = {
    clock: 'PeachClock',            // Barlow Condensed Medium
    rounded: 'PeachRounded',        // SF Pro Rounded
    display: 'PeachDisplay',        // SF Pro Display Regular
    displayThin: 'PeachDisplayThin', // SF Pro Display Thin
};

/**
 * Inline St style string for a text label on the glass/solid card.
 * @param {string} family
 * @param {number} px
 * @param {number} opacity
 * @param {string} rgb  content foreground "r,g,b" (from the glass mode); a
 *   dark value skips the legibility shadow.
 */
export function fontStyle(family, px, opacity = 1, rgb = '255,255,255') {
    const dark = rgb.startsWith('26,') || rgb.startsWith('28,') || rgb.startsWith('0,');
    const shadow = dark ? '' : ' text-shadow: 0 1px 3px rgba(0,0,0,0.3);';
    return `font-family: "${family}"; font-size: ${Math.max(1, Math.round(px))}px; `
        + `color: rgba(${rgb},${opacity});${shadow}`;
}

/** Pango.FontDescription for PangoCairo text. */
export function fontDesc(family, px, bold = false) {
    const d = Pango.FontDescription.from_string(family);
    d.set_absolute_size(Math.max(1, Math.round(px)) * Pango.SCALE);
    if (bold)
        d.set_weight(Pango.Weight.SEMIBOLD);
    return d;
}

export {Pango};
