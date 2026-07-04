import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { colors } from '../theme/colors';

const COUNTRY_CODES = [
  { code: '91', label: '+91 (India)' },
  { code: '1', label: '+1 (US/Canada)' },
  { code: '44', label: '+44 (UK)' },
  { code: '971', label: '+971 (UAE)' },
  { code: '62', label: '+62 (Indonesia)' },
  { code: '60', label: '+60 (Malaysia)' },
  { code: '65', label: '+65 (Singapore)' },
  { code: '92', label: '+92 (Pakistan)' },
  { code: '880', label: '+880 (Bangladesh)' },
  { code: '966', label: '+966 (Saudi Arabia)' },
];

interface Props {
  value: string;
  onChange: (code: string) => void;
}

export const CountryCodePicker: React.FC<Props> = ({ value, onChange }) => {
  const [modalVisible, setModalVisible] = useState(false);

  const handleSelect = (code: string) => {
    onChange(code);
    setModalVisible(false);
  };

  return (
    <>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.pickerText}>+{value}</Text>
        <ChevronDown size={14} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Select Country Code</Text>
                <FlatList
                  data={COUNTRY_CODES}
                  keyExtractor={(item) => item.code}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.countryItem,
                        item.code === value && styles.countryItemSelected,
                      ]}
                      onPress={() => handleSelect(item.code)}
                    >
                      <Text
                        style={[
                          styles.countryItemText,
                          item.code === value && styles.countryItemTextSelected,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: colors.inputBorder,
    height: '100%',
  },
  pickerText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginRight: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '80%',
    maxHeight: '60%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  countryItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  countryItemSelected: {
    backgroundColor: 'rgba(0, 168, 132, 0.12)',
    borderRadius: 8,
    borderBottomWidth: 0,
    marginVertical: 2,
    paddingHorizontal: 12,
  },
  countryItemText: {
    color: colors.text,
    fontSize: 16,
  },
  countryItemTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
