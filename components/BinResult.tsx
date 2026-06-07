import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BINS } from '../constants/bins';
import { BinCategory } from '../types';

type Props = {
  bin: BinCategory;
  item: string;
  reason: string;
  confidence: number;
};

export function BinResult({ bin, item, reason, confidence }: Props) {
  const def = BINS[bin] ?? BINS.grey;
  const isLight = bin === 'white' || bin === 'yellow' || bin === 'grey';

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: def.color },
        def.borderColor ? { borderWidth: 1.5, borderColor: def.borderColor } : null,
      ]}
    >
      {item ? (
        <Text style={[styles.item, { color: def.textColor }]}>{item}</Text>
      ) : null}
      <Text style={[styles.label, { color: def.textColor }]}>{def.label}</Text>
      <Text style={[styles.description, { color: def.textColor }]}>{def.description}</Text>
      <Text style={[styles.reason, { color: def.textColor }]}>{reason}</Text>
      {confidence > 0 ? (
        <Text style={[styles.confidence, { color: def.textColor }]}>
          AI Confidence: {Math.round(confidence * 100)}%
        </Text>
      ) : null}

      <View style={[styles.examplesBox, isLight ? styles.examplesBoxLight : styles.examplesBoxDark]}>
        <Text style={[styles.examplesLabel, { color: def.textColor }]}>Examples</Text>
        <Text style={[styles.examples, { color: def.textColor }]}>{def.examples}</Text>
      </View>

      {def.dropOff ? (
        <View style={styles.dropOffBox}>
          <Text style={styles.dropOffLabel}>DROP-OFF REQUIRED</Text>
          <Text style={styles.dropOffText}>{def.dropOff}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 24,
    width: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  item: {
    fontSize: 15,
    fontWeight: '600',
    opacity: 0.75,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  label: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  description: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.9,
  },
  reason: {
    fontSize: 15,
    marginBottom: 8,
  },
  confidence: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.85,
    marginBottom: 12,
  },
  examplesBox: {
    borderRadius: 8,
    padding: 10,
    marginBottom: 0,
  },
  examplesBoxDark: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  examplesBoxLight: {
    backgroundColor: 'rgba(0,0,0,0.07)',
  },
  examplesLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  examples: {
    fontSize: 13,
  },
  dropOffBox: {
    marginTop: 12,
    backgroundColor: '#FF6F00',
    borderRadius: 8,
    padding: 12,
  },
  dropOffLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  dropOffText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
});
