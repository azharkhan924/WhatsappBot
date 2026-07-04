import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Switch, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { apiService, ChatInfo } from '../services/api';
import { Calendar, Clock, Users, Hash, Image, MessageSquare, Save, Send, X, ChevronDown, RefreshCw } from 'lucide-react-native';

const INTERVAL_OPTIONS = [
  { value: 'min_2', label: 'Every 2 minutes' },
  { value: 'min_4', label: 'Every 4 minutes' },
  { value: 'hour_1', label: 'Every 1 hour' },
  { value: 'hour_2', label: 'Every 2 hours' },
  { value: 'hour_4', label: 'Every 4 hours' },
  { value: 'hour_8', label: 'Every 8 hours' },
  { value: 'hour_12', label: 'Every 12 hours' },
];

export const SchedulerScreen: React.FC = () => {
  const { config, refreshConfig } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Scheduler state
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'daily' | 'interval'>('daily');
  const [time, setTime] = useState('09:00');
  const [intervalPreset, setIntervalPreset] = useState('hour_1');
  const [targetGroups, setTargetGroups] = useState<string[]>([]);
  const [targetChannels, setTargetChannels] = useState<string[]>([]);
  const [adCaption, setAdCaption] = useState('');
  const [quotes, setQuotes] = useState('');
  const [adCount, setAdCount] = useState(0);
  const [lastRun, setLastRun] = useState<any>(null);

  // Available chats for picker
  const [availableGroups, setAvailableGroups] = useState<ChatInfo[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [channelInput, setChannelInput] = useState('');

  useEffect(() => {
    loadScheduler();
  }, []);

  const loadScheduler = async () => {
    setLoading(true);
    try {
      const cfg = await apiService.getSchedulerConfig();
      setEnabled(!!(cfg as any).schedulerEnabled);
      setMode((cfg as any).schedulerMode || 'daily');
      setTime((cfg as any).schedulerTime || '09:00');
      setIntervalPreset((cfg as any).schedulerIntervalPreset || 'hour_1');
      setTargetGroups((cfg as any).schedulerGroups || []);
      setTargetChannels((cfg as any).schedulerChannels || []);
      setAdCaption((cfg as any).schedulerAdCaption || '');
      setQuotes(((cfg as any).schedulerQuotes || []).join('\n'));
      setAdCount((cfg as any).schedulerAdCount || 0);
      setLastRun((cfg as any).schedulerLastRun || null);
    } catch (e) {
      console.warn('Failed to load scheduler config:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableChats = async () => {
    setLoadingChats(true);
    try {
      const chats = await apiService.getAvailableChats();
      setAvailableGroups(chats.filter(c => c.isGroup));
    } catch (e) {
      Alert.alert('Error', 'Could not fetch available chats.');
    } finally {
      setLoadingChats(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const quotesArr = quotes.split('\n').filter(q => q.trim());
      await apiService.updateSchedulerConfig({
        schedulerEnabled: enabled,
        schedulerMode: mode,
        schedulerTime: time,
        schedulerIntervalPreset: intervalPreset,
        schedulerGroups: targetGroups,
        schedulerChannels: targetChannels,
        schedulerAdCaption: adCaption,
        schedulerQuotes: quotesArr,
      } as any);
      Alert.alert('Saved', 'Scheduler settings saved successfully.');
      await refreshConfig();
    } catch (e) {
      Alert.alert('Error', 'Failed to save scheduler settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    Alert.alert('Send Now', 'This will send the scheduled content to all targets immediately.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send Now',
        onPress: async () => {
          setSending(true);
          try {
            await apiService.sendSchedulerNow();
            Alert.alert('Success', 'Content sent successfully!');
            loadScheduler();
          } catch (e) {
            Alert.alert('Error', 'Failed to send content.');
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  };

  const addGroup = (groupId: string, groupName: string) => {
    if (!targetGroups.includes(groupId)) {
      setTargetGroups([...targetGroups, groupId]);
    }
  };

  const removeGroup = (groupId: string) => {
    setTargetGroups(targetGroups.filter(g => g !== groupId));
  };

  const addChannel = async () => {
    const input = channelInput.trim();
    if (!input) return;

    try {
      let channelId = input;
      if (input.includes('chat.whatsapp.com') || input.startsWith('http')) {
        channelId = await apiService.resolveChannelId(input);
      }
      if (!targetChannels.includes(channelId)) {
        setTargetChannels([...targetChannels, channelId]);
      }
      setChannelInput('');
    } catch (e) {
      Alert.alert('Error', 'Could not resolve channel ID.');
    }
  };

  const removeChannel = (id: string) => {
    setTargetChannels(targetChannels.filter(c => c !== id));
  };

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Daily Quote & Ad Scheduler</Text>

        {/* Enable Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Scheduler Enabled</Text>
            <Text style={styles.toggleSub}>Send daily quote + ad to groups & channels</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: colors.inputBg, true: colors.primaryGlow }}
            thumbColor={enabled ? colors.primary : colors.textMuted}
          />
        </View>

        {/* Schedule Mode */}
        <Text style={styles.sectionLabel}>⏰ Schedule Time</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'daily' && styles.modeBtnActive]}
            onPress={() => setMode('daily')}
          >
            <Text style={[styles.modeBtnText, mode === 'daily' && styles.modeBtnTextActive]}>
              Daily
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'interval' && styles.modeBtnActive]}
            onPress={() => setMode('interval')}
          >
            <Text style={[styles.modeBtnText, mode === 'interval' && styles.modeBtnTextActive]}>
              Interval
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'daily' ? (
          <View style={styles.inputRow}>
            <Clock size={16} color={colors.textSecondary} />
            <TextInput
              style={styles.timeInput}
              value={time}
              onChangeText={setTime}
              placeholder="09:00"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        ) : (
          <View style={styles.intervalList}>
            {INTERVAL_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.intervalItem, intervalPreset === opt.value && styles.intervalItemActive]}
                onPress={() => setIntervalPreset(opt.value)}
              >
                <Text style={[styles.intervalText, intervalPreset === opt.value && styles.intervalTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Target Groups */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>👥 Target Groups</Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadAvailableChats}>
            {loadingChats ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <RefreshCw size={16} color={colors.primary} />
            )}
          </TouchableOpacity>
        </View>

        {availableGroups.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupPicker}>
            {availableGroups.filter(g => !targetGroups.includes(g.id)).map(g => (
              <TouchableOpacity
                key={g.id}
                style={styles.groupPickerItem}
                onPress={() => addGroup(g.id, g.name)}
              >
                <Text style={styles.groupPickerText} numberOfLines={1}>+ {g.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.chipList}>
          {targetGroups.length === 0 ? (
            <Text style={styles.emptyText}>No groups added. Tap 🔄 to load.</Text>
          ) : (
            targetGroups.map(id => {
              const info = availableGroups.find(g => g.id === id);
              return (
                <View key={id} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>{info?.name || id}</Text>
                  <TouchableOpacity onPress={() => removeGroup(id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={14} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </View>

        {/* Target Channels */}
        <Text style={styles.sectionLabel}>📢 Target Channels</Text>
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Channel ID or invite link"
            placeholderTextColor={colors.textMuted}
            value={channelInput}
            onChangeText={setChannelInput}
          />
          <TouchableOpacity style={styles.addBtn} onPress={addChannel}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chipList}>
          {targetChannels.length === 0 ? (
            <Text style={styles.emptyText}>No channels added</Text>
          ) : (
            targetChannels.map(id => (
              <View key={id} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>{id}</Text>
                <TouchableOpacity onPress={() => removeChannel(id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={14} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Ad Caption */}
        <Text style={styles.sectionLabel}>💬 Ad Caption</Text>
        <TextInput
          style={styles.captionInput}
          placeholder="Optional caption for ad images"
          placeholderTextColor={colors.textMuted}
          value={adCaption}
          onChangeText={setAdCaption}
        />
        <Text style={styles.adCountText}>
          Available: <Text style={{ color: colors.primary, fontWeight: '600' }}>{adCount}</Text> images
        </Text>

        {/* Quotes */}
        <Text style={styles.sectionLabel}>📝 Quotes</Text>
        <TextInput
          style={styles.quotesArea}
          multiline
          placeholder="One quote per line: quote text | author"
          placeholderTextColor={colors.textMuted}
          value={quotes}
          onChangeText={setQuotes}
          textAlignVertical="top"
        />

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Save size={18} color="#fff" />
                <Text style={styles.saveBtnText}>Save Settings</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sendBtn}
            onPress={handleSendNow}
            disabled={sending}
            activeOpacity={0.8}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Send size={18} color="#fff" />
                <Text style={styles.sendBtnText}>Send Now</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Last Run */}
        {lastRun && lastRun.time ? (
          <View style={styles.lastRunBox}>
            <Text style={styles.lastRunTitle}>Last Run</Text>
            <Text style={styles.lastRunInfo}>
              {lastRun.time} • {lastRun.status || 'completed'} • {lastRun.groups || 0} groups, {lastRun.channels || 0} channels
            </Text>
          </View>
        ) : null}
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
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
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
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 16,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refreshBtn: {
    padding: 6,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  modeBtnActive: {
    backgroundColor: colors.primaryGlow,
    borderColor: colors.primary,
  },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modeBtnTextActive: {
    color: colors.primary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
  },
  timeInput: {
    flex: 1,
    marginLeft: 10,
    color: colors.text,
    fontSize: 16,
  },
  intervalList: {
    gap: 6,
  },
  intervalItem: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  intervalItemActive: {
    backgroundColor: colors.primaryGlow,
    borderColor: colors.primary,
  },
  intervalText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  intervalTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  groupPicker: {
    maxHeight: 42,
    marginBottom: 8,
  },
  groupPickerItem: {
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  groupPickerText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  chipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
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
    maxWidth: '90%',
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 6,
    flexShrink: 1,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addInput: {
    flex: 1,
    height: 48,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  captionInput: {
    height: 48,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  adCountText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  quotesArea: {
    minHeight: 120,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 10,
    padding: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 10,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  sendBtn: {
    flex: 1,
    backgroundColor: '#7C3AED',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 10,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  lastRunBox: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  lastRunTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  lastRunInfo: {
    fontSize: 12,
    color: colors.textMuted,
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
