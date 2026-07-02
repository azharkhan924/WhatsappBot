import React, { useState } from 'react';
import { View, Text, Switch, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { Zap, ShieldCheck, Plus, X, MessageSquare, Save } from 'lucide-react-native';

export const ControlsScreen: React.FC = () => {
  const { config, updateConfig } = useApp();
  const [newNumber, setNewNumber] = useState('');
  const [holdingReply, setHoldingReply] = useState(config?.holdingReply || '');
  const [savingHolding, setSavingHolding] = useState(false);

  // Sync holdingReply when config loads/changes
  React.useEffect(() => {
    if (config?.holdingReply !== undefined) {
      setHoldingReply(config.holdingReply);
    }
  }, [config?.holdingReply]);

  const handleToggleBot = async (val: boolean) => {
    try {
      await updateConfig({ botEnabled: val });
    } catch (err) {
      Alert.alert('Error', 'Failed to update bot master switch.');
    }
  };

  const handleToggleWhitelist = async (val: boolean) => {
    try {
      await updateConfig({ whitelistEnabled: val });
    } catch (err) {
      Alert.alert('Error', 'Failed to update whitelist mode.');
    }
  };

  const handleAddNumber = async () => {
    const raw = newNumber.trim().replace(/[^0-9]/g, '');
    if (!raw || raw.length < 10) {
      Alert.alert('Invalid Number', 'Please enter a valid phone number with country code (e.g. 14155552671).');
      return;
    }
    const currentList = config?.whitelist || [];
    if (currentList.includes(raw)) {
      Alert.alert('Duplicate', 'This phone number is already on the whitelist.');
      setNewNumber('');
      return;
    }
    const newList = [...currentList, raw];
    try {
      await updateConfig({ whitelist: newList });
      setNewNumber('');
    } catch (err) {
      Alert.alert('Error', 'Could not add number to whitelist.');
    }
  };

  const handleRemoveNumber = async (num: string) => {
    const currentList = config?.whitelist || [];
    const newList = currentList.filter((n) => n !== num);
    try {
      await updateConfig({ whitelist: newList });
    } catch (err) {
      Alert.alert('Error', 'Could not remove number from whitelist.');
    }
  };

  const handleSaveHoldingReply = async () => {
    if (!holdingReply.trim()) {
      Alert.alert('Error', 'Holding reply message cannot be empty.');
      return;
    }
    setSavingHolding(true);
    try {
      await updateConfig({ holdingReply: holdingReply.trim() });
      Alert.alert('Saved', 'Holding reply updated successfully.');
    } catch (err) {
      Alert.alert('Error', 'Could not update holding reply.');
    } finally {
      setSavingHolding(false);
    }
  };

  if (!config) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Master Switch Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Zap size={22} color={config.botEnabled ? colors.primary : colors.textMuted} />
          <View style={styles.cardTitles}>
            <Text style={styles.cardTitle}>Bot Master Switch</Text>
            <Text style={styles.cardSub}>Instantly enable or silence automated AI responses.</Text>
          </View>
          <Switch
            value={!!config.botEnabled}
            onValueChange={handleToggleBot}
            trackColor={{ false: colors.inputBg, true: colors.primaryGlow }}
            thumbColor={config.botEnabled ? colors.primary : colors.textMuted}
          />
        </View>
      </View>

      {/* Whitelist Protection Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <ShieldCheck size={22} color={config.whitelistEnabled ? colors.accent : colors.textMuted} />
          <View style={styles.cardTitles}>
            <Text style={styles.cardTitle}>Whitelist Protection</Text>
            <Text style={styles.cardSub}>Only reply to specific phone numbers listed below.</Text>
          </View>
          <Switch
            value={!!config.whitelistEnabled}
            onValueChange={handleToggleWhitelist}
            trackColor={{ false: colors.inputBg, true: 'rgba(6, 182, 212, 0.25)' }}
            thumbColor={config.whitelistEnabled ? colors.accent : colors.textMuted}
          />
        </View>

        {config.whitelistEnabled ? (
          <View style={styles.whitelistSection}>
            <View style={styles.addNumberRow}>
              <TextInput
                style={styles.numberInput}
                placeholder="Country code + number (e.g. 14155551234)"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                value={newNumber}
                onChangeText={setNewNumber}
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleAddNumber}>
                <Plus size={20} color="#ffffff" />
              </TouchableOpacity>
            </View>

            <View style={styles.chipsContainer}>
              {(config.whitelist || []).length === 0 ? (
                <Text style={styles.emptyText}>No whitelisted numbers yet. Bot will stay silent.</Text>
              ) : (
                (config.whitelist || []).map((num) => (
                  <View key={num} style={styles.chip}>
                    <Text style={styles.chipText}>+{num}</Text>
                    <TouchableOpacity onPress={() => handleRemoveNumber(num)} hitSlop={10}>
                      <X size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          </View>
        ) : null}
      </View>

      {/* Holding Reply Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderNoSwitch}>
          <MessageSquare size={22} color={colors.warning} />
          <View style={styles.cardTitles}>
            <Text style={styles.cardTitle}>Sensitive Holding Reply</Text>
            <Text style={styles.cardSub}>Triggered when a query involves financial advice or meetings.</Text>
          </View>
        </View>

        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={3}
          placeholder="Enter holding reply..."
          placeholderTextColor={colors.textMuted}
          value={holdingReply}
          onChangeText={setHoldingReply}
        />

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSaveHoldingReply}
          disabled={savingHolding}
        >
          {savingHolding ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Save size={18} color="#ffffff" />
              <Text style={styles.saveBtnText}>Save Holding Reply</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardHeaderNoSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitles: {
    flex: 1,
    marginHorizontal: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  whitelistSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  addNumberRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  numberInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  addBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.accent,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.chipBg,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 8,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  textArea: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveBtn: {
    backgroundColor: colors.cardElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  saveBtnText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
});
