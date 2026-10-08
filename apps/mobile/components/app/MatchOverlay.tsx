import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { IgnitingMatch } from '@/components/ui/LitMatch';
import { Avatar, GradientText, PopIn, PrimaryButton, TextButton } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';

const IGNITE_DELAY = 700;
const SPECTACLE_TOTAL = 5000;
const { width: W, height: H } = Dimensions.get('window');

function FloatingHeart({ left, duration, delay }: { left: `${number}%`; duration: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left,
        bottom: 40,
        fontSize: 22,
        opacity: v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -140] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) },
        ],
      }}>
      ❤️
    </Animated.Text>
  );
}

function PulseIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 600, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={{
        opacity: v.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.85, 1.06, 1] }) }],
      }}>
      {children}
    </Animated.View>
  );
}

export type MatchOverlayData = {
  name: string;
  photo: string | null;
  myPhoto: string | null;
  myName: string;
};

/**
 * The signature MATCH moment.
 * Phase 1 (5s): matchstick strikes, ignites (pop + sparks + amber flash), "MATCH!" pops above it.
 * Phase 2: "You and {name} liked each other", overlapping circles with a small lit match,
 * [Start the conversation] and "Keep discovering".
 */
export function MatchOverlay({ data, onClose, onMessage }: { data: MatchOverlayData | null; onClose: () => void; onMessage: () => void }) {
  return (
    <Modal visible={!!data} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {data ? <MatchMoment data={data} onClose={onClose} onMessage={onMessage} /> : null}
    </Modal>
  );
}

function MatchMoment({ data, onClose, onMessage }: { data: MatchOverlayData; onClose: () => void; onMessage: () => void }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<'ignite' | 'reveal'>('ignite');
  const flash = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(text, { toValue: 1, duration: 550, delay: IGNITE_DELAY + 220, easing: Easing.bezier(0.22, 0.9, 0.3, 1.3), useNativeDriver: true }).start();
    Animated.timing(out, { toValue: 1, duration: 350, delay: SPECTACLE_TOTAL - 350, easing: Easing.ease, useNativeDriver: true }).start();
    const t = setTimeout(() => setPhase('reveal'), SPECTACLE_TOTAL);
    return () => clearTimeout(t);
  }, [text, out]);

  const handleIgnite = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    flash.setValue(0);
    Animated.timing(flash, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: phase === 'reveal' ? 'flex-start' : 'center', overflow: 'hidden' }}>
      <Svg width={W} height={H + 100} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="bg" cx="50%" cy="40%" rx="70%" ry="55%" fx="50%" fy="40%">
            <Stop offset="0%" stopColor="#3A2050" stopOpacity={1} />
            <Stop offset="100%" stopColor="#0A080E" stopOpacity={0.96} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="#0A080E" opacity={0.6} />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bg)" />
      </Svg>

      {/* full-screen amber flash at the moment of ignition */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            zIndex: 2,
            opacity: flash.interpolate({ inputRange: [0, 0.28, 1], outputRange: [0, 1, 0] }),
            transform: [{ scale: flash.interpolate({ inputRange: [0, 0.28, 1], outputRange: [0.5, 1.3, 2.4] }) }],
          },
        ]}>
        <Svg width={W} height={H}>
          <Defs>
            <RadialGradient id="fl" cx="50%" cy="42%" rx="60%" ry="45%" fx="50%" fy="42%">
              <Stop offset="0%" stopColor="#FFE9B0" stopOpacity={1} />
              <Stop offset="0.35" stopColor={T.amber} stopOpacity={1} />
              <Stop offset="0.55" stopColor={T.rose} stopOpacity={0.9} />
              <Stop offset="0.72" stopColor={T.rose} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#fl)" />
        </Svg>
      </Animated.View>

      {phase === 'reveal'
        ? (['10%', '25%', '70%', '85%', '45%', '60%'] as const).map((l, i) => (
            <FloatingHeart key={l} left={l} duration={(2 + (i % 3)) * 1000} delay={i * 250} />
          ))
        : null}

      {phase === 'ignite' ? (
        <Animated.View
          style={{
            zIndex: 3,
            alignItems: 'center',
            gap: 22,
            opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ scale: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) }],
          }}>
          <Animated.View
            style={{
              opacity: text.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
              transform: [
                { scale: text.interpolate({ inputRange: [0, 0.55, 0.75, 1], outputRange: [0.4, 1.18, 0.94, 1] }) },
                { translateY: text.interpolate({ inputRange: [0, 0.55, 1], outputRange: [10, 0, 0] }) },
              ],
            }}>
            <GradientText text="MATCH!" size={46} />
          </Animated.View>
          <IgnitingMatch size={96} delay={IGNITE_DELAY} onIgnite={handleIgnite} />
        </Animated.View>
      ) : (
        <PopIn style={{ zIndex: 3, alignItems: 'center', paddingTop: insets.top + 56, paddingHorizontal: 24, width: '100%', maxWidth: 380 }}>
          <Txt v="display" size={34} center style={{ lineHeight: 39, marginBottom: 32 }}>
            {`You and ${data.name}\nliked each other`}
          </Txt>
          <View style={{ width: 150, height: 84, marginBottom: 52 }}>
            <View style={{ position: 'absolute', left: 0 }}>
              <PulseIn delay={0}>
                <Avatar uri={data.myPhoto} name={data.myName} size={84} style={{ borderWidth: 3, borderColor: T.ink }} />
              </PulseIn>
            </View>
            <View style={{ position: 'absolute', right: 0 }}>
              <PulseIn delay={100}>
                <Avatar uri={data.photo} name={data.name} size={84} style={{ borderWidth: 3, borderColor: T.ink }} />
              </PulseIn>
            </View>
            <PopIn style={{ position: 'absolute', left: 75 - 15, top: 42 - 45 * 0.62, zIndex: 2 }}>
              <IgnitingMatch size={30} delay={80} steady />
            </PopIn>
          </View>
          <PrimaryButton label="Start the conversation" onPress={onMessage} style={{ width: '100%', marginBottom: 10 }} />
          <TextButton label="Keep discovering" onPress={onClose} />
        </PopIn>
      )}
    </View>
  );
}
