import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/constants/theme';

import { PopIn } from './primitives';
import { Txt } from './Txt';

/** Bottom sheet (prototype: fixed overlay + rounded-top surface + handle bar). */
export function Sheet({
  visible,
  onClose,
  children,
  title,
  icon,
  maxHeight = '85%',
  height,
  scroll = true,
  scrim = T.scrim,
  centerTitle,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  icon?: ReactNode;
  maxHeight?: `${number}%` | number;
  height?: `${number}%` | number;
  scroll?: boolean;
  scrim?: string;
  centerTitle?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: scrim }]} onPress={onClose} />
        <PopIn style={[styles.sheet, { maxHeight, paddingBottom: Math.max(insets.bottom, 16) + 14 }, height != null ? { height } : null]}>
          <View style={styles.handle} />
          {title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16, justifyContent: centerTitle ? 'center' : 'flex-start' }}>
              {icon}
              <Txt v="display" size={19}>
                {title}
              </Txt>
            </View>
          ) : null}
          <Body
            {...(scroll ? { keyboardShouldPersistTaps: 'handled' as const, showsVerticalScrollIndicator: false } : {})}
            style={scroll ? undefined : { flex: 1 }}>
            {children}
          </Body>
        </PopIn>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Centered card modal (verification, notifications). */
export function CenterModal({ visible, onClose, children, dismissable = true, style, top }: { visible: boolean; onClose: () => void; children: ReactNode; dismissable?: boolean; style?: StyleProp<ViewStyle>; top?: number }) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: top != null ? 'flex-start' : 'center', paddingTop: top }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,8,14,0.85)' }]} onPress={dismissable ? onClose : undefined} />
        <PopIn style={[{ backgroundColor: T.surface, borderRadius: 26, borderWidth: 1, borderColor: T.border }, style]}>{children}</PopIn>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 22,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: T.border,
  },
  handle: { width: 40, height: 4, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 4, alignSelf: 'center', marginBottom: 18 },
});
