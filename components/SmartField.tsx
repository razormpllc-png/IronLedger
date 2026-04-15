/**
 * SmartField — a labeled TextInput with inline autocomplete suggestions.
 *
 * API mirrors the local `Field` components scattered across add/edit
 * screens (label, value, onChange, placeholder, keyboardType, last,
 * multiline) so it can be dropped in as a replacement with a single
 * extra prop: `source`. That prop tells `getSuggestions` which DB column
 * + seed list to pull from (e.g. `'accessory_make'`, `'firearm_caliber'`,
 * `'purchase_location'`).
 *
 * Suggestions render as a horizontal chip row directly beneath the input
 * and only appear while the field is focused and has at least one match.
 * Tapping a chip commits that value and dismisses the row. We deliberately
 * don't dismiss on blur until after a short delay so the tap doesn't get
 * eaten by the keyboard collapse — standard autocomplete pattern on iOS.
 */
import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { getSuggestions, SuggestionSource } from '../lib/suggestions';

const GOLD = '#C9A84C';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const MUTED = '#555555';
const TEXT = '#E8E6DF';

export interface SmartFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  source: SuggestionSource;
  placeholder?: string;
  keyboardType?: any;
  last?: boolean;
  multiline?: boolean;
  /** Max number of suggestion chips shown at once. Defaults to 5. */
  limit?: number;
}

export default function SmartField({
  label, value, onChange, source, placeholder, keyboardType,
  last, multiline, limit = 5,
}: SmartFieldProps) {
  const [focused, setFocused] = useState(false);

  // Recompute suggestions on every keystroke. DB reads are synchronous
  // against a local SQLite file — fast enough for an onChange handler.
  const suggestions = useMemo(() => {
    if (!focused) return [];
    return getSuggestions(value, source, limit);
  }, [value, source, limit, focused]);

  // Filter out the exact-match case — no point suggesting what the user
  // already typed verbatim.
  const filtered = suggestions.filter(
    (s) => s.toLowerCase() !== value.trim().toLowerCase(),
  );

  return (
    <View style={[styles.wrap, !last && styles.border]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={MUTED}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCorrect={false}
        autoCapitalize="words"
        onFocus={() => setFocused(true)}
        // Small delay so chip taps register before the row hides.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {focused && filtered.length > 0 && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowInner}
        >
          {filtered.map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.chip}
              onPress={() => {
                onChange(s);
                setFocused(false);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.chipText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 12 },
  border: { borderBottomWidth: 1, borderBottomColor: BORDER },
  label: { color: GOLD, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  input: { color: TEXT, fontSize: 16, paddingVertical: 4 },
  chipRow: { marginTop: 8, marginHorizontal: -4 },
  chipRowInner: { paddingHorizontal: 4, gap: 6 },
  chip: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  chipText: { color: GOLD, fontSize: 12, fontWeight: '600' },
});
