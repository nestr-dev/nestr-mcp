/**
 * Which image MIME types may be sent to a model as an `image` content block.
 *
 * The Anthropic Messages API accepts exactly four and rejects anything else
 * with a 400 that fails the whole request, not just the offending block, so an
 * agent forwarding such a tool result loses its entire turn. A run died that
 * way on an SVG brand asset read with nestr_read_file. Every image block this
 * server emits is therefore gated on this list, not on an `image/` prefix.
 */
export const MODEL_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

const SUPPORTED = new Set<string>(MODEL_IMAGE_MIME_TYPES);

/** Strip parameters and case: `"IMAGE/PNG; charset=binary"` -> `"image/png"`. */
export function normalizeMimeType(contentType: string | undefined | null): string {
  return (contentType || "").split(";")[0].trim().toLowerCase();
}

/**
 * The model-safe MIME type for a Content-Type, or null when the model cannot
 * take it as an image. `image/jpg` folds onto `image/jpeg`: it is a common
 * mislabelling of the same format, and the bytes behind it are fine.
 */
export function modelImageMimeType(contentType: string | undefined | null): string | null {
  const mime = normalizeMimeType(contentType);
  if (mime === "image/jpg") return "image/jpeg";
  return SUPPORTED.has(mime) ? mime : null;
}

/** Whether a Content-Type is in the image family at all, supported or not. */
export function isImageMimeType(contentType: string | undefined | null): boolean {
  return normalizeMimeType(contentType).startsWith("image/");
}
