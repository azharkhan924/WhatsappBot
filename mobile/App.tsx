import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/context/AppContext';
import { colors } from './src/theme/colors';

import { GateScreen } from './src/screens/GateScreen';
import { LiveStatusScreen } from './src/screens/LiveStatusScreen';
import { PromptEditorScreen } from './src/screens/PromptEditorScreen';
import { SchedulerScreen } from './src/screens/SchedulerScreen';
import { ControlsScreen } from './src/screens/ControlsScreen';

import { Radio, Sparkles, Calendar, Settings } from 'lucide-react-native';

type TabType = 'connection' | 'prompt' | 'scheduler' | 'settings';

const MainNavigator: React.FC = () => {
  const { isConnected, isLoading } = useApp();
  const [activeTab, setActiveTab] = useState<TabType>('connection');

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
        {activeTab === 'connection' && <LiveStatusScreen />}
        {activeTab === 'prompt' && <PromptEditorScreen />}
        {activeTab === 'scheduler' && <SchedulerScreen />}
        {activeTab === 'settings' && <ControlsScreen />}
      </View>

      {/* Bottom Navigation — matches web dashboard sidebar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[styles.navItem, activeTab === 'connection' && styles.navItemActive]}
          onPress={() => setActiveTab('connection')}
          activeOpacity={0.7}
        >
          <Radio size={20} color={activeTab === 'connection' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'connection' && styles.navTextActive]}>Connection</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'prompt' && styles.navItemActive]}
          onPress={() => setActiveTab('prompt')}
          activeOpacity={0.7}
        >
          <Sparkles size={20} color={activeTab === 'prompt' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'prompt' && styles.navTextActive]}>AI Prompt</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'scheduler' && styles.navItemActive]}
          onPress={() => setActiveTab('scheduler')}
          activeOpacity={0.7}
        >
          <Calendar size={20} color={activeTab === 'scheduler' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'scheduler' && styles.navTextActive]}>Scheduler</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navItem, activeTab === 'settings' && styles.navItemActive]}
          onPress={() => setActiveTab('settings')}
          activeOpacity={0.7}
        >
          <Settings size={20} color={activeTab === 'settings' ? colors.primary : colors.textMuted} />
          <Text style={[styles.navText, activeTab === 'settings' && styles.navTextActive]}>Settings</Text>
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
    paddingVertical: 8,
    paddingHorizontal: 4,
    justifyContent: 'space-around',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  navItemActive: {
    backgroundColor: colors.inputBg,
  },
  navText: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 3,
    fontWeight: '600',
  },
  navTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
