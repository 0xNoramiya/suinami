/**
 * Input sanitization — the single injection-safety layer, shared by the API
 * (on write) and the web client (on optimistic render), so both agree exactly.
 *
 * Threat model & defenses:
 *  - XSS: comment text is NEVER turned into HTML. The server returns it as a
 *    JSON string; the client renders it through React text nodes (auto-escaped).
 *    We therefore do NOT HTML-entity-encode here (that would double-escape in
 *    React and corrupt legitimate text like "a < b"). The rule the rest of the
 *    codebase must uphold: render comment fields as {text}, never via
 *    dangerouslySetInnerHTML / innerHTML.
 *  - Control / invisible-char injection & spoofing: we strip C0/C1 control
 *    chars (keeping \n, \t), zero-width and BiDi-override characters, so
 *    attackers can't smuggle hidden or direction-flipping payloads.
 *  - Resource abuse: hard length caps (enforced again by zod on the server).
 *  - SQL injection: handled at the storage layer by Drizzle's parameterized
 *    queries — never string-concatenated SQL.
 */

/** Max stored comment length (characters, post-sanitize). */
export const MAX_COMMENT_LENGTH = 500;
/** Max display-handle length. */
export const MAX_HANDLE_LENGTH = 24;

// C0 controls except \t (09) \n (0A) \r (0D, normalized later), plus DEL + C1.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
// Zero-width: ZWSP, ZWNJ, ZWJ, word-joiner, BOM/ZWNBSP.
const ZERO_WIDTH = /[​-‍⁠﻿]/g;
// BiDi: LRE, RLE, PDF, LRO, RLO + isolates LRI, RLI, FSI, PDI.
const BIDI_OVERRIDES = /[‪-‮⁦-⁩]/g;

/** Strip the characters that have no business in user text, on any field. */
function stripUnsafe(input: string): string {
  return input
    .normalize("NFC")
    .replace(CONTROL_CHARS, "")
    .replace(ZERO_WIDTH, "")
    .replace(BIDI_OVERRIDES, "");
}

/**
 * Sanitize a comment body: coerce, strip unsafe chars, normalize whitespace
 * (keep single blank lines, collapse runs), trim, and hard-cap the length.
 * Returns "" when nothing printable remains (caller rejects empty).
 */
export function sanitizeCommentText(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input.replace(/\r\n?/g, "\n"); // normalize newlines first
  s = stripUnsafe(s);
  s = s.replace(/[ \t]+/g, " "); // collapse horizontal whitespace
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n"); // trim around newlines
  s = s.replace(/\n{3,}/g, "\n\n"); // at most one blank line
  s = s.trim();
  if (s.length > MAX_COMMENT_LENGTH) s = s.slice(0, MAX_COMMENT_LENGTH).trim();
  return s;
}

/**
 * Sanitize a display handle: single line, no unsafe chars, trimmed, capped.
 * Falls back to "guest" when empty.
 */
export function sanitizeHandle(input: unknown): string {
  if (typeof input !== "string") return "guest";
  let s = stripUnsafe(input).replace(/\s+/g, " ").trim();
  if (s.length > MAX_HANDLE_LENGTH) s = s.slice(0, MAX_HANDLE_LENGTH).trim();
  return s.length > 0 ? s : "guest";
}

/** Compact a Sui address to "0x1234…cdef" for display. */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr) return "";
  const a = addr.trim();
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
