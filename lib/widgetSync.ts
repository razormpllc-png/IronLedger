/**
 * Widget sync bridge. Writes the latest widget payload into the App Group
 * shared container and asks WidgetKit to refresh all timelines.
 *
 * The actual native write happens through a NativeModule (`IronLedgerWidgets`)
 * defined in ios/IronLedgerWidgets/. That module lazily no-ops on Android
 * and on iOS simulators without the App Group entitlement so callers never
 * need to wrap in a try/catch.
 *
 * Call `syncWidgets()`:
 *   - From the dashboard's useFocusEffect (refresh when user opens app)
 *   - After any mutation that changes Form 4 / battery / ammo / firearm
 *     count data (add-firearm, edit-firearm, add-ammo, battery replace, etc.)
 *
 * Throttling: debounced on a 2-second trailing edge so a burst of writes
 * (e.g. bulk delete, migration) only fires a single WidgetKit reload.
 */
import { NativeModules, Platform } from 'react-native';
import { buildWidgetPayload } from './widgetData';

interface IronLedgerWidgetsModule {
  writePayload(json: string): Promise<void>;
  reloadAllTimelines(): void;
}

/**
 * Lazy accessor so the module reference is resolved at call time, not at
 * import time. Avoids crashing older builds that don't yet ship the native
 * extension.
 */
function nativeModule(): IronLedgerWidgetsModule | null {
  if (Platform.OS !== 'ios') return null;
  const mod = (NativeModules as Record<string, unknown>)['IronLedgerWidgets'];
  if (!mod) return null;
  return mod as IronLedgerWidgetsModule;
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Compute the latest payload and push it to WidgetKit. Safe to call from
 * anywhere — no-ops on non-iOS and on iOS builds that predate the widget
 * extension.
 *
 * Debounced 2s so rapid successive calls (bulk edits, migration runs) coalesce.
 */
export function syncWidgets(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void syncWidgetsImmediate();
  }, 2000);
}

/** Fire-and-forget immediate sync. Most callers should prefer `syncWidgets()`. */
export async function syncWidgetsImmediate(): Promise<void> {
  const mod = nativeModule();
  if (!mod) return;
  try {
    const payload = buildWidgetPayload();
    await mod.writePayload(JSON.stringify(payload));
    mod.reloadAllTimelines();
  } catch (e) {
    // Widget refresh is non-critical — log but never throw up to callers.
    console.warn('[widgetSync] sync failed', e);
  }
}
