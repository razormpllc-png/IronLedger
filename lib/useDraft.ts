/**
 * useAutoSave — persist form state to AsyncStorage automatically.
 *
 * Designed to retrofit into existing forms that use individual useState
 * calls without requiring a refactor to a single state object.
 *
 * Usage:
 *   const { restored, clearDraft } = useAutoSave('add-firearm', {
 *     nickname, make, model, caliber, serialNumber, ... // spread all fields
 *   });
 *
 *   // Restore on mount (only runs once when `restored` first becomes non-null)
 *   useEffect(() => {
 *     if (!restored) return;
 *     setNickname(restored.nickname ?? '');
 *     setMake(restored.make ?? '');
 *     // ...etc
 *   }, [restored]);
 *
 *   // On successful save:
 *   clearDraft();
 *
 * How it works:
 *   - On mount, reads AsyncStorage for a saved draft and exposes it via `restored`
 *   - Every render, debounce-saves the current `formData` to AsyncStorage (500ms)
 *   - Immediately flushes when app goes to background/inactive
 *   - `clearDraft()` removes the draft (call on save or explicit cancel)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_PREFIX = '@ironledger_draft:';
const DEBOUNCE_MS = 500;

export function useAutoSave<T extends Record<string, any>>(
  screenKey: string,
  formData: T,
): {
  /** The restored draft from a previous session, or null if none existed.
   *  Populated once on mount — use in a useEffect to hydrate your setters. */
  restored: T | null;
  /** Whether AsyncStorage has been checked. Form can render immediately but
   *  restored values won't be available until this is true. */
  ready: boolean;
  /** Whether a draft was actually found and restored. */
  wasRestored: boolean;
  /** Call on successful save or cancel to remove the persisted draft. */
  clearDraft: () => void;
} {
  const storageKey = `${DRAFT_PREFIX}${screenKey}`;
  const [restored, setRestored] = useState<T | null>(null);
  const [ready, setReady] = useState(false);
  const [wasRestored, setWasRestored] = useState(false);

  // Keep a ref to the latest formData so the AppState listener isn't stale.
  const latestRef = useRef<T>(formData);
  latestRef.current = formData;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard: don't auto-save until restore check is complete (avoids
  // overwriting a real draft with the initial empty state).
  const restoredRef = useRef(false);

  // ── Restore on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw && !cancelled) {
          const parsed = JSON.parse(raw) as T;
          setRestored(parsed);
          setWasRestored(true);
        }
      } catch {
        // Corrupt draft — start fresh.
      } finally {
        if (!cancelled) {
          restoredRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [storageKey]);

  // ── Flush helper ─────────────────────────────────────────
  const flush = useCallback(async (state: T) => {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Storage full — swallow.
    }
  }, [storageKey]);

  // ── Debounced save on every formData change ──────────────
  useEffect(() => {
    if (!restoredRef.current) return; // don't save until restore check is done
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(formData), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [formData, flush]);

  // ── Immediate save on background ─────────────────────────
  useEffect(() => {
    const handleAppState = (next: AppStateStatus) => {
      if (next === 'inactive' || next === 'background') {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (restoredRef.current) flush(latestRef.current);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => { sub.remove(); };
  }, [flush]);

  // ── Clear ────────────────────────────────────────────────
  const clearDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await AsyncStorage.removeItem(storageKey);
    } catch {
      // Swallow.
    }
  }, [storageKey]);

  return { restored, ready, wasRestored, clearDraft };
}
