import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, ScrollView, Alert, TextInput } from 'react-native';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import { apiService } from '../services/api';
import { Radio, RefreshCw, LogOut, CheckCircle2, AlertTriangle, QrCode, Phone } from 'lucide-react-native';
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
      default: return colors.accent;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header Banner */}
      <View style={styles.banner}>
        <View style={styles.bannerHeader}>
          <View style={[styles.pulseDot, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.bannerTitle}>System Status</Text>
        </View>
        <Text style={styles.serverUrl} numberOfLines={1}>{apiBaseUrl}</Text>
      </View>

      {/* Main Status Display */}
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Radio size={24} color={getStatusColor()} />
          <View style={styles.statusTextCol}>
            <Text style={styles.statusLabel}>WhatsApp Web Gateway</Text>
            <Text style={[styles.statusValue, { color: getStatusColor() }]}>
              {whatsappState.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Dynamic QR / Connected Stage */}
        <View style={styles.stageContainer}>
          {whatsappState.status === 'connected' ? (
            <View style={styles.connectedBox}>
              <CheckCircle2 size={56} color={colors.primary} />
              <Text style={styles.connectedNumber}>
                {whatsappState.connectedNumber ? `+${whatsappState.connectedNumber}` : 'Linked Device'}
              </Text>
              <Text style={styles.connectedSub}>Automated AI Engine is active and monitoring chats.</Text>
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
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device.
              </Text>

              <View style={styles.pairingDivider}>
                <Text style={styles.pairingDividerText}>📱 OR LINK WITH PHONE NUMBER</Text>
                <View style={styles.pairingRow}>
                  <View style={styles.inputWrapper}>
                    <CountryCodePicker value={countryCode} onChange={setCountryCode} />
                    <TextInput
                      style={styles.pairingInputWithPicker}
                      placeholder="e.g. 9876543210"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      value={pairingPhone}
                      onChangeText={setPairingPhone}
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.pairingButton}
                    onPress={handleGetPairingCode}
                    disabled={pairingLoading}
                  >
                    {pairingLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.pairingButtonText}>Get Code</Text>
                    )}
                  </TouchableOpacity>
                </View>

                {pairingCode ? (
                  <View style={styles.pairingCodeBox}>
                    <Text style={styles.pairingCodeLabel}>Enter on phone (Linked Devices → Link with phone number):</Text>
                    <Text style={styles.pairingCodeValue}>{pairingCode}</Text>
                  </View>
                ) : null}
                {pairingError ? <Text style={styles.pairingError}>{pairingError}</Text> : null}
              </View>
            </View>
          ) : (
            <View style={styles.placeholderBox}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={styles.placeholderText}>
                {whatsappState.status === 'disconnected'
                  ? 'Session terminated. Generate a new QR code below.'
                  : 'Initializing WhatsApp Chromium instance...'}
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <TouchableOpacity
          style={styles.reconnectBtn}
          onPress={handleReconnect}
          disabled={requesting}
        >
          {requesting ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <RefreshCw size={18} color="#ffffff" />
              <Text style={styles.reconnectText}>Generate New QR Code</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Disconnect Button */}
      <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
        <LogOut size={18} color={colors.danger} />
        <Text style={styles.disconnectText}>Disconnect Server</Text>
      </TouchableOpacity>

      <View style={{ marginTop: 28, alignItems: 'center', paddingBottom: 16 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>
          ⚡ Designed & Developed by <Text style={{ color: colors.primary, fontWeight: '700' }}>Azhar Khan</Text>
        </Text>
        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>Professional WhatsApp AI Assistant</Text>
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
  banner: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  bannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  serverUrl: {
    fontSize: 12,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  statusTextCol: {
    marginLeft: 14,
  },
  statusLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  stageContainer: {
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  connectedBox: {
    alignItems: 'center',
    padding: 20,
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
    maxWidth: '80%',
  },
  qrBox: {
    alignItems: 'center',
    width: '100%',
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
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
  },
  qrImage: {
    width: 220,
    height: 220,
  },
  qrInstruction: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 10,
    lineHeight: 18,
  },
  placeholderBox: {
    alignItems: 'center',
    padding: 24,
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
  reconnectBtn: {
    backgroundColor: colors.cardElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  reconnectText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    marginTop: 16,
  },
  disconnectText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  pairingDivider: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    width: '100%',
  },
  pairingDividerText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  pairingRow: {
    flexDirection: 'row',
    gap: 8,
  },
  inputWrapper: {
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
  pairingInputWithPicker: {
    flex: 1,
    height: '100%',
    paddingHorizontal: 12,
    color: colors.text,
  },
  pairingButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    height: 48,
  },
  pairingButtonText: {
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
  pairingCodeLabel: {
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
  pairingError: {
    color: colors.danger,
    fontSize: 12,
    marginTop: 6,
  },
});
