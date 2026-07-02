import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiService, WhatsAppState, BotConfig } from '../services/api';

interface AppContextType {
  isConnected: boolean;
  isLoading: boolean;
  apiBaseUrl: string;
  whatsappState: WhatsAppState;
  config: BotConfig | null;
  connect: (url: string, key: string) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  updateConfig: (partial: Partial<BotConfig>) => Promise<void>;
  reconnectWhatsApp: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [whatsappState, setWhatsappState] = useState<WhatsAppState>({ status: 'initializing' });
  const [config, setConfig] = useState<BotConfig | null>(null);

  useEffect(() => {
    init();
    return () => {
      apiService.disconnectSocket();
    };
  }, []);

  const init = async () => {
    setIsLoading(true);
    try {
      const { apiBaseUrl: savedUrl, dashboardKey } = await apiService.loadCredentials();
      if (savedUrl && dashboardKey) {
        setApiBaseUrl(savedUrl);
        // Verify session
        await apiService.getStatus();
        setIsConnected(true);
        startSync();
      }
    } catch (e) {
      console.warn('Saved session expired or unreachable:', e);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const startSync = () => {
    apiService.connectSocket((state) => {
      setWhatsappState(state);
    });
    refreshConfig();
  };

  const connect = async (url: string, key: string) => {
    setIsLoading(true);
    try {
      const state = await apiService.testConnection(url, key);
      await apiService.saveCredentials(url, key);
      setApiBaseUrl(apiService.getCredentials().apiBaseUrl);
      setWhatsappState(state);
      setIsConnected(true);
      startSync();
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = async () => {
    apiService.clearCredentials();
    setIsConnected(false);
    setWhatsappState({ status: 'initializing' });
    setConfig(null);
  };

  const refreshConfig = async () => {
    try {
      const cfg = await apiService.getConfig();
      setConfig(cfg);
    } catch (e) {
      console.warn('Failed to load config:', e);
    }
  };

  const updateConfig = async (partial: Partial<BotConfig>) => {
    try {
      // Optimistic update
      if (config) setConfig({ ...config, ...partial });
      const updated = await apiService.updateConfig(partial);
      setConfig(updated);
    } catch (e) {
      console.error('Update config failed:', e);
      await refreshConfig();
      throw e;
    }
  };

  const reconnectWhatsApp = async () => {
    setWhatsappState({ status: 'initializing' });
    await apiService.reconnectWhatsApp();
  };

  return (
    <AppContext.Provider
      value={{
        isConnected,
        isLoading,
        apiBaseUrl,
        whatsappState,
        config,
        connect,
        disconnect,
        refreshConfig,
        updateConfig,
        reconnectWhatsApp,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
};
