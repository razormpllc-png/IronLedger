// FFL Bound Book (Preview) — screen-side wrapper around lib/boundBookExport.ts
//
// Shows a summary of what the bound book export will contain (total entries,
// how many would be flagged for missing ATF-required fields) and exposes two
// buttons: PDF (for audit copies / printing) and CSV (for import into
// bound-book software).
//
// Entry is gated on the `ffl_bound_book` entitlement from the dashboard
// tile; once the user is here we assume the gate has been cleared.

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  generateBoundBookPdf,
  generateBoundBookCsv,
  getBoundBookSummary,
  getFlaggedEntries,
  type BoundBookSummary,
  type FlaggedEntry,
} from '../lib/boundBookExport';
import { useEntitlements } from '../lib/useEntitlements';
import { showPaywall } from '../lib/paywall';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';
const SURFACE = '#1A1A1A';
const BORDER = '#2A2A2A';
const WARN = '#F5C518';

export default function FflBoundBookScreen() {
  const router = useRouter();
  const ent = useEntitlements();
  const [summary, setSummary] = useState<BoundBookSummary>({ rows: 0, flagged: 0 });
  const [flagged, setFlagged] = useState<FlaggedEntry[]>([]);
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);

  useFocusEffect(
    useCallback(() => {
      setSummary(getBoundBookSummary());
      setFlagged(getFlaggedEntries());
    }, []),
  );

  function openItem(entry: FlaggedEntry) {
    // Route to the item's detail screen — the edit button lives there. We
    // deliberately avoid jumping straight into the edit screen so the user
    // sees what they're patching in context.
    if (entry.kind === 'firearm') {
      router.push(`/firearm/${entry.itemId}`);
    } else {
      router.push(`/suppressor/${entry.itemId}`);
    }
  }

  async function handle(kind: 'pdf' | 'csv') {
    if (busy) return;
    setBusy(kind);
    try {
      const result = kind === 'pdf'
        ? await generateBoundBookPdf()
        : await generateBoundBookCsv();
      if (!result.ok && result.reason === 'empty') {
        Alert.alert(
          'Nothing to Export',
          'Add a firearm or suppressor first, then try again.',
        );
      }
    } catch (e: any) {
      Alert.alert('Export Failed', e?.message ?? 'Could not generate the file.');
    } finally {
      setBusy(null);
      // Refresh summary + flagged list in case the underlying data changed
      // during export (unlikely, but keeps the screen honest).
      setSummary(getBoundBookSummary());
      setFlagged(getFlaggedEntries());
    }
  }

  const empty = summary.rows === 0;

  // Deep-link / direct-nav safety — same pattern as /insurance and
  // /form-4-tracker. Dashboard tile is already gated, but a Lite user who
  // reaches this route another way sees the feature-matched paywall stub.
  if (!ent.isPro) {
    return (
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.back}>
            <Text style={s.backTxt}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>FFL Bound Book</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={s.proGate}>
          <Text style={s.proGateIcon}>📘</Text>
          <Text style={s.proGateTitle}>FFL Bound Book is Pro</Text>
          <Text style={s.proGateSub}>
            ATF-style acquisition + disposition records, with PDF and CSV export and
            missing-field flags on every row.
          </Text>
          <TouchableOpacity
            style={s.proGateCta}
            onPress={() => showPaywall({ mode: 'contextual', feature: 'ffl_bound_book' })}
            activeOpacity={0.85}
          >
            <Text style={s.proGateCtaText}>See Pro Features</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>FFL Bound Book</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.previewBanner}>
          <Text style={s.previewBannerTitle}>Preview Feature</Text>
          <Text style={s.previewBannerBody}>
            This export builds the acquisition side of an ATF-style A&amp;D book
            from your Iron Ledger records. Disposition columns, FFL numbers,
            and importer fields are blank — those land with the dedicated FFL
            tier. Use this as an audit-prep or reconciliation aid, not as a
            compliant bound book (27 CFR §478.125).
          </Text>
        </View>

        <View style={s.summaryCard}>
          <Text style={s.summaryLabel}>SUMMARY</Text>
          <View style={s.statRow}>
            <View style={s.stat}>
              <Text style={s.statNum}>{summary.rows}</Text>
              <Text style={s.statLbl}>Entries</Text>
            </View>
            <View style={s.stat}>
              <Text style={[s.statNum, summary.flagged > 0 && s.statWarn]}>
                {summary.flagged}
              </Text>
              <Text style={s.statLbl}>Flagged</Text>
            </View>
          </View>
          {summary.flagged > 0 ? (
            <Text style={s.flaggedNote}>
              Tap any flagged entry below to jump to its detail screen and
              patch the missing fields. Flagged rows are also highlighted in
              yellow on the PDF and their missing fields listed in the CSV.
            </Text>
          ) : summary.rows > 0 ? (
            <Text style={s.okNote}>
              All entries have the required acquisition fields filled in.
            </Text>
          ) : null}
        </View>

        {flagged.length > 0 ? (
          <View style={s.flaggedCard}>
            <Text style={s.flaggedCardLabel}>FIX MISSING FIELDS</Text>
            {flagged.map((entry, i) => (
              <TouchableOpacity
                key={`${entry.kind}-${entry.itemId}`}
                style={[s.flaggedRow, i === flagged.length - 1 && s.flaggedRowLast]}
                onPress={() => openItem(entry)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <View style={s.flaggedTitleRow}>
                    <Text style={s.flaggedLabel} numberOfLines={1}>
                      {entry.label}
                    </Text>
                    <View
                      style={[
                        s.kindPill,
                        entry.kind === 'suppressor' && s.kindPillSuppressor,
                      ]}
                    >
                      <Text
                        style={[
                          s.kindPillText,
                          entry.kind === 'suppressor' && s.kindPillTextSuppressor,
                        ]}
                      >
                        {entry.kind === 'firearm' ? 'FIREARM' : 'SUPPRESSOR'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.flaggedMissing} numberOfLines={2}>
                    Missing: {entry.missing.join(', ')}
                  </Text>
                </View>
                <Text style={s.flaggedChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          style={[s.primaryBtn, empty && s.btnDisabled]}
          onPress={() => handle('pdf')}
          disabled={empty || busy !== null}
          activeOpacity={0.8}
        >
          {busy === 'pdf'
            ? <ActivityIndicator color="#000" />
            : <Text style={s.primaryBtnTxt}>📄  Export PDF</Text>}
        </TouchableOpacity>
        <Text style={s.btnHint}>
          Landscape 11×17 layout — print-ready audit copy.
        </Text>

        <TouchableOpacity
          style={[s.secondaryBtn, empty && s.btnDisabled]}
          onPress={() => handle('csv')}
          disabled={empty || busy !== null}
          activeOpacity={0.8}
        >
          {busy === 'csv'
            ? <ActivityIndicator color={GOLD} />
            : <Text style={s.secondaryBtnTxt}>📊  Export CSV</Text>}
        </TouchableOpacity>
        <Text style={s.btnHint}>
          RFC 4180 format — import into your bound-book software.
        </Text>

        <View style={s.disclaimer}>
          <Text style={s.disclaimerTitle}>NOT A CERTIFIED RECORD</Text>
          <Text style={s.disclaimerBody}>
            This is a data snapshot from Iron Ledger. It does not constitute a
            compliant ATF bound book. FFLs must maintain A&amp;D records per
            27 CFR §478.125 using ATF-approved electronic or paper methods.
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 60, paddingHorizontal: 20, paddingBottom: 16,
  },
  back: { width: 60 },
  backTxt: { color: GOLD, fontSize: 17 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  proGate: { flex: 1, alignItems: 'center', justifyContent: 'center',
             paddingHorizontal: 32, paddingBottom: 60 },
  proGateIcon: { fontSize: 48, marginBottom: 16 },
  proGateTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  proGateSub: { color: '#9C9C9C', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  proGateCta: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  proGateCtaText: { color: '#0D0D0D', fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  scroll: { paddingHorizontal: 20 },

  previewBanner: {
    backgroundColor: 'rgba(245, 197, 24, 0.1)',
    borderWidth: 1, borderColor: WARN, borderRadius: 10,
    padding: 14, marginBottom: 18,
  },
  previewBannerTitle: {
    color: WARN, fontWeight: '700', fontSize: 12,
    letterSpacing: 1.5, marginBottom: 6,
  },
  previewBannerBody: { color: '#d8c98a', fontSize: 13, lineHeight: 19 },

  summaryCard: {
    backgroundColor: SURFACE, borderRadius: 14, padding: 20,
    marginBottom: 20, borderWidth: 1, borderColor: BORDER,
  },
  summaryLabel: {
    color: GOLD, fontSize: 11, fontWeight: '700',
    letterSpacing: 2, marginBottom: 14,
  },
  statRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 28, fontWeight: '700' },
  statWarn: { color: WARN },
  statLbl: { color: '#888', fontSize: 12, marginTop: 4 },
  flaggedNote: {
    color: '#d8c98a', fontSize: 12, lineHeight: 18,
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER,
  },
  okNote: {
    color: '#8BC34A', fontSize: 12, lineHeight: 18,
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER,
  },

  flaggedCard: {
    backgroundColor: SURFACE, borderRadius: 14,
    borderWidth: 1, borderColor: WARN, marginBottom: 20,
    overflow: 'hidden',
  },
  flaggedCardLabel: {
    color: WARN, fontSize: 11, fontWeight: '700',
    letterSpacing: 2, padding: 14, paddingBottom: 10,
  },
  flaggedRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: BORDER,
    gap: 8,
  },
  flaggedRowLast: { borderBottomWidth: 0 },
  flaggedTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  flaggedLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flexShrink: 1 },
  flaggedMissing: { color: '#d8c98a', fontSize: 12, lineHeight: 17 },
  flaggedChevron: { color: '#555', fontSize: 22, marginLeft: 4 },

  kindPill: {
    backgroundColor: '#2A2115', borderColor: '#3A2C18', borderWidth: 1,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  kindPillText: {
    color: GOLD, fontSize: 9, fontWeight: '800', letterSpacing: 0.8,
  },
  kindPillSuppressor: {
    backgroundColor: 'rgba(245, 197, 24, 0.12)', borderColor: '#5C4800',
  },
  kindPillTextSuppressor: { color: WARN },

  primaryBtn: {
    backgroundColor: GOLD, borderRadius: 12, paddingVertical: 16,
    alignItems: 'center', marginBottom: 6,
  },
  primaryBtnTxt: { color: '#000', fontSize: 17, fontWeight: '700' },
  secondaryBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: GOLD, marginBottom: 6, marginTop: 12,
  },
  secondaryBtnTxt: { color: GOLD, fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  btnHint: {
    color: '#555', fontSize: 12, textAlign: 'center', marginBottom: 4,
  },

  disclaimer: {
    marginTop: 24, padding: 14, borderRadius: 8,
    borderWidth: 1, borderColor: BORDER, backgroundColor: '#111',
  },
  disclaimerTitle: {
    color: '#888', fontSize: 10, fontWeight: '700',
    letterSpacing: 1.5, marginBottom: 6,
  },
  disclaimerBody: { color: '#777', fontSize: 11, lineHeight: 17 },
});
