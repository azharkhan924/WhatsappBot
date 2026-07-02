import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { Shield, Server, Key, ArrowRight, Phone, Lock, User } from 'lucide-react-native';

export const GateScreen: React.FC = () => {
  const { connect, isLoading: contextLoading } = useApp();
  const [authTab, setAuthTab] = useState<'admin' | 'phone' | 'key'>('admin');
  const [url, setUrl] = useState('https://whatsapp-bot.up.railway.app');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('admin123');
  const [key, setKey] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiService.loadCredentials().then(creds => {
      if (creds && creds.apiBaseUrl) {
        setUrl(creds.apiBaseUrl);
      }
    });
  }, []);

  const getCleanUrl = () => {
    let cleanUrl = url.trim();
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    return cleanUrl;
  };

  const handleSendOtp = async () => {
    setError('');
    const cleanUrl = getCleanUrl();
    const cleanPhone = phone.trim();

    if (!cleanUrl || !cleanPhone) {
      setError('Both Server URL and Phone Number are required.');
      return;
    }

    setLoading(true);
    try {
      await apiService.requestOtp(cleanUrl, cleanPhone);
      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || 'Could not send verification code via WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    const cleanUrl = getCleanUrl();
    const cleanPhone = phone.trim();
    const cleanOtp = otp.trim();

    if (!cleanOtp) {
      setError('Please enter the 6-digit code received on WhatsApp.');
      return;
    }

    setLoading(true);
    try {
      const result = await apiService.verifyOtp(cleanUrl, cleanPhone, cleanOtp);
      if (result && result.dashboardKey) {
        await connect(cleanUrl, result.dashboardKey);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. Incorrect code.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectKey = async () => {
    setError('');
    const cleanUrl = getCleanUrl();
    const cleanKey = key.trim();

    if (!cleanUrl || !cleanKey) {
      setError('Both Server URL and Dashboard Key are required.');
      return;
    }

    try {
      await connect(cleanUrl, cleanKey);
    } catch (err: any) {
      setError(err.message || 'Could not connect to backend server.');
    }
  };

  const handleAdminLogin = async () => {
    setError('');
    const cleanUrl = getCleanUrl();
    const cleanUser = adminUser.trim();
    const cleanPass = adminPass.trim();

    if (!cleanUrl || !cleanUser || !cleanPass) {
      setError('Server URL, Username and Password are required.');
      return;
    }

    setLoading(true);
    try {
      const result = await apiService.adminLogin(cleanUrl, cleanUser, cleanPass);
      if (result && result.dashboardKey) {
        await connect(cleanUrl, result.dashboardKey);
      }
    } catch (err: any) {
      setError(err.message || 'Admin login failed. Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  const isBusy = contextLoading || loading;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.iconBadge}>
            <Shield size={36} color={colors.primary} />
          </View>
          <Text style={styles.title}>Control Room</Text>
          <Text style={styles.subtitle}>Link your mobile companion to your autonomous WhatsApp AI engine.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Backend Server URL</Text>
          <View style={styles.inputContainer}>
            <Server size={20} color={colors.textMuted} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="e.g. https://whatsapp-bot.up.railway.app"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              value={url}
              onChangeText={setUrl}
            />
          </View>

          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tab, authTab === 'admin' && styles.tabActive]}
              onPress={() => { setAuthTab('admin'); setError(''); }}
            >
              <Text style={[styles.tabText, authTab === 'admin' && styles.tabTextActive]}>👤 Admin</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, authTab === 'phone' && styles.tabActive]}
              onPress={() => { setAuthTab('phone'); setError(''); }}
            >
              <Text style={[styles.tabText, authTab === 'phone' && styles.tabTextActive]}>📱 Phone</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, authTab === 'key' && styles.tabActive]}
              onPress={() => { setAuthTab('key'); setError(''); }}
            >
              <Text style={[styles.tabText, authTab === 'key' && styles.tabTextActive]}>🔑 Key</Text>
            </TouchableOpacity>
          </View>

          {authTab === 'admin' ? (
            <>
              <Text style={styles.label}>Admin Username</Text>
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
              >
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Admin Login</Text>
                    <ArrowRight size={20} color="#ffffff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : authTab === 'phone' ? (
            <>
              <Text style={styles.label}>WhatsApp Phone Number</Text>
              <View style={styles.inputContainer}>
                <Phone size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +14155551234"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  value={phone}
                  onChangeText={setPhone}
                />
              </View>

              {otpSent ? (
                <>
                  <Text style={[styles.label, { marginTop: 16 }]}>6-Digit Verification Code</Text>
                  <View style={styles.inputContainer}>
                    <Lock size={20} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.input}
                      placeholder="Enter code sent via WhatsApp"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="number-pad"
                      maxLength={6}
                      value={otp}
                      onChangeText={setOtp}
                    />
                  </View>
                </>
              ) : null}

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {!otpSent ? (
                <TouchableOpacity
                  style={[styles.button, isBusy && styles.buttonDisabled]}
                  onPress={handleSendOtp}
                  disabled={isBusy}
                  activeOpacity={0.8}
                >
                  {isBusy ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Text style={styles.buttonText}>Send Verification Code</Text>
                      <ArrowRight size={20} color="#ffffff" />
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.button, isBusy && styles.buttonDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={isBusy}
                  activeOpacity={0.8}
                >
                  {isBusy ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Text style={styles.buttonText}>Verify & Connect</Text>
                      <ArrowRight size={20} color="#ffffff" />
                    </>
                  )}
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <Text style={styles.label}>Dashboard Access Key</Text>
              <View style={styles.inputContainer}>
                <Key size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your DASHBOARD_ACCESS_KEY"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  value={key}
                  onChangeText={setKey}
                />
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.button, isBusy && styles.buttonDisabled]}
                onPress={handleConnectKey}
                disabled={isBusy}
                activeOpacity={0.8}
              >
                {isBusy ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.buttonText}>Connect Session</Text>
                    <ArrowRight size={20} color="#ffffff" />
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Secure authentication via WhatsApp OTP or Key.</Text>
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
    marginBottom: 32,
  },
  iconBadge: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: '85%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.cardBorder,
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
