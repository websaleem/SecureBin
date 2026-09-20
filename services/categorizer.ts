import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CategorizationResult } from '../types';
import { getLocation } from './location';
import { deleteQuietly } from './files';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
if (!API_BASE) {
  throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured');
}
const MAX_IMAGE_PX = 1024;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 30;

// Must match the content-length-range in the presign Lambda's POST policy.
// S3 rejects anything larger with 400 EntityTooLarge *before* the object is
// created, so the upload trigger never fires, the categorizer never runs, and
// the job sits at `pending` until the poll below gives up — which reaches the
// user as a categorization failure even though nothing was ever categorized.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Stay clear of the hard cap: a marginal encode should not be what decides
// whether a scan works.
const UPLOAD_BYTE_BUDGET = 4 * 1024 * 1024;

// Long-edge targets, tried in order. 1024 is the intended size; the smaller
// steps are only reached if the first is somehow still over budget.
const RESIZE_STEPS = [MAX_IMAGE_PX, 768, 512];

/**
 * Why a scan failed, so the UI can say something true about it.
 *
 * Without this, an upload rejected for size and a photo the model genuinely
 * could not read produced the same "Categorization Failed" alert, which sent
 * the user off retaking a perfectly good photo.
 */
export type ScanErrorKind =
  | 'IMAGE_TOO_LARGE'
  | 'UPLOAD_REJECTED'
  | 'NETWORK'
  | 'BACKEND'
  | 'TIMEOUT';

export class ScanError extends Error {
  readonly kind: ScanErrorKind;

  constructor(kind: ScanErrorKind, message: string) {
    super(message);
    this.name = 'ScanError';
    this.kind = kind;
    // Subclassing Error loses the prototype chain under some RN/TS transpile
    // targets, which would break any `instanceof` check on this type.
    Object.setPrototypeOf(this, ScanError.prototype);
  }
}

type PresignResponse = { uploadUrl: string; uploadFields: Record<string, string>; jobId: string };
type JobResult = {
  status: 'pending' | 'done' | 'failed';
  bin?: string;
  item?: string;
  reason?: string;
  confidence?: number;
  error?: string;
  errorCode?: 'UNCLEAR_IMAGE' | 'MODEL_BUSY' | 'INTERNAL_ERROR';
};

type Dims = { width: number; height: number };

/**
 * Dimensions are usable only if both are finite and positive.
 *
 * `Math.max(undefined, undefined)` is NaN, and every comparison against NaN is
 * false — so a dimension that fails to read made the old "is this image too
 * big?" test answer "no" and skip the resize entirely.
 */
function readDims(ref: { width?: number; height?: number } | null): Dims | null {
  const width = Number(ref?.width);
  const height = Number(ref?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function describe(dims: Dims | null): string {
  return dims ? `${dims.width}x${dims.height}` : 'unreadable';
}

/**
 * Downscale for upload, and verify it actually happened.
 *
 * This previously resized only when the source measured larger than the target
 * and returned the original otherwise — which fails open. A production upload
 * was found on S3 at 3152x2856 and 3.78 MB, so the resize had not run despite
 * the source being far over the limit; anything past 5 MB is refused by S3
 * outright. Two changes follow from that: resize unconditionally rather than
 * only when a comparison proves it necessary, and check the encoded size
 * afterwards instead of assuming the resize worked.
 */
async function resizeImage(imageUri: string): Promise<string> {
  const sourceRef = await ImageManipulator.manipulate(imageUri).renderAsync();
  const sourceDims = readDims(sourceRef);

  let best: string | null = null;
  let bestBytes = Number.POSITIVE_INFINITY;

  for (const longEdge of RESIZE_STEPS) {
    // Constrain whichever axis is longer, so `longEdge` really is the long
    // edge. With dimensions unreadable, constrain the width: the result is
    // then bounded by aspect ratio rather than left at full resolution.
    const opts = sourceDims && sourceDims.height > sourceDims.width
      ? { height: longEdge }
      : { width: longEdge };

    // Skip the resize only when the source is *known* to be within the target;
    // upscaling a small photo would cost bytes and gain nothing. Unknown
    // dimensions resize, because that is the case the old code got wrong.
    const withinTarget =
      sourceDims !== null && Math.max(sourceDims.width, sourceDims.height) <= longEdge;
    const ref = withinTarget
      ? sourceRef
      : await ImageManipulator.manipulate(sourceRef).resize(opts).renderAsync();
    const { uri } = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
    const bytes = new File(uri).size;

    // `out` is the decisive field: if it is still the source dimensions after
    // resized=true, the manipulator accepted the resize and did not apply it.
    console.log(
      `[scan] resize longEdge=${longEdge} resized=${!withinTarget} ` +
      `source=${describe(sourceDims)} out=${describe(readDims(ref))} bytes=${bytes}`,
    );

    if (best) deleteQuietly(best);
    best = uri;
    bestBytes = bytes;

    // size 0 means the file could not be read, not that it is empty. Nothing
    // is learned by shrinking again, so take the result and let the upload
    // report the truth.
    if (bytes === 0 || bytes <= UPLOAD_BYTE_BUDGET) return uri;
  }

  if (best && bestBytes > MAX_UPLOAD_BYTES) {
    deleteQuietly(best);
    throw new ScanError(
      'IMAGE_TOO_LARGE',
      'That photo was too large to send, even after shrinking it. Please try again.',
    );
  }

  // Between the budget and the hard cap: larger than intended, but S3 will
  // still accept it, so attempting the upload beats refusing outright.
  return best as string;
}

export async function categorizeImage(imageUri: string): Promise<CategorizationResult> {
  const resizedUri = await resizeImage(imageUri);
  try {
    return await categorizeResized(resizedUri);
  } finally {
    // The resized copy exists only for this upload. The caller still owns
    // imageUri — it copies that into scan history afterwards — so never delete
    // it, even if the manipulator happened to hand back the same path.
    if (resizedUri !== imageUri) deleteQuietly(resizedUri);
  }
}

async function categorizeResized(resizedUri: string): Promise<CategorizationResult> {
  // Step 1: request pre-signed S3 upload URL (include location for council-specific advice)
  const location = await getLocation();
  const params = new URLSearchParams({ mediaType: 'image/jpeg' });
  if (location) {
    params.set('state', location.state);
    params.set('council', location.council);
  }
  // Bypass CloudFront caching. Presign URLs must be unique per request.
  params.set('t', Date.now().toString());
  
  const presignRes = await fetch(`${API_BASE}/presign?${params}`);
  if (!presignRes.ok) throw new Error(`Presign error: ${presignRes.status}`);
  const { uploadUrl, uploadFields, jobId } = (await presignRes.json()) as PresignResponse;
  if (!/^[a-zA-Z0-9\-]+$/.test(jobId)) throw new Error('Invalid jobId format');

  // Step 2: upload image directly to S3 via pre-signed POST form
  // Step 2: upload image directly to S3 via pre-signed POST form
  // Use the modern Expo File API natively to bypass deprecation warnings.
  // CRITICAL FIX: ImageManipulator overwrites the same cache file path if manipulated quickly.
  // If we try to fetch() a file that is actively mutating in a subsequent scan, whatwg-fetch throws a network crash.
  // We MUST copy it to a strictly unique path before uploading.
  const uniqueId = Date.now().toString() + Math.random().toString(36).substring(7);
  const manipFile = new File(resizedUri);
  const uniqueFile = new File(manipFile.parentDirectory, `upload_${uniqueId}.jpg`);
  await manipFile.copy(uniqueFile);

  const formData = new FormData();
  for (const [key, value] of Object.entries(uploadFields)) {
    formData.append(key, value);
  }
  
  // Use raw React Native URI format instead of `new File()` because the fetch polyfill crashes on Expo File objects.
  formData.append('file', {
    uri: uniqueFile.uri,
    name: 'upload.jpg',
    type: 'image/jpeg',
  } as any);

  try {
    // Completely bypass whatwg-fetch polyfill by using native XMLHttpRequest
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);
      xhr.setRequestHeader('Connection', 'close'); // Aggressively tear down socket
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        // The response body carries S3's own error code. EntityTooLarge means
        // the POST policy's size condition refused it, which is a fact about
        // the photo, not about the service.
        const body = xhr.responseText ?? '';
        console.log(`[scan] upload rejected status=${xhr.status} body=${body.slice(0, 300)}`);
        if (xhr.status === 400 && body.includes('EntityTooLarge')) {
          reject(new ScanError(
            'IMAGE_TOO_LARGE',
            'That photo was too large to send. Please try again.',
          ));
        } else {
          reject(new ScanError(
            'UPLOAD_REJECTED',
            `The photo could not be uploaded (error ${xhr.status}). Please try again.`,
          ));
        }
      };
      xhr.onerror = () => reject(new ScanError(
        'NETWORK',
        'Could not reach SecureBin. Check your connection and try again.',
      ));
      xhr.send(formData);
    });
  } finally {
    // Always clean up the temporary unique file to prevent disk leaks
    deleteQuietly(uniqueFile.uri);
  }

  // Step 3: poll for categorization result
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const resultRes = await fetch(`${API_BASE}/result/${jobId}`);
    if (!resultRes.ok) throw new Error(`Result API error: ${resultRes.status}`);
    const data = (await resultRes.json()) as JobResult;

    if (data.status === 'done') {
      if (!['red', 'green', 'yellow', 'white', 'purple', 'blue', 'orange', 'grey'].includes(data.bin ?? '')) {
        throw new Error(`Unexpected bin value: ${data.bin}`);
      }
      // Normalise confidence to 0–1 regardless of whether Bedrock returns 0.85 or 85
      const rawConf = Number(data.confidence ?? 0);
      const confidence = rawConf > 1 ? rawConf / 100 : rawConf;
      return {
        bin: data.bin as CategorizationResult['bin'],
        item: data.item ?? '',
        reason: data.reason ?? '',
        confidence,
      };
    }
    if (data.status === 'failed') {
      // The backend already returns a user-safe message tailored to the failure
      // class, so surface it as-is rather than prefixing it with our own guess.
      console.log(`[scan] backend failure jobId=${jobId} errorCode=${data.errorCode}`);
      throw new ScanError(
        'BACKEND',
        data.error ?? 'Could not categorize the item. Please try again.',
      );
    }
  }

  // The job never left `pending`. The usual cause is an upload that never
  // produced an object, so nothing ever triggered the categorizer.
  console.log(`[scan] timed out waiting for jobId=${jobId}`);
  throw new ScanError(
    'TIMEOUT',
    'The scan is taking longer than expected. Please try again.',
  );
}
