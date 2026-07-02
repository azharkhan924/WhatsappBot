import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { colors } from '../theme/colors';
import { apiService } from '../services/api';
import { Send, FlaskConical, Trash2 } from 'lucide-react-native';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  latency?: number;
  provider?: string;
}

export const LabScreen: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'bot',
      text: 'AI Simulator Lab initialized. Send any message to test your Gemini / Groq / NVIDIA chain without WhatsApp.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const creds = apiService.getCredentials();
      const res = await apiService.simulateChat('mobile-lab-user', text, creds.dashboardKey);
      
      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: res.reply || 'No reply received.',
        latency: res.latencyMs,
        provider: res.provider,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Error: ${err.message || 'Simulation request failed'}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([
      {
        id: Date.now().toString(),
        sender: 'bot',
        text: 'Lab history cleared.',
      },
    ]);
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isUser = item.sender === 'user';
    return (
      <View style={[styles.bubbleWrap, isUser ? styles.userWrap : styles.botWrap]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
          <Text style={styles.bubbleText}>{item.text}</Text>
          {!isUser && item.provider && (
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>⚡ {item.provider}</Text>
              {item.latency && <Text style={styles.metaText}>{item.latency}ms</Text>}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <FlaskConical size={22} color={colors.accent} />
          <Text style={styles.title}>AI Simulator Lab</Text>
        </View>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClear}>
          <Trash2 size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Test query (e.g. Can we schedule a call?)"
          placeholderTextColor={colors.textMuted}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendBtn, !input.trim() && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Send size={18} color="#ffffff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginLeft: 10,
  },
  clearBtn: {
    padding: 6,
  },
  listContent: {
    padding: 20,
  },
  bubbleWrap: {
    marginBottom: 14,
    flexDirection: 'row',
  },
  userWrap: {
    justifyContent: 'flex-end',
  },
  botWrap: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    padding: 14,
    borderRadius: 18,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  botBubble: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderBottomLeftRadius: 4,
  },
  bubbleText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  metaText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: colors.inputBg,
    borderRadius: 22,
    paddingHorizontal: 18,
    color: colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  sendBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.accent,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
