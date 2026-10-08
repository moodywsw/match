import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Bell, Heart, Home, MessageCircle, Plus, Radio, Search } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LitMatch } from '@/components/ui/LitMatch';
import { Avatar, IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';

export const TOP_BAR_H = 68;
export const BOTTOM_NAV_H = 62;

/** Space screens must leave for the glass bars. */
export function useBarInsets() {
  const insets = useSafeAreaInsets();
  return {
    top: insets.top + TOP_BAR_H,
    bottom: Math.max(insets.bottom, 12) + BOTTOM_NAV_H,
  };
}

function Glass({ style, children }: { style?: object; children: React.ReactNode }) {
  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      {Platform.OS === 'ios' ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? T.glass : 'rgba(30,25,40,0.96)' }]} />
      {children}
    </View>
  );
}

export function Wordmark({ size = 22, match = 16 }: { size?: number; match?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Txt v="display" w={600} size={size} style={{ letterSpacing: -0.5 }}>
        MATCH
      </Txt>
      <LitMatch size={match} />
    </View>
  );
}

export function TopBar({
  canGoBack,
  onBack,
  onLive,
  onBell,
  onAvatar,
  photo,
  name,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onLive: () => void;
  onBell: () => void;
  onAvatar: () => void;
  photo: string | null;
  name: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Glass style={[styles.top, { paddingTop: insets.top }]}>
      <View style={styles.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {canGoBack ? (
            <IconBtn size={32} onPress={onBack}>
              <ArrowLeft size={16} color={T.text} />
            </IconBtn>
          ) : null}
          <Wordmark />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBtn onPress={onLive}>
            <Radio size={18} color={T.rose} />
          </IconBtn>
          <IconBtn onPress={onBell}>
            <Bell size={18} color={T.text} />
          </IconBtn>
          <Pressable onPress={onAvatar} hitSlop={6}>
            <Avatar uri={photo} name={name} size={34} ring={T.rose} />
          </Pressable>
        </View>
      </View>
    </Glass>
  );
}

const NAV = [
  { key: 'home', icon: Home, label: 'Home' },
  { key: 'discover', icon: Search, label: 'Discover' },
  { key: 'create', icon: Plus, label: 'Create' },
  { key: 'matches', icon: Heart, label: 'Matches' },
  { key: 'messages', icon: MessageCircle, label: 'Messages' },
] as const;

export function BottomNav({ active, onTab, onCreate }: { active: string; onTab: (key: string) => void; onCreate: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Glass style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bottomRow}>
        {NAV.map((it) => {
          const Icon = it.icon;
          if (it.key === 'create') {
            return (
              <Pressable key={it.key} onPress={onCreate} style={({ pressed }) => [styles.createWrap, pressed && { transform: [{ scale: 0.94 }] }]}>
                <LinearGradient colors={[T.rose, T.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.create}>
                  <Icon size={22} color="#fff" />
                </LinearGradient>
              </Pressable>
            );
          }
          const on = active === it.key;
          const color = on ? T.rose : T.mutedDim;
          return (
            <Pressable key={it.key} onPress={() => onTab(it.key)} style={styles.navItem} hitSlop={4}>
              <Icon size={20} color={color} fill={on && it.key === 'matches' ? T.rose : 'none'} />
              <Txt w={600} size={9.5} color={color}>
                {it.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, borderBottomWidth: 1, borderBottomColor: T.border },
  topRow: { height: TOP_BAR_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50, borderTopWidth: 1, borderTopColor: T.border },
  bottomRow: { height: BOTTOM_NAV_H, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 8, paddingTop: 4 },
  navItem: { alignItems: 'center', gap: 3, paddingVertical: 4, paddingHorizontal: 8, minWidth: 56 },
  createWrap: { marginTop: -8, borderRadius: 23, shadowColor: T.rose, shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  create: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
