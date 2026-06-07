import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COUNCILS } from '../constants/councils';
import { getLocation, saveLocation } from '../services/location';

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];

export default function SetupScreen() {
  const router = useRouter();
  const [selectedState, setSelectedState] = useState('');
  const [selectedCouncil, setSelectedCouncil] = useState('');
  const [isUpdate, setIsUpdate] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    getLocation().then(loc => {
      if (loc) {
        setSelectedState(loc.state);
        setSelectedCouncil(loc.council);
        setIsUpdate(true);
      }
    });
  }, []);

  const councils = useMemo(
    () => COUNCILS[selectedState] ?? [],
    [selectedState],
  );

  const filteredCouncils = useMemo(
    () => councils.filter(c => c.toLowerCase().includes(search.toLowerCase())),
    [councils, search],
  );

  function handleStateSelect(state: string) {
    setSelectedState(state);
    setSelectedCouncil('');
  }

  function handleCouncilSelect(council: string) {
    setSelectedCouncil(council);
    setSearch('');
    setPickerVisible(false);
  }

  function closePicker() {
    setPickerVisible(false);
    setSearch('');
  }

  const canSave = selectedState !== '' && selectedCouncil !== '';

  async function handleSave() {
    if (!canSave) return;
    await saveLocation({ state: selectedState, council: selectedCouncil });
    if (isUpdate) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {isUpdate && (
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.title}>
          {isUpdate ? 'Update Location' : 'Welcome to SecureBin'}
        </Text>
        <Text style={styles.subtitle}>
          {isUpdate
            ? 'Change your state and council for accurate bin advice.'
            : 'Tell us where you are so we can give you accurate, council-specific bin advice.'}
        </Text>

        <Text style={styles.sectionLabel}>State or Territory</Text>
        <View style={styles.stateGrid}>
          {STATES.map(s => (
            <TouchableOpacity
              key={s}
              style={[styles.stateBtn, selectedState === s && styles.stateBtnSelected]}
              onPress={() => handleStateSelect(s)}
              activeOpacity={0.75}
            >
              <Text style={[styles.stateBtnText, selectedState === s && styles.stateBtnTextSelected]}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Council</Text>
        <TouchableOpacity
          style={[styles.pickerTrigger, !selectedState && styles.pickerTriggerDisabled]}
          onPress={() => selectedState && setPickerVisible(true)}
          activeOpacity={0.75}
        >
          <Text style={[styles.pickerTriggerText, !selectedCouncil && styles.pickerPlaceholder]}>
            {selectedCouncil || (selectedState ? 'Select your council…' : 'Select a state first')}
          </Text>
          <Text style={styles.pickerChevron}>›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>{isUpdate ? 'Save' : 'Continue'}</Text>
        </TouchableOpacity>

        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerTitle}>Independent app</Text>
          <Text style={styles.disclaimerText}>
            SecureBin is not affiliated with, endorsed by, or operated on behalf
            of any council or government agency. Guidance is based on publicly
            available information and may change. Always verify with your
            council before disposal.
          </Text>
          <TouchableOpacity onPress={() => router.push('/about')} activeOpacity={0.7}>
            <Text style={styles.disclaimerLink}>View information sources →</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={pickerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closePicker}
      >
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Council</Text>
            <TouchableOpacity onPress={closePicker}>
              <Text style={styles.modalClose}>Done</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search councils…"
            placeholderTextColor="#9E9E9E"
            value={search}
            onChangeText={setSearch}
            autoFocus
            clearButtonMode="while-editing"
          />

          <FlatList
            data={filteredCouncils}
            keyExtractor={item => item}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.councilRow, item === selectedCouncil && styles.councilRowSelected]}
                onPress={() => handleCouncilSelect(item)}
                activeOpacity={0.7}
              >
                <Text style={[styles.councilRowText, item === selectedCouncil && styles.councilRowTextSelected]}>
                  {item}
                </Text>
                {item === selectedCouncil && <Text style={styles.councilTick}>✓</Text>}
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No councils match "{search}"</Text>
            }
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#1a1a1a' },
  container: {
    flexGrow: 1,
    padding: 32,
    paddingTop: 72,
  },
  cancelBtn: {
    alignSelf: 'flex-end',
    marginTop: 8,
    marginBottom: 16,
  },
  cancelBtnText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 36,
    lineHeight: 22,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  stateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  stateBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  stateBtnSelected: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  stateBtnText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
    fontSize: 14,
  },
  stateBtnTextSelected: {
    color: '#fff',
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: 36,
  },
  pickerTriggerDisabled: {
    opacity: 0.4,
  },
  pickerTriggerText: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
  },
  pickerPlaceholder: {
    color: '#9E9E9E',
  },
  pickerChevron: {
    fontSize: 22,
    color: 'rgba(255,255,255,0.4)',
    marginLeft: 8,
  },
  saveBtn: {
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: 'rgba(76,175,80,0.35)',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  disclaimerBox: {
    marginTop: 28,
    padding: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  disclaimerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  disclaimerText: {
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255,255,255,0.65)',
  },
  disclaimerLink: {
    marginTop: 12,
    fontSize: 14,
    color: '#4CAF50',
    fontWeight: '600',
  },
  // Modal
  modal: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
  modalClose: {
    fontSize: 16,
    color: '#4CAF50',
    fontWeight: '600',
  },
  searchInput: {
    margin: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  councilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  councilRowSelected: {
    backgroundColor: 'rgba(76,175,80,0.15)',
  },
  councilRowText: {
    flex: 1,
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
  },
  councilRowTextSelected: {
    color: '#4CAF50',
    fontWeight: '600',
  },
  councilTick: {
    fontSize: 16,
    color: '#4CAF50',
    marginLeft: 8,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginLeft: 16,
  },
  emptyText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.4)',
    marginTop: 40,
    fontSize: 15,
  },
});
