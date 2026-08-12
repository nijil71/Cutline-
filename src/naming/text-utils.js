// Character-level cleanup shared by the slug and title layers.
//
// These are written as explicit code-point checks rather than regex escapes on
// purpose: the characters involved are invisible, so a literal in a character
// class is impossible to review and easy to corrupt in a later edit.

const INVISIBLE = new Set([
  0x200b, // zero-width space   — Edge puts one inside "Microsoft Edge"
  0x200c, // zero-width non-joiner
  0x200d, // zero-width joiner
  0x200e, // left-to-right mark
  0x200f, // right-to-left mark
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embedding/override
  0x2060, // word joiner
  0xfeff, // BOM / zero-width no-break space
]);

/** Strip zero-width and bidi-control characters. */
export function stripInvisible(input) {
  if (input == null) return '';
  let out = '';
  for (const ch of String(input)) {
    if (!INVISIBLE.has(ch.codePointAt(0))) out += ch;
  }
  return out;
}

/** Strip combining marks. Run after NFKD so accents become separate marks. */
export function stripCombiningMarks(input) {
  if (input == null) return '';
  let out = '';
  for (const ch of String(input)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    out += ch;
  }
  return out;
}

/** Drop C0/C1 control characters and DEL. */
export function stripControls(input) {
  if (input == null) return '';
  let out = '';
  for (const ch of String(input)) {
    const cp = ch.codePointAt(0);
    if (cp < 32 || cp === 127) continue;
    out += ch;
  }
  return out;
}
