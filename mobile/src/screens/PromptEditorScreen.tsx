import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { Sparkles, Save, CheckCircle } from 'lucide-react-native';

export const PromptEditorScreen: React.FC = () => {
  const { config, updateConfig } = useApp();
  const [prompt, setPrompt] = useState(config?.systemPrompt || '');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (config?.systemPrompt !== undefined && !isDirty) {
      setPrompt(config.systemPrompt);
    }
  }, [config?.systemPrompt]);

  const handleChangeText = (txt: string) => {
    setPrompt(txt);
    setIsDirty(true);
    setJustSaved(false);
  };

  const handleSave = async () => {
    if (!prompt.trim()) {
      Alert.alert('Error', 'System prompt cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await updateConfig({ systemPrompt: prompt });
      setIsDirty(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      Alert.alert('Error', 'Failed to update system prompt on backend.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.header}>
        <Sparkles size={24} color={colors.primary} />
        <View style={styles.headerTitles}>
          <Text style={styles.title}>AI Persona & Instructions</Text>
          <Text style={styles.subtitle}>Define the system prompt governing bot tone, rules, and memory.</Text>
        </View>
      </View>

      <View style={styles.editorCard}>
        <TextInput
          style={styles.textArea}
          multiline
          placeholder="You are Azhar's WhatsApp AI assistant..."
          placeholderTextColor={colors.textMuted}
          value={prompt}
          onChangeText={handleChangeText}
          textAlignVertical="top"
        />

        <View style={styles.editorFooter}>
          <Text style={styles.charCount}>{prompt.length} characters</Text>
          {isDirty && <Text style={styles.dirtyBadge}>Unsaved changes</Text>}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.saveButton, (!isDirty && !justSaved) && styles.saveButtonDisabled]}
        onPress={handleSave}
        disabled={saving || (!isDirty && !justSaved)}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color="#ffffff" />
        ) : justSaved ? (
          <>
            <CheckCircle size={20} color="#ffffff" />
            <Text style={styles.saveText}>Prompt Live on Engine</Text>
          </>
        ) : (
          <>
            <Save size={20} color="#ffffff" />
            <Text style={styles.saveText}>Deploy Prompt Changes</Text>
          </>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerTitles: {
    marginLeft: 14,
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  editorCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    marginBottom: 20,
  },
  textArea: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  editorFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  charCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  dirtyBadge: {
    fontSize: 12,
    color: colors.warning,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
});
