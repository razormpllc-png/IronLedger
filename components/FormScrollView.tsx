/**
 * FormScrollView — drop-in replacement for the old
 * KeyboardAvoidingView + ScrollView pattern used in form screens.
 *
 * Uses React Native's built-in `automaticallyAdjustKeyboardInsets` (iOS)
 * to natively scroll focused inputs into view when the keyboard opens.
 * On Android, the system-level adjustResize handles keyboard avoidance.
 *
 * Migration: remove the KeyboardAvoidingView wrapper and swap
 * <ScrollView> for <FormScrollView>.
 */
import React, { forwardRef } from 'react';
import { ScrollView, ScrollViewProps, Platform } from 'react-native';

const FormScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ children, ...props }, ref) => (
    <ScrollView
      ref={ref}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      {...props}
    >
      {children}
    </ScrollView>
  ),
);

FormScrollView.displayName = 'FormScrollView';

export default FormScrollView;
