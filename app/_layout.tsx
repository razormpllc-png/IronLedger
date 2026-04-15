import { Stack, router } from 'expo-router';
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  AppState,
  AppStateStatus,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEntitlements } from '../lib/useEntitlements';
import { initPurchases } from '../lib/purchases';
import { handleDeepLink } from '../lib/deepLinks';

const GOLD = '#C9A84C';
const BG = '#0D0D0D';

export default function RootLayout() {
  const [unlocked, setUnlocked] = useState(false);
  const unlockedRef = useRef(false);
  const ent = useEntitlements();
  const redirectedRef = useRef(false);
  // Deep links can arrive before the app is unlocked / before onboarding
  // is complete. Park the URL here and replay it when the app is ready.
  const pendingLinkRef = useRef<string | null>(null);

  // First-launch onboarding gate. Fires exactly once per app session after
  // the entitlements store has finished loading AND the user has unlocked.
  // If onboarding has not been completed, bounce into the path selector.
  useEffect(() => {
    if (!unlocked) return;
    if (!ent.loaded) return;
    if (ent.onboardingComplete) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    router.replace('/onboarding');
  }, [unlocked, ent.loaded, ent.onboardingComplete]);

  // Deep-link listener. Widget taps (ironledger://form-4-tracker, etc.)
  // and any other external ironledger:// URL arrive here. We hold them
  // until unlock + onboarding are both settled so the user doesn't land
  // behind the Face ID screen.
  useEffect(() => {
    // Cold-start: fetch any URL the app was launched with.
    Linking.getInitialURL().then(url => {
      if (url) pendingLinkRef.current = url;
    });
    // Warm-state: stash each incoming URL and let the replay effect
    // below handle it once gates pass.
    const sub = Linking.addEventListener('url', ({ url }) => {
      pendingLinkRef.current = url;
      tryReplayDeepLink();
    });
    return () => sub.remove();
  }, []);

  // Replay any pending deep link once we're past unlock + onboarding.
  // Runs on every gate-state change so whichever gate resolves last
  // triggers the navigation.
  useEffect(() => {
    tryReplayDeepLink();
  }, [unlocked, ent.loaded, ent.onboardingComplete]);

  function tryReplayDeepLink() {
    const url = pendingLinkRef.current;
    if (!url) return;
    if (!unlocked) return;
    if (!ent.loaded) return;
    if (!ent.onboardingComplete) return;
    // Guard against infinite loops: clear before pushing.
    pendingLinkRef.current = null;
    handleDeepLink(url);
  }

  async function authenticate() {
    const supported = await LocalAuthentication.hasHardwareAsync();
    if (!supported) {
      setUnlocked(true);
      unlockedRef.current = true;
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Iron Ledger',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });

    if (result.success) {
      setUnlocked(true);
      unlockedRef.current = true;
    }
  }

  useEffect(() => {
    authenticate();
    // Fire-and-forget RevenueCat init. Safe to run before unlock; subscribes
    // the entitlements store to customer info updates for the session.
    initPurchases().catch(e => console.warn('[layout] initPurchases failed', e));

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        setUnlocked(false);
        unlockedRef.current = false;
      } else if (next === 'active' && !unlockedRef.current) {
        authenticate();
      }
    });

    return () => sub.remove();
  }, []);

  if (!unlocked) {
    return (
      <SafeAreaView style={styles.lock}>
        <View style={styles.lockContent}>
          <Image source={require('../assets/Icon.png')} style={styles.lockImage} />
          <Text style={styles.lockTitle}>IRON LEDGER</Text>
          <Text style={styles.lockSub}>Your armory is locked</Text>
          <TouchableOpacity style={styles.unlockBtn} onPress={authenticate}>
            <Text style={styles.unlockText}>Unlock with Face ID</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="add-firearm"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="edit-firearm"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="edit-maintenance"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="add-ammo"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="edit-ammo"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="add-expense"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="edit-expense"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="add-accessory"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="edit-accessory"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="firearm/[id]"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="paywall"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="onboarding"
        options={{
          headerShown: false,
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="nfa"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="form-4-tracker"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="nfa-trusts"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="nfa-trust/[id]"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="batteries"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="battery-log/[id]"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="backup"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="ffl-bound-book"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="dispose"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="add-session"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="dope-card"
        options={{
          presentation: 'modal',
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="dope/[id]"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, backgroundColor: BG },
  lockContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 40,
  },
  lockImage: { width: 100, height: 100, borderRadius: 20, marginBottom: 8 },
  lockTitle: { color: GOLD, fontSize: 28, fontWeight: '800', letterSpacing: 3 },
  lockSub: { color: '#666666', fontSize: 16 },
  unlockBtn: {
    marginTop: 28,
    paddingHorizontal: 32,
    paddingVertical: 16,
    backgroundColor: '#1E1A10',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOLD,
  },
  unlockText: { color: GOLD, fontSize: 16, fontWeight: '600' },
});