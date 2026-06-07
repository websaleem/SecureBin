import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocationProfile = {
  state: string;
  council: string;
};

const KEY = 'location_profile';

export async function getLocation(): Promise<LocationProfile | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocationProfile;
  } catch {
    return null;
  }
}

export async function saveLocation(profile: LocationProfile): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(profile));
}

export async function clearLocation(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
