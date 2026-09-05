import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { ScanRecord } from '../types';

const HISTORY_KEY = 'scan_history';

// AsyncStorage is backed by a single SQLite row on Android and has a hard size
// ceiling, and every record also pins a JPEG in the documents directory. Cap the
// list so a heavy user cannot grow it until writes start failing.
const MAX_HISTORY = 200;

function imagesDir(): Directory {
  const dir = new Directory(Paths.document, 'scan_images');
  if (!dir.exists) {
    dir.create();
  }
  return dir;
}

export function saveImageLocally(imageUri: string, id: string): string {
  const dir = imagesDir();
  const dest = new File(dir, `${id}.jpg`);
  const src = new File(imageUri);
  src.copy(dest);
  return dest.uri;
}

export async function getHistory(): Promise<ScanRecord[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ScanRecord[];
  } catch {
    return [];
  }
}

export async function addToHistory(record: ScanRecord): Promise<void> {
  const existing = await getHistory();
  const updated = [record, ...existing];

  // Drop the oldest entries past the cap and remove their images, so the
  // documents directory does not keep growing after the list stops growing.
  const evicted = updated.splice(MAX_HISTORY);
  for (const old of evicted) {
    try {
      const file = new File(old.imageUri);
      if (file.exists) file.delete();
    } catch {
      // ignore missing files
    }
  }

  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

export async function clearHistory(): Promise<void> {
  const records = await getHistory();
  for (const r of records) {
    try {
      const file = new File(r.imageUri);
      if (file.exists) file.delete();
    } catch {
      // ignore missing files
    }
  }
  await AsyncStorage.removeItem(HISTORY_KEY);
}
