import { File } from 'expo-file-system';

/**
 * Delete a local file if it exists, ignoring failures.
 *
 * For temporary scan images only, where a missed deletion costs cache space and
 * nothing else — so it must never throw into the scan flow.
 */
export function deleteQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone, or not ours to delete.
  }
}
