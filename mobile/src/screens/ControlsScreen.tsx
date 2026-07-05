import React, { useState } from 'react';
import { View, Text, Switch, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { Zap, ShieldCheck, Plus, X, MessageSquare, Save, Clock } from 'lucide-react-native';
import { CountryCodePicker } from '../components/CountryCodePicker';

export const ControlsScreen: React.FC = () => {
  const { config, updateConfig } = useApp();
  const [newNumber, setNewNumber] = useState('');
  const [countryCode, setCountryCode] = useState('91');
  const [newBlacklistNumber, setNewBlacklistNumber] = useState('');
  const [blacklistCountryCode, setBlacklistCountryCode] = useState('91');
  const [holdingReply, setHoldingReply] = useState(config?.holdingReply || '');
  const [autoPauseHours, setAutoPauseHours] = useState(String(config?.autoPauseHours || 12));
  const [savingHolding, setSavingHolding] = useState(false);

  // Sync when config loads/changes
  React.useEffect(() => {
    if (config?.holdingReply !== undefined) {
      setHoldingReply(config.holdingReply);
    }
    if (config?.autoPauseHours !== undefined) {
      setAutoPauseHours(String(config.autoPauseHours));
    }
  }, [config?.holdingReply, config?.autoPauseHours]);

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
    const rawNum = newNumber.trim().replace(/[^0-9]/g, '');
    if (!rawNum || rawNum.length < 10) {
      Alert.alert('Invalid Number', 'Please enter a valid phone number (e.g. 9876543210).');
      return;
    }
    const raw = countryCode + rawNum;
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

  const handleToggleBlacklist = async (val: boolean) => {
    try {
      await updateConfig({ blacklistEnabled: val });
    } catch (err) {
      Alert.alert('Error', 'Failed to update blacklist mode.');
    }
  };

  const handleAddBlacklistNumber = async () => {
    const rawNum = newBlacklistNumber.trim().replace(/[^0-9]/g, '');
    if (!rawNum || rawNum.length < 10) {
      Alert.alert('Invalid Number', 'Please enter a valid phone number (e.g. 9876543210).');
      return;
    }
    const raw = blacklistCountryCode + rawNum;
    const currentList = config?.blacklist || [];
    if (currentList.includes(raw)) {
      Alert.alert('Duplicate', 'This phone number is already on the blacklist.');
      setNewBlacklistNumber('');
      return;
    }
    const newList = [...currentList, raw];
    try {
      await updateConfig({ blacklist: newList });
      setNewBlacklistNumber('');
    } catch (err) {
      Alert.alert('Error', 'Could not add number to blacklist.');
    }
  };

  const handleRemoveBlacklistNumber = async (num: string) => {
    const currentList = config?.blacklist || [];
    const newList = currentList.filter((n) => n !== num);
    try {
      await updateConfig({ blacklist: newList });
    } catch (err) {
      Alert.alert('Error', 'Could not remove number from blacklist.');
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

  const handleSaveAutoPause = async () => {
    const hours = parseInt(autoPauseHours, 10);
    if (isNaN(hours) || hours < 1) {
      Alert.alert('Error', 'Please enter a valid number of hours.');
      return;
    }
    try {
      await updateConfig({ autoPauseHours: hours });
      Alert.alert('Saved', `Auto-pause set to ${hours} hours.`);
    } catch (err) {
      Alert.alert('Error', 'Could not update auto-pause hours.');
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
      {/* Bot Controls Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bot Controls</Text>

        {/* Bot Enabled Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Bot Enabled</Text>
            <Text style={styles.toggleSub}>When off, the bot will not reply to any messages</Text>
          </View>
          <Switch
            value={!!config.botEnabled}
            onValueChange={handleToggleBot}
            trackColor={{ false: colors.inputBg, true: colors.primaryGlow }}
            thumbColor={config.botEnabled ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Whitelist Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Whitelist Mode</Text>
            <Text style={styles.toggleSub}>Only reply to numbers in the whitelist below</Text>
          </View>
          <Switch
            value={!!config.whitelistEnabled}
            onValueChange={handleToggleWhitelist}
            trackColor={{ false: colors.inputBg, true: colors.primaryGlow }}
            thumbColor={config.whitelistEnabled ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Blacklist Toggle */}
        <View style={[styles.toggleRow, { borderBottomWidth: 0 }]}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Blacklist Mode</Text>
            <Text style={styles.toggleSub}>Do not reply to blacklisted numbers</Text>
          </View>
          <Switch
            value={!!config.blacklistEnabled}
            onValueChange={handleToggleBlacklist}
            trackColor={{ false: colors.inputBg, true: colors.primaryGlow }}
            thumbColor={config.blacklistEnabled ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Auto-Pause Hours */}
        <View style={styles.autoPauseSection}>
          <Text style={styles.autoPauseLabel}>Auto-Pause AI (Hours)</Text>
          <View style={styles.autoPauseRow}>
            <TextInput
              style={styles.autoPauseInput}
              value={autoPauseHours}
              onChangeText={setAutoPauseHours}
              keyboardType="number-pad"
              placeholder="12"
              placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity style={styles.autoPauseSaveBtn} onPress={handleSaveAutoPause}>
              <Text style={styles.autoPauseSaveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Whitelisted Numbers Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Whitelisted Numbers</Text>
        <View style={styles.addRow}>
          <View style={styles.phoneInputContainer}>
            <CountryCodePicker value={countryCode} onChange={setCountryCode} />
            <TextInput
              style={styles.phoneInput}
              placeholder="9876543210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              value={newNumber}
              onChangeText={setNewNumber}
            />
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={handleAddNumber}>
            <Plus size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.chipList}>
          {(config.whitelist || []).length === 0 ? (
            <Text style={styles.emptyText}>No numbers added yet</Text>
          ) : (
            (config.whitelist || []).map((num) => (
              <View key={num} style={styles.chip}>
                <Text style={styles.chipText}>+{num}</Text>
                <TouchableOpacity onPress={() => handleRemoveNumber(num)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Blacklisted Numbers Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Blacklisted Numbers</Text>
        <View style={styles.addRow}>
          <View style={styles.phoneInputContainer}>
            <CountryCodePicker value={blacklistCountryCode} onChange={setBlacklistCountryCode} />
            <TextInput
              style={styles.phoneInput}
              placeholder="9876543210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              value={newBlacklistNumber}
              onChangeText={setNewBlacklistNumber}
            />
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={handleAddBlacklistNumber}>
            <Plus size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>

        <View style={styles.chipList}>
          {(config.blacklist || []).length === 0 ? (
            <Text style={styles.emptyText}>No numbers added yet</Text>
          ) : (
            (config.blacklist || []).map((num) => (
              <View key={num} style={styles.chip}>
                <Text style={styles.chipText}>+{num}</Text>
                <TouchableOpacity onPress={() => handleRemoveBlacklistNumber(num)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </View>

      {/* Holding Reply Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Holding Reply</Text>
        <Text style={styles.cardSub}>
          Auto-reply when someone asks about meetings, money, or anything requiring personal confirmation.
        </Text>
        <TextInput
          style={styles.holdingInput}
          placeholder="e.g. I'll get back to you on this personally"
          placeholderTextColor={colors.textMuted}
          value={holdingReply}
          onChangeText={setHoldingReply}
        />
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSaveHoldingReply}
          disabled={savingHolding}
          activeOpacity={0.8}
        >
          {savingHolding ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          ⚡ Designed & Developed by <Text style={{ color: colors.primary, fontWeight: '700' }}>Azhar Khan</Text>
        </Text>
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
    padding: 16,
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
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 12,
  },
  cardSub: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  toggleSub: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  autoPauseSection: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  autoPauseLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  autoPauseRow: {
    flexDirection: 'row',
    gap: 8,
  },
  autoPauseInput: {
    flex: 1,
    height: 48,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 16,
  },
  autoPauseSaveBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
  },
  autoPauseSaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  phoneInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    height: 48,
    overflow: 'hidden',
  },
  phoneInput: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 16,
  },
  addBtn: {
    width: 48,
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.chipBg,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginRight: 6,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  holdingInput: {
    height: 48,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 24,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    marginTop: 8,
    alignItems: 'center',
    paddingBottom: 16,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
