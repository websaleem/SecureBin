import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, TouchableOpacity, Text, View } from 'react-native';
import { BinResult } from '../components/BinResult';
import { BINS } from '../constants/bins';
import { getCouncilUrl } from '../constants/councils';
import { getLocation, LocationProfile } from '../services/location';
import { BinCategory } from '../types';

const VALID_BINS = Object.keys(BINS) as BinCategory[];

function isSafeImageUri(uri: string | undefined): uri is string {
  return !!uri && uri.startsWith('file://') && uri.includes('/scan_images/');
}

export default function ResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    imageUri: string;
    bin: string;
    item?: string;
    reason: string;
    confidence: string;
    readonly?: string;
  }>();

  const [location, setLocation] = useState<LocationProfile | null>(null);
  useEffect(() => {
    getLocation().then(setLocation);
  }, []);

  const bin: BinCategory = VALID_BINS.includes(params.bin as BinCategory)
    ? (params.bin as BinCategory)
    : 'grey';
  const confidence = parseFloat(params.confidence ?? '0');
  const isReadonly = params.readonly === '1';
  const safeImageUri = isSafeImageUri(params.imageUri) ? params.imageUri : undefined;

  const councilLabel = location?.council ?? 'your council';
  const councilUrl = location ? getCouncilUrl(location.state, location.council) : null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {safeImageUri ? (
        <View style={styles.imageFrame}>
          <Image source={{ uri: safeImageUri }} style={styles.image} resizeMode="cover" />
        </View>
      ) : null}

      <BinResult bin={bin} item={params.item ?? ''} reason={params.reason ?? ''} confidence={confidence} />

      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerText}>
          Guidance only — bin rules vary and change. Always confirm with{' '}
          {councilLabel} before disposal.
        </Text>
        {councilUrl && (
          <TouchableOpacity
            style={styles.councilLinkBtn}
            onPress={() => Linking.openURL(councilUrl)}
            activeOpacity={0.75}
          >
            <Text style={styles.councilLinkText}>View official council rules →</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isReadonly && (
        <TouchableOpacity style={styles.scanAgainBtn} onPress={() => router.replace('/')}>
          <Text style={styles.scanAgainText}>Scan Another Item</Text>
        </TouchableOpacity>
      )}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { paddingBottom: 40, alignItems: 'center' },
  imageFrame: {
    width: '88%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#fff',
    overflow: 'hidden',
    marginTop: 20,
    marginBottom: 8,
    backgroundColor: '#eee',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  disclaimerBox: {
    width: '88%',
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  disclaimerText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#555',
  },
  councilLinkBtn: {
    marginTop: 10,
  },
  councilLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0a7d6f',
  },
  scanAgainBtn: {
    width: '88%',
    marginTop: 14,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  scanAgainText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
