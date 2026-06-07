import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system/next';
import { ScanRecord } from '../types';

const HISTORY_KEY = 'scan_history';

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
  return JSON.parse(raw) as ScanRecord[];
}

export async function addToHistory(record: ScanRecord): Promise<void> {
  const existing = await getHistory();
  const updated = [record, ...existing];
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
