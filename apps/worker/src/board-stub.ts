// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BoardRoom } from "./board-room.js";

let jurisdictionSupported: boolean | null = null;

// All board DOs live in the EU jurisdiction (GDPR / decided). The same name in
// a different jurisdiction would be a DIFFERENT object, so every access path
// must go through this helper.
//
// Local workerd (vite dev, wrangler dev, vitest-pool-workers) throws
// "Jurisdiction restrictions are not implemented in workerd" — production
// Cloudflare implements them. The fallback below exists ONLY for local
// runtimes; EU pinning must be smoke-checked against production after deploy.
function boardNamespace(env: Env): DurableObjectNamespace<BoardRoom> {
  if (jurisdictionSupported === false) return env.BOARD_ROOM;
  try {
    const namespace = env.BOARD_ROOM.jurisdiction("eu");
    jurisdictionSupported = true;
    return namespace;
  } catch (error) {
    // ONLY the local-workerd error may fall through to the plain namespace.
    // Anything else must throw: silently falling back in production would
    // resolve the same board name to a DIFFERENT object (and outside the EU),
    // making existing boards appear empty.
    if (error instanceof Error && /not implemented/i.test(error.message)) {
      jurisdictionSupported = false;
      return env.BOARD_ROOM;
    }
    throw error;
  }
}

export function boardStub(
  env: Env,
  boardId: string,
): DurableObjectStub<BoardRoom> {
  const namespace = boardNamespace(env);
  return namespace.get(namespace.idFromName(boardId));
}
