/**
 * SuggestionRow — a standalone chip row that sits below any TextInput and
 * surfaces autocomplete candidates from `getSuggestions`. Use this when a
 * screen has bespoke input layout that can't adopt SmartField wholesale
 * (e.g. dope-card's inline "100 yards" row, range-session's location
 * input inside a custom card).
 *
 * Usage:
 *   <TextInput value={ammo} onChangeText={setAmmo} ... />
 *   <SuggestionRow source="ammo_brand" query={ammo} onPick={setAmmo} />
 *
 * The row only renders when there's at least one non-exact match, so
 * placing it under every input is safe — it visually disappears when
 * there's nothing to suggest.
 */
import { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { getSuggestions, SuggestionSource } from '../lib/suggestions';

const GOLD = '#C9A84C';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';

interface Props {
  source: SuggestionSource;
  query: string;
  onPick: (value: string) => void;
  /** Maximum number of chips to show. Defaults to 5. */
  limit?: number;
  /** When true, always show the row even with an empty query (for
   *  "popular values" prompts). Defaults to false — only appears once
   *  the user has started typing. */
  showOnEmpty?: boolean;
}

export default function SuggestionRow({
  source, query, onPick, limit = 5, showOnEmpty = false,
}: Props) {
  const suggestions = useMemo(() => {
    if (!query && !showOnEmpty) return [];
    return getSuggestions(query, source, limit);
  }, [query, source, limit, showOnEmpty]);

  const filtered = suggestions.filter(
    (s) => s.toLowerCase() !== query.trim().toLowerCase(),
  );

  if (filtered.length === 0) return null;

  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.rowInner}
    >
      {filtered.map((s) => (
        <TouchableOpacity
          key={s}
          style={styles.chip}
          onPress={() => onPick(s)}
          activeOpacity={0.7}
        >
          <Text style={styles.chipText}>{s}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: 8 },
  rowInner: { gap: 6 },
  chip: {
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
  },
  chipText: { color: GOLD, fontSize: 12, fontWeight: '600' },
});
