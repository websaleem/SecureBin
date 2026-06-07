import { Stack } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HistoryItem } from '../components/HistoryItem';
import { useHistory } from '../hooks/useHistory';

export default function HistoryScreen() {
  const { records, loading, clear } = useHistory();
  const insets = useSafeAreaInsets();

  function handleClear() {
    Alert.alert(
      'Clear History',
      'This will delete all past scans from your device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear All', style: 'destructive', onPress: clear },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () =>
            records.length > 0 ? (
              <TouchableOpacity onPress={handleClear} hitSlop={8}>
                <Text style={styles.headerClearText}>Clear All</Text>
              </TouchableOpacity>
            ) : null,
        }}
      />
      {records.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No scans yet</Text>
          <Text style={styles.emptyHint}>Scan an item to see its history here.</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <HistoryItem record={item} />}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 15,
    color: '#757575',
    textAlign: 'center',
  },
  headerClearText: {
    color: '#F44336',
    fontWeight: '700',
    fontSize: 15,
  },
});
