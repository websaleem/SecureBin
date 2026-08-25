import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { CategorizationResult } from '../types';
import { getLocation } from './location';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
if (!API_BASE) {
  throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured');
}
const MAX_IMAGE_PX = 1024;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 30;

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

async function resizeImage(imageUri: string): Promise<string> {
  const imageRef = await ImageManipulator.manipulate(imageUri).renderAsync();

  const longSide = Math.max(imageRef.width, imageRef.height);
  const resizeOpts = imageRef.width >= imageRef.height
    ? { width: MAX_IMAGE_PX }
    : { height: MAX_IMAGE_PX };
  const finalRef = longSide > MAX_IMAGE_PX
    ? await ImageManipulator.manipulate(imageRef).resize(resizeOpts).renderAsync()
    : imageRef;

  const { uri } = await finalRef.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return uri;
}

export async function categorizeImage(imageUri: string): Promise<CategorizationResult> {
  const resizedUri = await resizeImage(imageUri);

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
        } else {
          reject(new Error(`S3 upload error: ${xhr.status} - ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error('S3 upload network request failed (XHR)'));
      xhr.send(formData);
    });
  } finally {
    // Always clean up the temporary unique file to prevent disk leaks
    try {
      uniqueFile.delete();
    } catch (e) {
      // Ignore cleanup errors
    }
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
      throw new Error(
        data.error ?? 'Could not categorize the item. Please try again.',
      );
    }
  }

  throw new Error(`Categorization timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}
