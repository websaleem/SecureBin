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

type PresignResponse = { uploadUrl: string; jobId: string };
type JobResult = {
  status: 'pending' | 'done' | 'failed';
  bin?: string;
  item?: string;
  reason?: string;
  confidence?: number;
  error?: string;
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
  const presignRes = await fetch(`${API_BASE}/presign?${params}`);
  if (!presignRes.ok) throw new Error(`Presign error: ${presignRes.status}`);
  const { uploadUrl, jobId } = (await presignRes.json()) as PresignResponse;

  // Step 2: upload image directly to S3 via pre-signed URL
  const fileRes = await fetch(resizedUri);
  const blob = await fileRes.blob();
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!uploadRes.ok) throw new Error(`S3 upload error: ${uploadRes.status}`);

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
      throw new Error(`Categorization failed: ${data.error ?? 'unknown'}`);
    }
  }

  throw new Error(`Categorization timed out after ${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`);
}
