import type { TokenSelf } from "./client.js";

/**
 * Does this bearer belong to a read-only Nestr API key?
 *
 * Fails open. Hiding write tools is a convenience: the Nestr API refuses the
 * write either way, so a transient failure here should cost a nicety, never
 * strip a working key's tools. An older API with no /tokens/self answers the
 * same way, by leaving the session as the route set it.
 */
export async function bearerIsReadOnly(
  client: { getTokenSelf: () => Promise<TokenSelf> },
): Promise<boolean> {
  try {
    const token = await client.getTokenSelf();
    return token?.readOnly === true;
  } catch {
    return false;
  }
}
