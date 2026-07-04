import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, ScrollView, Alert, TextInput } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { Radio, RefreshCw, LogOut, CheckCircle2, QrCode } from 'lucide-react-native';
import { CountryCodePicker } from '../components/CountryCodePicker';

export const LiveStatusScreen: React.FC = () => {
  const { whatsappState, reconnectWhatsApp, disconnect, apiBaseUrl } = useApp();
  const [requesting, setRequesting] = useState(false);
  const [countryCode, setCountryCode] = useState('91');
  const [pairingPhone, setPairingPhone] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState('');

  const handleGetPairingCode = async () => {
    setPairingError('');
    const rawNum = pairingPhone.trim().replace(/[^0-9]/g, '');
    if (!rawNum || rawNum.length < 10) {
      setPairingError('Please enter a valid phone number (e.g. 9876543210).');
      return;
    }
    setPairingLoading(true);
    try {
      const fullPhone = countryCode + rawNum;
      const res = await apiService.requestPairingCode(fullPhone);
      if (res && res.pairingCode) {
        setPairingCode(res.pairingCode);
      }
    } catch (err: any) {
      setPairingError(err.message || 'Failed to get pairing code.');
    } finally {
      setPairingLoading(false);
    }
  };

  const handleReconnect = async () => {
    setRequesting(true);
    try {
      await reconnectWhatsApp();
    } catch (err) {
      Alert.alert('Error', 'Could not request a new session from backend.');
    } finally {
      setRequesting(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Are you sure you want to disconnect from this server?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: disconnect },
    ]);
  };

  const getStatusColor = () => {
    switch (whatsappState.status) {
      case 'connected': return colors.primary;
      case 'qr': return colors.warning;
      case 'disconnected': return colors.danger;
      default: return colors.textSecondary;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Card */}
      <View style={styles.headerCard}>
        <Text style={styles.headerTitle}>WHATSAPP CONNECTION</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor() }]} />
          <Text style={[styles.statusText, { color: getStatusColor() }]}>
            {whatsappState.status === 'connected' ? 'Connected' :
             whatsappState.status === 'qr' ? 'Scan to connect' :
             whatsappState.status === 'disconnected' ? 'Disconnected' : 'Initializing...'}
          </Text>
        </View>
        {apiBaseUrl ? (
          <Text style={styles.serverUrl} numberOfLines={1}>{apiBaseUrl}</Text>
        ) : null}
      </View>

      {/* Main Connection Card */}
      <View style={styles.card}>
        {whatsappState.status === 'connected' ? (
          <View style={styles.connectedBox}>
            <CheckCircle2 size={64} color={colors.primary} />
            <Text style={styles.connectedNumber}>
              {whatsappState.connectedNumber ? `+${whatsappState.connectedNumber}` : 'Linked Device'}
            </Text>
            <Text style={styles.connectedSub}>
              AI Engine is active and monitoring incoming chats.
            </Text>
          </View>
        ) : whatsappState.status === 'qr' && whatsappState.qrDataUrl ? (
          <View style={styles.qrBox}>
            <View style={styles.qrHeader}>
              <QrCode size={18} color={colors.warning} />
              <Text style={styles.qrTitle}>Scan with WhatsApp</Text>
            </View>
            <View style={styles.qrImageFrame}>
              <Image
                source={{ uri: whatsappState.qrDataUrl }}
                style={styles.qrImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.qrInstruction}>
              Open WhatsApp → Linked Devices → Link a Device
            </Text>

            {/* Link with Phone Number */}
            <View style={styles.pairingSection}>
              <Text style={styles.pairingLabel}>📱 Link with Phone Number</Text>
              <View style={styles.pairingRow}>
                <View style={styles.phoneInputContainer}>
                  <CountryCodePicker value={countryCode} onChange={setCountryCode} />
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="e.g. 9876543210"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    value={pairingPhone}
                    onChangeText={setPairingPhone}
                  />
                </View>
                <TouchableOpacity
                  style={styles.getCodeBtn}
                  onPress={handleGetPairingCode}
                  disabled={pairingLoading}
                >
                  {pairingLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.getCodeText}>Get Code</Text>
                  )}
                </TouchableOpacity>
              </View>

              {pairingCode ? (
                <View style={styles.pairingCodeBox}>
                  <Text style={styles.pairingCodeHint}>Enter on phone (Linked Devices → Link with phone number):</Text>
                  <Text style={styles.pairingCodeValue}>{pairingCode}</Text>
                </View>
              ) : null}
              {pairingError ? <Text style={styles.errorText}>{pairingError}</Text> : null}
            </View>
          </View>
        ) : (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>
              {whatsappState.status === 'disconnected'
                ? 'Session terminated. Generate a new QR code below.'
                : 'Initializing WhatsApp session...'}
            </Text>
          </View>
        )}
      </View>

      {/* Action Buttons */}
      <TouchableOpacity
        style={styles.reconnectBtn}
        onPress={handleReconnect}
        disabled={requesting}
        activeOpacity={0.8}
      >
        {requesting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <RefreshCw size={18} color="#fff" />
            <Text style={styles.reconnectText}>Generate New QR Code</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.hardResetBtn} onPress={handleDisconnect}>
        <LogOut size={18} color="#fff" />
        <Text style={styles.hardResetText}>Disconnect Server</Text>
      </TouchableOpacity>

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
  headerCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '600',
  },
  serverUrl: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  connectedBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  connectedNumber: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  connectedSub: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  qrBox: {
    alignItems: 'center',
  },
  qrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  qrTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.warning,
    marginLeft: 6,
  },
  qrImageFrame: {
    backgroundColor: colors.qrBg,
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  qrInstruction: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 18,
  },
  pairingSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    width: '100%',
  },
  pairingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: 10,
  },
  pairingRow: {
    flexDirection: 'row',
    gap: 8,
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
  getCodeBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
  },
  getCodeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  pairingCodeBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: 10,
    alignItems: 'center',
  },
  pairingCodeHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 4,
  },
  pairingCodeValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 4,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 6,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  reconnectBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 10,
    marginBottom: 10,
  },
  reconnectText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  hardResetBtn: {
    backgroundColor: colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 10,
  },
  hardResetText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
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
