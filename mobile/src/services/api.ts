import AsyncStorage from '@react-native-async-storage/async-storage';
import io, { Socket } from 'socket.io-client';

const STORAGE_API_BASE = '@bot_api_base';
const STORAGE_DASHBOARD_KEY = '@bot_dashboard_key';

export interface WhatsAppState {
  status: 'connected' | 'qr' | 'disconnected' | 'initializing';
  qrDataUrl?: string;
  connectedNumber?: string;
}

export interface BotConfig {
  systemPrompt?: string;
  botEnabled?: boolean;
  whitelistEnabled?: boolean;
  whitelist?: string[];
  holdingReply?: string;
}

class ApiService {
  private apiBaseUrl: string = '';
  private dashboardKey: string = '';
  private socket: Socket | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  async loadCredentials(): Promise<{ apiBaseUrl: string; dashboardKey: string }> {
    const base = await AsyncStorage.getItem(STORAGE_API_BASE);
    const key = await AsyncStorage.getItem(STORAGE_DASHBOARD_KEY);
    this.apiBaseUrl = base || '';
    this.dashboardKey = key || '';
    return { apiBaseUrl: this.apiBaseUrl, dashboardKey: this.dashboardKey };
  }

  async saveCredentials(apiBaseUrl: string, dashboardKey: string): Promise<void> {
    const cleanUrl = apiBaseUrl.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
    this.apiBaseUrl = cleanUrl;
    this.dashboardKey = dashboardKey;
    await AsyncStorage.setItem(STORAGE_API_BASE, cleanUrl);
    await AsyncStorage.setItem(STORAGE_DASHBOARD_KEY, dashboardKey);
  }

  async clearCredentials(): Promise<void> {
    this.apiBaseUrl = '';
    this.dashboardKey = '';
    await AsyncStorage.removeItem(STORAGE_API_BASE);
    await AsyncStorage.removeItem(STORAGE_DASHBOARD_KEY);
    this.disconnectSocket();
  }

  getCredentials() {
    return { apiBaseUrl: this.apiBaseUrl, dashboardKey: this.dashboardKey };
  }

  private async fetchApi(path: string, options: RequestInit = {}): Promise<any> {
    if (!this.apiBaseUrl) throw new Error('Not connected to a server');
    
    const headers = {
      'Content-Type': 'application/json',
      'x-dashboard-key': this.dashboardKey,
      ...(options.headers || {}),
    };

    const res = await fetch(`${this.apiBaseUrl}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      throw new Error('UNAUTHORIZED');
    }

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`);
    }

    return res.json();
  }

  async requestOtp(url: string, phone: string): Promise<{ success: boolean; message?: string }> {
    const cleanUrl = url.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
    let res = await fetch(`${cleanUrl}/api/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (res.status === 404) {
      res = await fetch(`${cleanUrl}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || data.message || 'Failed to send verification code.');
    }
    return data;
  }

  async verifyOtp(url: string, phone: string, otp: string): Promise<{ success: boolean; dashboardKey: string }> {
    const cleanUrl = url.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
    let res = await fetch(`${cleanUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp }),
    });
    if (res.status === 404) {
      res = await fetch(`${cleanUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success || !data.dashboardKey) {
      throw new Error(data.error || data.message || 'Invalid verification code.');
    }
    return data;
  }

  async adminLogin(url: string, username: string, password: string): Promise<{ success: boolean; dashboardKey: string }> {
    const cleanUrl = url.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
    let res = await fetch(`${cleanUrl}/api/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (res.status === 404) {
      res = await fetch(`${cleanUrl}/auth/admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success || !data.dashboardKey) {
      throw new Error(data.error || data.message || 'Invalid username or password.');
    }
    return data;
  }

  async requestPairingCode(phone: string): Promise<{ success: boolean; pairingCode: string }> {
    return this.fetchApi('/api/pairing-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }).catch(() =>
      this.fetchApi('/pairing-code', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      })
    );
  }

  async testConnection(url: string, key: string): Promise<WhatsAppState> {
    const cleanUrl = url.replace(/\/+$/, '').replace(/\/(dashboard|static)$/i, '');
    let res = await fetch(`${cleanUrl}/api/status`, {
      headers: { 'x-dashboard-key': key },
    });
    if (res.status === 404) {
      res = await fetch(`${cleanUrl}/status`, {
        headers: { 'x-dashboard-key': key },
      });
    }
    if (res.status === 401) {
      throw new Error('Wrong dashboard key.');
    }
    if (!res.ok) {
      throw new Error(`Server responded with ${res.status}. Check backend deployment.`);
    }
    return res.json();
  }

  async getStatus(): Promise<WhatsAppState> {
    try {
      return await this.fetchApi('/api/status');
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED') throw err;
      return await this.fetchApi('/status');
    }
  }

  async reconnectWhatsApp(): Promise<any> {
    try {
      return await this.fetchApi('/api/reconnect', { method: 'POST' });
    } catch (err: any) {
      return await this.fetchApi('/reconnect', { method: 'POST' });
    }
  }

  async getConfig(): Promise<BotConfig> {
    try {
      return await this.fetchApi('/api/config');
    } catch (err: any) {
      return await this.fetchApi('/config');
    }
  }

  async updateConfig(partialConfig: Partial<BotConfig>): Promise<BotConfig> {
    try {
      return await this.fetchApi('/api/config', {
        method: 'PUT',
        body: JSON.stringify(partialConfig),
      });
    } catch (err: any) {
      return await this.fetchApi('/config', {
        method: 'PUT',
        body: JSON.stringify(partialConfig),
      });
    }
  }

  async simulateChat(userId: string, message: string, apiKey: string): Promise<{
    reply: string;
    latencyMs: number;
    provider: string;
  }> {
    const res = await fetch(`${this.apiBaseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || this.dashboardKey,
      },
      body: JSON.stringify({ userId, message }),
    });
    if (!res.ok) {
      throw new Error(`Simulation failed: status ${res.status}`);
    }
    return res.json();
  }

  connectSocket(onState: (state: WhatsAppState) => void): void {
    this.disconnectSocket();
    if (!this.apiBaseUrl) return;

    try {
      this.socket = io(this.apiBaseUrl, {
        transports: ['websocket', 'polling'],
        auth: { dashboardKey: this.dashboardKey },
      });

      this.socket.on('state', (state: WhatsAppState) => {
        onState(state);
      });
    } catch (e) {
      console.warn('Socket connect error:', e);
    }

    // Polling fallback
    this.pollInterval = setInterval(async () => {
      try {
        const state = await this.getStatus();
        onState(state);
      } catch (e) {
        // Ignored
      }
    }, 4000);
  }

  disconnectSocket(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const apiService = new ApiService();
