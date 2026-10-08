import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { BadgeCheck, Heart } from 'lucide-react-native';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinear, RadialGradient, Rect, Stop } from 'react-native-svg';

import { PRIMARY_GRADIENT, T } from '@/constants/theme';
import { interestIcon } from '@/lib/mock';

import { Txt } from './Txt';

/* ------------------------------ buttons ------------------------------ */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  colors = PRIMARY_GRADIENT,
  style,
  small,
  icon,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  colors?: readonly [string, string, ...string[]];
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        { borderRadius: 999, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        styles.primaryShadow,
        style,
      ]}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.primary, small && { paddingVertical: 10, paddingHorizontal: 18 }]}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {icon}
            <Txt w={700} size={small ? 13 : 15} color="#fff">
              {label}
            </Txt>
          </View>
        )}
      </LinearGradient>
    </Pressable>
  );
}

export function GhostButton({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.ghost, pressed && { opacity: 0.8 }, style]}>
      {children}
    </Pressable>
  );
}

export function TextButton({ label, onPress, color = T.muted, size = 13.5 }: { label: string; onPress?: () => void; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 8 }}>
      <Txt size={size} color={color}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function IconBtn({ children, onPress, size = 36, style, label }: { children: ReactNode; onPress?: () => void; size?: number; style?: StyleProp<ViewStyle>; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={label ? 'button' : undefined}
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' },
        pressed && { opacity: 0.75 },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export function RoundBtn({ children, onPress, color, big, small, disabled }: { children: ReactNode; onPress?: () => void; color: string; big?: boolean; small?: boolean; disabled?: boolean }) {
  const size = big ? 66 : small ? 44 : 56;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: T.border,
        backgroundColor: T.surface,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: color,
        shadowOpacity: 0.45,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}>
      {children}
    </Pressable>
  );
}

/* ------------------------------ chip ------------------------------ */
export function Chip({ label, active, onPress, small }: { label: string; active?: boolean; onPress?: () => void; small?: boolean }) {
  const icon = interestIcon(label);
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: small ? 6 : 9,
        paddingHorizontal: small ? 11 : 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? T.rose : T.border,
        backgroundColor: active ? `${T.rose}22` : T.surface2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}>
      {icon ? <Txt size={small ? 12 : 13.5}>{icon}</Txt> : null}
      <Txt w={500} size={small ? 12 : 13.5} color={active ? '#fff' : T.muted}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Small read-only tag pill used on discover cards. */
export function Tag({ label }: { label: string }) {
  const icon = interestIcon(label);
  return (
    <View style={{ backgroundColor: T.surface2, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, borderWidth: 1, borderColor: T.border }}>
      <Txt size={11}>
        {icon ? `${icon} ` : ''}
        {label}
      </Txt>
    </View>
  );
}

/* ------------------------------ match ring ------------------------------ */
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function MatchRing({ percent, size = 56, stroke = 5 }: { percent: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: percent, duration: 1000, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
  }, [percent, v]);
  const offset = v.interpolate({ inputRange: [0, 100], outputRange: [c, 0] });
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <SvgLinear id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={T.rose} />
            <Stop offset="55%" stopColor={T.amber} />
            <Stop offset="100%" stopColor={T.violet} />
          </SvgLinear>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={T.surface3} strokeWidth={stroke} fill="rgba(21,18,28,0.55)" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ring)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Txt v="mono" w={600} size={size * 0.24}>
          {percent}%
        </Txt>
      </View>
    </View>
  );
}

/* ------------------------------ text helpers ------------------------------ */
export function GradientText({ text, size, colors = [T.rose, T.amber], w = 700 }: { text: string; size: number; colors?: [string, string]; w?: 500 | 600 | 700 }) {
  const label = (
    <Txt v="display" w={w} size={size} style={{ letterSpacing: 1 }}>
      {text}
    </Txt>
  );
  return (
    <MaskedView maskElement={label}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}>
        <View style={{ opacity: 0 }}>{label}</View>
      </LinearGradient>
    </MaskedView>
  );
}

export function SectionTitle({ title, sub, action, onAction }: { title: string; sub?: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 }}>
      <Txt w={700} size={15}>
        {title} {sub ? <Txt size={13}>{sub}</Txt> : null}
      </Txt>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Txt w={600} size={12.5} color={T.rose}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)', borderRadius: 20, paddingVertical: 32, paddingHorizontal: 20, alignItems: 'center', marginBottom: 16, gap: 8 }}>
      <Heart size={26} color={T.mutedDim} />
      <Txt size={13.5} color={T.muted} center>
        {text}
      </Txt>
      {children}
    </View>
  );
}

export function StatCard({ value, sub }: { value: string; sub: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: T.surface, borderWidth: 1, borderColor: T.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' }}>
      <Txt v="display" size={20}>
        {value}
      </Txt>
      <Txt size={10.5} color={T.muted} style={{ marginTop: 2 }}>
        {sub}
      </Txt>
    </View>
  );
}

/* ------------------------------ toggles / rows ------------------------------ */
export function Toggle({ active, onPress }: { active: boolean; onPress: () => void }) {
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: active ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [active, v]);
  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <Animated.View
        style={{
          width: 42,
          height: 24,
          borderRadius: 999,
          backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [T.surface3, T.rose] }),
        }}>
        <Animated.View
          style={{ position: 'absolute', top: 3, left: v.interpolate({ inputRange: [0, 1], outputRange: [3, 21] }), width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }}
        />
      </Animated.View>
    </Pressable>
  );
}

export function SettingRow({ icon, label, active, onPress }: { icon: ReactNode; label: string; active: boolean; onPress: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: T.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
        {icon}
        <Txt size={13.5}>{label}</Txt>
      </View>
      <Toggle active={active} onPress={onPress} />
    </View>
  );
}

export function SafetyLink({ icon, label, onPress, trailing, color = T.text }: { icon: ReactNode; label: string; onPress?: () => void; trailing?: ReactNode; color?: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: T.border, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon}
        <Txt size={13.5} color={color}>
          {label}
        </Txt>
      </View>
      {trailing}
    </Pressable>
  );
}

/* ------------------------------ images ------------------------------ */
export function Avatar({ uri, size, ring, name, style }: { uri: string | null | undefined; size: number; ring?: string; name?: string; style?: StyleProp<ViewStyle> }) {
  const border = ring ? { borderWidth: 2, borderColor: ring } : null;
  if (uri) {
    return <Image source={{ uri }} style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.surface3 }, border, style as object]} />;
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: T.surface3, alignItems: 'center', justifyContent: 'center' }, border, style]}>
      <Txt v="display" w={600} size={size * 0.4} color={T.muted}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Txt>
    </View>
  );
}

/** Photo with graceful placeholder (initial letter on a gradient). */
export function Photo({ uri, name, style }: { uri: string | null | undefined; name?: string; style?: StyleProp<ViewStyle> }) {
  if (uri) return <Image source={{ uri }} style={[{ backgroundColor: T.surface3 }, style as object]} resizeMode="cover" />;
  return (
    <LinearGradient colors={[T.surface3, '#3A2050']} style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
      <Txt v="display" w={600} size={42} color={T.muted}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Txt>
    </LinearGradient>
  );
}

export function VerifiedIcon({ size = 16 }: { size?: number }) {
  return <BadgeCheck size={size} color={T.mint} />;
}

/** Dark translucent pill, e.g. "92% match" over photos. */
export function DarkPill({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: T.chipDark, borderRadius: 10, paddingVertical: 2, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>{children}</View>;
}

export function LiveBadge({ size = 9.5 }: { size?: number }) {
  return (
    <View style={{ backgroundColor: T.rose, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6 }}>
      <Txt v="mono" w={600} size={size} color="#fff">
        ● LIVE
      </Txt>
    </View>
  );
}

export function DemoTag({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ backgroundColor: T.chipDark, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 6, borderWidth: 1, borderColor: T.border }, style]}>
      <Txt v="mono" size={9} color={T.muted}>
        DEMO
      </Txt>
    </View>
  );
}

/* ------------------------------ backgrounds ------------------------------ */
/** Radial colour blob (CSS radial-gradient(circle, color, transparent 70%)). */
export function RadialBlob({ color, size, opacity = 0.33, style }: { color: string; size: number; opacity?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="b" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={opacity} />
            <Stop offset="70%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#b)" />
      </Svg>
    </View>
  );
}

/** App backdrop: radial-gradient(1200px 600px at 50% -10%, #241C33, ink 55%). */
export function Backdrop() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: T.ink }]}>
      <Svg width="100%" height={620} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <Defs>
          <RadialGradient id="bd" cx="50%" cy="0%" rx="90%" ry="100%" fx="50%" fy="0%">
            <Stop offset="0%" stopColor="#2A2040" stopOpacity={1} />
            <Stop offset="100%" stopColor={T.ink} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bd)" />
      </Svg>
    </View>
  );
}

/* ------------------------------ skeleton shimmer ------------------------------ */
export function Skeleton({ width, height, radius = 6, style }: { width: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={[{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: '#241E30' }, style]}>
      <Animated.View style={{ position: 'absolute', top: 0, bottom: 0, width: 300, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-300, 300] }) }] }}>
        <LinearGradient colors={['#241E30', '#322A3E', '#241E30']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ flex: 1 }} />
      </Animated.View>
    </View>
  );
}

/* ------------------------------ entrance animations ------------------------------ */
export function FadeUp({ children, delay = 0, style }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 350, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

export function PopIn({ children, delay = 0, style, duration = 280 }: { children: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; duration?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.bezier(0.2, 0.9, 0.3, 1.2), useNativeDriver: true }).start();
  }, [v, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  primary: { paddingVertical: 16, paddingHorizontal: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  primaryShadow: { shadowColor: T.rose, shadowOpacity: 0.45, shadowRadius: 15, shadowOffset: { width: 0, height: 12 } },
  ghost: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface2, alignItems: 'center', justifyContent: 'center' },
});
