import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/context/AppContext';
import { colors } from './src/theme/colors';

import { GateScreen } from './src/screens/GateScreen';
import { LiveStatusScreen } from './src/screens/LiveStatusScreen';
import { ControlsScreen } from './src/screens/ControlsScreen';
import { PromptEditorScreen } from './src/screens/PromptEditorScreen';
import { LabScreen } from './src/screens/LabScreen';

import { Activity, Sliders, Sparkles, FlaskConical } from 'lucide-react-native';

type TabType = 'status' | 'controls' | 'prompt' | 'lab';

const MainNavigator: React.FC = () => {
  const { isConnected, isLoading } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('status');

  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Connecting to WhatsApp AI Assistant...</Text>
      </View>
    );
  }

  if (!isConnected) {
    return <GateScreen />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      
      {/* Screen Content */}
      <View style={styles.content}>
        {activeTab === 'status' && <LiveStatusScreen />}
        {activeTab === 'controls' && <ControlsScreen />}
        {activeTab === 'prompt' && <PromptEditorScreen />}
        {activeTab === 'lab' && <LabScreen />}
      </View>

      {/* Sleek Bottom Navigation */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.navItem, activeTab === 'status' && styles.navItemActive]}
          onPress={() => setActiveTab('status')}
          activeOpacity={0.7}
        >
          <Activity size={22} color={activeTab === 'status' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'status' && styles.navTextActive]}>Gateway</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'controls' && styles.navItemActive]}
          onPress={() => setActiveTab('controls')}
          activeOpacity={0.7}
        >
          <Sliders size={22} color={activeTab === 'controls' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'controls' && styles.navTextActive]}>Controls</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'prompt' && styles.navItemActive]}
          onPress={() => setActiveTab('prompt')}
          activeOpacity={0.7}
        >
          <Sparkles size={22} color={activeTab === 'prompt' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'prompt' && styles.navTextActive]}>Persona</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'lab' && styles.navItemActive]}
          onPress={() => setActiveTab('lab')}
          activeOpacity={0.7}
        >
          <FlaskConical size={22} color={activeTab === 'lab' ? colors.accent : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'lab' && { color: colors.accent, fontWeight: '700' }]}>Lab</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <MainNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 14,
    fontWeight: '500',
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingVertical: 10,
    paddingHorizontal: 8,
    justifyContent: 'space-around',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  navItemActive: {
    backgroundColor: colors.inputBg,
  },
  navText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
    fontWeight: '600',
  },
  navTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
