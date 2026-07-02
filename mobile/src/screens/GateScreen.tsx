import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { ArrowRight, Lock, User, Globe } from 'lucide-react-native';

export const GateScreen: React.FC = () => {
  const { connect, isLoading: contextLoading, apiBaseUrl } = useApp();
  const [url, setUrl] = useState('');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');

  useEffect(() => {
    if (apiBaseUrl) {
      setUrl(apiBaseUrl);
    } else {
      apiService.loadCredentials().then((creds) => {
        if (creds && creds.apiBaseUrl) {
          setUrl(creds.apiBaseUrl);
        } else {
          setUrl('http://localhost:3000');
        }
      }).catch(() => {
        setUrl('http://localhost:3000');
      });
    }
  }, [apiBaseUrl]);

  const handleAdminLogin = async () => {
    setError('');
    let cleanUrl = url.trim();
    const cleanUser = adminUser.trim();
    const cleanPass = adminPass.trim();

    if (!cleanUrl || !cleanUser || !cleanPass) {
      setError('Server URL, Username, and Password are required.');
      return;
    }

    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'http://' + cleanUrl;
    }

    setLoading('Connecting to server...');
    try {
      const result = await apiService.adminLogin(cleanUrl, cleanUser, cleanPass);
      if (result && result.dashboardKey) {
        await connect(cleanUrl, result.dashboardKey);
      }
    } catch (err: any) {
      setError(err.message || 'Admin login failed. Verify Server URL and credentials.');
    } finally {
      setLoading('');
    }
  };

  const isBusy = contextLoading || Boolean(loading);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImage}
            resizeMode="cover"
          />
          <View style={styles.badgeRow}>
            <Text style={styles.badgeText}>// SECURE GATEWAY</Text>
          </View>
          <Text style={styles.title}>WhatsApp AI Assistant</Text>
          <Text style={styles.subtitle}>Professional Autonomous AI Engine • Developed by Azhar Khan</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Server Endpoint URL</Text>
          <View style={styles.inputContainer}>
            <Globe size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="e.g. http://192.168.1.5:3000 or cloud URL"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="url"
              value={url}
              onChangeText={setUrl}
            />
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>Admin Username</Text>
          <View style={styles.inputContainer}>
            <User size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username (default: admin)"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              value={adminUser}
              onChangeText={setAdminUser}
            />
          </View>

          <Text style={[styles.label, { marginTop: 16 }]}>Admin Password</Text>
          <View style={styles.inputContainer}>
            <Lock size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Password (default: admin123)"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={adminPass}
              onChangeText={setAdminPass}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, isBusy && styles.buttonDisabled]}
            onPress={handleAdminLogin}
            disabled={isBusy}
            activeOpacity={0.8}
          >
            {isBusy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <>
                <Text style={styles.buttonText}>Unlock Assistant</Text>
                <ArrowRight size={20} color="#ffffff" style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            ⚡ Designed & Developed by <Text style={{ color: colors.primary, fontWeight: '700' }}>Azhar Khan</Text> — Professional WhatsApp AI Assistant
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoImage: {
    width: 84,
    height: 84,
    borderRadius: 22,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  badgeRow: {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  badgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
  },
  serverNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 18,
  },
  serverNoticeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    marginTop: 18,
    marginBottom: 18,
    gap: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 48,
    color: colors.text,
    fontSize: 15,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 12,
    marginTop: 24,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginRight: 8,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
