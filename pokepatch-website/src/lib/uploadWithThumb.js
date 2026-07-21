/**
 * Upload a display image plus its .thumb.webp sibling to a Storage bucket.
 * Used by QuoteForm (direct client upload). Failures on the thumb are logged
 * but do not fail the main upload (list UIs fall back to full).
 */
import { thumbPath } from "@/lib/imageCompression";

/** Long browser/CDN TTL — paths are unique; assets are never overwritten. */
const IMMUTABLE_CACHE_CONTROL = "604800"; // 7 days

export async function uploadImageWithThumb(
  supabase,
  bucket,
  path,
  displayFile,
  thumbFile
) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, displayFile, {
      upsert: false,
      contentType: displayFile.type || undefined,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  if (error) throw error;

  if (thumbFile) {
    // INSERT only — card-photos RLS has no UPDATE policy, and upsert:true
    // requires UPDATE (see Supabase storage upsert + RLS). Duplicate is fine.
    const { error: thumbError } = await supabase.storage
      .from(bucket)
      .upload(thumbPath(path), thumbFile, {
        upsert: false,
        contentType: thumbFile.type || "image/webp",
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
    const alreadyExists =
      thumbError &&
      (thumbError.statusCode === "409" ||
        thumbError.statusCode === 409 ||
        /already exists/i.test(thumbError.message || ""));
    if (thumbError && !alreadyExists) {
      console.warn("thumb upload failed", path, thumbError);
    }
  }

  return path;
}
