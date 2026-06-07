import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COUNCILS, NATIONAL_REFERENCES, STATE_AUTHORITIES, getCouncilUrl } from '../constants/councils';

const STATE_ORDER = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(url)} activeOpacity={0.7}>
      <Text style={styles.linkLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.linkChevron}>›</Text>
    </TouchableOpacity>
  );
}

export default function AboutScreen() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>Information Sources</Text>

      <View style={styles.disclaimerCard}>
        <Text style={styles.cardTitle}>Non-affiliation disclaimer</Text>
        <Text style={styles.cardBody}>
          SecureBin is an independent app developed by websaleem.com. It is not
          endorsed by, affiliated with, or operated on behalf of any Australian
          local council, state government, or federal government agency.
        </Text>
        <Text style={[styles.cardBody, { marginTop: 10 }]}>
          Bin guidance shown in this app is general information based on
          publicly available official council and state government sources
          (listed below). Rules vary between
          councils and change over time. Always confirm with your council
          before disposing of any item.
        </Text>
      </View>

      <Text style={styles.h2}>Standards & national references</Text>
      <View style={styles.linkList}>
        {NATIONAL_REFERENCES.map(ref => (
          <LinkRow key={ref.url} label={ref.label} url={ref.url} />
        ))}
      </View>

      <Text style={styles.h2}>State & territory waste authorities</Text>
      <View style={styles.linkList}>
        {STATE_ORDER.map(s => {
          const auth = STATE_AUTHORITIES[s];
          if (!auth) return null;
          return <LinkRow key={s} label={`${s} — ${auth.label}`} url={auth.url} />;
        })}
      </View>

      <Text style={styles.h2}>Council waste & recycling pages</Text>
      <Text style={styles.sectionNote}>
        SecureBin uses publicly available information from each council's
        official website. Tap a council to open its waste-and-recycling page.
        Where a specific page is not yet listed, the link opens the relevant
        state authority page.
      </Text>

      {STATE_ORDER.map(state => {
        const councils = COUNCILS[state];
        if (!councils?.length) return null;
        return (
          <View key={state} style={styles.stateGroup}>
            <Text style={styles.stateHeader}>{state}</Text>
            <View style={styles.linkList}>
              {councils.map(c => (
                <LinkRow key={`${state}:${c}`} label={c} url={getCouncilUrl(state, c)} />
              ))}
            </View>
          </View>
        );
      })}

      <Text style={styles.footer}>
        Always verify with your council. Bin rules change.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 48 },
  h1: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 14,
  },
  h2: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 28,
    marginBottom: 10,
  },
  sectionNote: {
    fontSize: 13,
    color: '#555',
    lineHeight: 19,
    marginBottom: 12,
  },
  disclaimerCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a1a1a',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#333',
  },
  linkList: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  linkLabel: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },
  linkChevron: {
    fontSize: 20,
    color: '#bbb',
    marginLeft: 8,
  },
  stateGroup: {
    marginTop: 18,
  },
  stateHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a7d6f',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  footer: {
    marginTop: 32,
    fontSize: 13,
    fontStyle: 'italic',
    color: '#777',
    textAlign: 'center',
  },
});
