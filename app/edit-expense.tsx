import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  TouchableOpacity,
  Platform,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { getExpenseById, updateExpense, getAllFirearms, Firearm, EXPENSE_CATEGORIES } from '../lib/database';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';

function autoFormatDate(text: string, prev: string): string {
  const digits = text.replace(/\D/g, '');
  if (text.length < prev.length) return text;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4, 8);
}

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams();
  const [date, setDate] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [firearms, setFirearms] = useState<Firearm[]>([]);
  const [selectedFirearmId, setSelectedFirearmId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const loadExpense = async () => {
      try {
        const expense = await getExpenseById(Number(id));
        if (expense) {
          setDate(expense.date);
          setCategory(expense.category);
          setAmount(String(expense.amount));
          setDescription(expense.description || '');
          setSelectedFirearmId(expense.firearm_id || null);
          setNotes(expense.notes || '');
        }
      } catch (error) {
        Alert.alert('Error', 'Failed to load expense');
      }
    };

    const loadFirearms = async () => {
      try {
        const allFirearms = getAllFirearms();
        setFirearms(allFirearms);
      } catch (error) {
        Alert.alert('Error', 'Failed to load firearms');
      }
    };

    if (id) {
      loadExpense();
      loadFirearms();
    }
  }, [id]);

  const handleDateChange = (text: string) => {
    setDate(autoFormatDate(text, date));
  };

  const handleSave = async () => {
    if (!date.trim()) {
      Alert.alert('Error', 'Date is required');
      return;
    }
    if (!category) {
      Alert.alert('Error', 'Category is required');
      return;
    }
    if (!amount.trim()) {
      Alert.alert('Error', 'Amount is required');
      return;
    }

    try {
      await updateExpense(Number(id), {
        date: date.trim(),
        category: category,
        amount: parseFloat(amount),
        description: description.trim() || null,
        firearm_id: selectedFirearmId || null,
        notes: notes.trim() || null,
      });
      router.back();
    } catch (error) {
      Alert.alert('Error', 'Failed to update expense');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Expense</Text>
          <TouchableOpacity onPress={handleSave}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Expense Details Section */}
          <Text style={styles.sectionLabel}>EXPENSE DETAILS</Text>
          <View style={styles.card}>
            <Field
              label="Date"
              value={date}
              onChange={handleDateChange}
              keyboardType="number-pad"
              placeholder="MM/DD/YYYY"
            />
            <Field
              label="Amount"
              value={amount}
              onChange={setAmount}
              keyboardType="decimal-pad"
              prefix="$"
              last
            />
          </View>

          {/* Category Section */}
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <View style={styles.card}>
            <View style={styles.chipRow}>
              {EXPENSE_CATEGORIES.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.chip,
                    category === option && styles.chipActive,
                  ]}
                  onPress={() => setCategory(category === option ? null : option)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === option && styles.chipTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Description Section */}
          <Text style={styles.sectionLabel}>DESCRIPTION</Text>
          <View style={styles.card}>
            <Field
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Brief description"
              last
            />
          </View>

          {/* Firearm Link Section */}
          <Text style={styles.sectionLabel}>LINKED FIREARM</Text>
          <View style={styles.card}>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  selectedFirearmId === null && styles.chipActive,
                ]}
                onPress={() => setSelectedFirearmId(null)}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedFirearmId === null && styles.chipTextActive,
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {firearms.map((firearm) => (
                <TouchableOpacity
                  key={firearm.id}
                  style={[
                    styles.chip,
                    selectedFirearmId === firearm.id && styles.chipActive,
                  ]}
                  onPress={() => setSelectedFirearmId(selectedFirearmId === firearm.id ? null : firearm.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      selectedFirearmId === firearm.id && styles.chipTextActive,
                    ]}
                  >
                    {firearm.make} {firearm.model}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Notes Section */}
          <Text style={styles.sectionLabel}>NOTES</Text>
          <View style={styles.card}>
            <View style={styles.notesContainer}>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Add any additional notes..."
                placeholderTextColor={MUTED}
                multiline
                numberOfLines={4}
              />
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType = 'default', prefix, last }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  prefix?: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.fieldRow, !last && styles.fieldBorder]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRight}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={MUTED}
          keyboardType={keyboardType}
          autoCorrect={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  cancelText: {
    color: MUTED,
    fontSize: 16,
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  saveText: {
    color: GOLD,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 8,
  },
  subLabel: {
    color: GOLD,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: SURFACE,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 16,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldLabel: {
    color: 'white',
    fontSize: 14,
    flex: 1,
  },
  fieldRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  prefix: {
    color: MUTED,
    fontSize: 14,
    marginRight: 4,
  },
  fieldInput: {
    color: 'white',
    fontSize: 14,
    padding: 0,
    textAlign: 'right',
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'transparent',
  },
  chipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  chipText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: BG,
    fontWeight: '600',
  },
  notesContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notesInput: {
    color: 'white',
    fontSize: 14,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    padding: 10,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  bottomSpacer: {
    height: 20,
  },
});
