import { useRouter } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BINS } from '../constants/bins';
import { ScanRecord } from '../types';

type Props = {
  record: ScanRecord;
};

export function HistoryItem({ record }: Props) {
  const router = useRouter();
  const def = BINS[record.bin] ?? BINS.grey;
  const date = new Date(record.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  function handlePress() {
    router.push({
      pathname: '/result',
      params: {
        imageUri: record.imageUri,
        bin: record.bin,
        item: record.item,
        reason: record.reason,
        confidence: String(record.confidence),
        readonly: '1',
      },
    });
  }

  return (
    <TouchableOpacity style={styles.row} onPress={handlePress} activeOpacity={0.75}>
      <Image source={{ uri: record.imageUri }} style={styles.thumb} />
      <View style={[styles.badge, { backgroundColor: def.color }, def.borderColor ? { borderWidth: 1, borderColor: def.borderColor } : null]}>
        <Text style={[styles.badgeText, { color: def.textColor }]}>{def.label}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.reason} numberOfLines={2}>{record.reason}</Text>
        <Text style={styles.date}>
          {dateStr} · {timeStr}
          {record.confidence > 0 ? ` · ${Math.round(record.confidence * 100)}% Match` : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 12,
  },
  thumb: {
    width: 75,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#eee',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 64,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  meta: {
    flex: 1,
  },
  reason: {
    fontSize: 14,
    color: '#212121',
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: '#757575',
  },
});
