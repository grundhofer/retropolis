import { generateHexId, HEX_ID_PATTERN, hexIdSchema } from "./ids.js";

// Session keys are client-minted BEFORE the first join and sent with every
// join, so joining is idempotent: if the first sync is lost to a flaky
// connection, the retry presents the same key and reclaims the same
// participant instead of creating an offline ghost. 128-bit hex — the shape
// is enforced at the protocol boundary so nobody can register a guessable key.
export const SESSION_KEY_PATTERN = HEX_ID_PATTERN;

export const sessionKeySchema = hexIdSchema;

export const generateSessionKey = generateHexId;
