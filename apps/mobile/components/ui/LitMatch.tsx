import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { T } from '@/constants/theme';

/* Geometry is the prototype's 24x36 viewBox, verbatim. */
const OUTER = 'M12 1C9.2 4.5 7.6 7.7 7.8 10.3C7.95 12.6 9.8 14.2 12 14.2C14.2 14.2 16.05 12.6 16.2 10.3C16.4 7.7 14.8 4.5 12 1Z';
const MID = 'M12 3.4C10.5 5.6 9.6 7.5 9.85 9.4C10 10.8 11 11.7 12 11.7C13 11.7 14 10.8 14.15 9.4C14.4 7.5 13.5 5.6 12 3.4Z';
const CORE = 'M12 7.2C11.3 8.2 11 9 11.05 9.7C11.1 10.5 11.5 11 12 11C12.5 11 12.9 10.5 12.95 9.7C13 9 12.7 8.2 12 7.2Z';
const TIP = 'M8.9 13.6c0-2.1 1.4-3.4 3.1-3.4s3.1 1.3 3.1 3.4c0 1.9-1.3 3.4-3.1 3.4s-3.1-1.5-3.1-3.4z';

/** Flame base sits around y≈14 of 36 → transform origin for flicker. */
const FLAME_ORIGIN = '50% 39%';

type Frame = { sy: number; sx: number; r: number };

/** One looping value drives a keyframed flicker (CSS @keyframes port). */
function useLoop(duration: number, delay = 0) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration, delay]);
  return t;
}

function useFlicker(duration: number, frames: [number, Frame][]) {
  const t = useLoop(duration);
  const input = frames.map((f) => f[0]);
  return [
    { scaleY: t.interpolate({ inputRange: input, outputRange: frames.map((f) => f[1].sy) }) },
    { scaleX: t.interpolate({ inputRange: input, outputRange: frames.map((f) => f[1].sx) }) },
    { rotate: t.interpolate({ inputRange: input, outputRange: frames.map((f) => `${f[1].r}deg`) }) },
  ];
}

const id: Frame = { sy: 1, sx: 1, r: 0 };

export type FlameMode = 'subtle' | 'lively';
type LayerKind = 'outer' | 'mid' | 'core';

/* Same three layers/colours as the prototype. "lively" uses non-harmonic
   periods and irregular keyframes so the motion never visibly repeats. */
const LAYERS: Record<FlameMode, Record<LayerKind, { d: number; frames: [number, Frame][] }>> = {
  subtle: {
    outer: { d: 1700, frames: [[0, id], [0.3, { sy: 1.05, sx: 0.95, r: -1.5 }], [0.6, { sy: 0.96, sx: 1.03, r: 1.2 }], [1, id]] },
    mid: { d: 1150, frames: [[0, id], [0.4, { sy: 0.92, sx: 1.06, r: 1.5 }], [0.7, { sy: 1.06, sx: 0.94, r: -1.2 }], [1, id]] },
    core: { d: 850, frames: [[0, id], [0.5, { sy: 1.14, sx: 1.14, r: 0 }], [1, id]] },
  },
  lively: {
    outer: {
      d: 1330,
      frames: [
        [0, id],
        [0.12, { sy: 1.08, sx: 0.94, r: -2.4 }],
        [0.27, { sy: 0.95, sx: 1.04, r: 1.6 }],
        [0.41, { sy: 1.11, sx: 0.92, r: -1 }],
        [0.58, { sy: 0.97, sx: 1.05, r: 2.6 }],
        [0.73, { sy: 1.06, sx: 0.96, r: -1.8 }],
        [0.88, { sy: 0.98, sx: 1.02, r: 0.8 }],
        [1, id],
      ],
    },
    mid: {
      d: 870,
      frames: [
        [0, id],
        [0.18, { sy: 0.9, sx: 1.08, r: 2.2 }],
        [0.37, { sy: 1.1, sx: 0.92, r: -1.6 }],
        [0.55, { sy: 0.95, sx: 1.04, r: 1 }],
        [0.79, { sy: 1.08, sx: 0.94, r: -2.2 }],
        [1, id],
      ],
    },
    core: {
      d: 610,
      frames: [
        [0, id],
        [0.3, { sy: 1.18, sx: 1.1, r: 1 }],
        [0.55, { sy: 0.94, sx: 0.98, r: -1 }],
        [0.8, { sy: 1.1, sx: 1.12, r: 0 }],
        [1, id],
      ],
    },
  },
};

function FlameLayer({ path, kind, mode }: { path: string; kind: LayerKind; mode: FlameMode }) {
  const cfg = LAYERS[mode][kind];
  const transform = useFlicker(cfg.d, cfg.frames);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: FLAME_ORIGIN, transform }]}>
      <Svg width="100%" height="100%" viewBox="0 0 24 36">
        <Defs>
          <LinearGradient id="outer" x1="0%" y1="100%" x2="10%" y2="0%">
            <Stop offset="0%" stopColor="#C23A3F" />
            <Stop offset="45%" stopColor={T.rose} />
            <Stop offset="100%" stopColor={T.amber} />
          </LinearGradient>
          <LinearGradient id="mid" x1="0%" y1="100%" x2="0%" y2="0%">
            <Stop offset="0%" stopColor={T.amber} />
            <Stop offset="100%" stopColor="#FFF2CE" />
          </LinearGradient>
          <RadialGradient id="core" cx="50%" cy="75%" r="55%">
            <Stop offset="0%" stopColor="#FFFDF5" />
            <Stop offset="100%" stopColor="#FFE9B0" stopOpacity={0.35} />
          </RadialGradient>
        </Defs>
        <Path d={path} fill={`url(#${kind})`} />
      </Svg>
    </Animated.View>
  );
}

/* A small tongue of flame that licks up off the tip and fades (viewBox units). */
const TONGUE = 'M12 0C11.35 1.2 11.05 2.1 11.2 2.9C11.3 3.5 11.65 3.8 12 3.8C12.35 3.8 12.7 3.5 12.8 2.9C12.95 2.1 12.65 1.2 12 0Z';

function Tongue({ h, dx, duration, delay }: { h: number; dx: number; duration: number; delay: number }) {
  const t = useLoop(duration, delay);
  const u = h / 36; // px per viewBox unit
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: t.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0, 0.95, 0.5, 0] }),
          transformOrigin: '50% 8%',
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [dx * u, dx * u * 1.6] }) },
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [2.4 * u, -2.2 * u] }) },
            { scaleY: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.5, 1.15, 0.35] }) },
            { scaleX: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.8, 1, 0.45] }) },
          ],
        },
      ]}>
      <Svg width="100%" height="100%" viewBox="0 0 24 36">
        <Defs>
          <LinearGradient id="tongue" x1="0%" y1="100%" x2="0%" y2="0%">
            <Stop offset="0%" stopColor={T.amber} />
            <Stop offset="100%" stopColor={T.rose} stopOpacity={0.6} />
          </LinearGradient>
        </Defs>
        <Path d={TONGUE} fill="url(#tongue)" />
      </Svg>
    </Animated.View>
  );
}

/* Ember particles drifting up from the flame (positions in viewBox units). */
const EMBERS: { x: number; drift: number; rise: number; d: number; delay: number; r: number }[] = [
  { x: 11.4, drift: -2.2, rise: 12, d: 1900, delay: 0, r: 0.42 },
  { x: 12.8, drift: 2.6, rise: 14, d: 2300, delay: 650, r: 0.36 },
  { x: 12.1, drift: -0.8, rise: 16, d: 2700, delay: 1300, r: 0.3 },
  { x: 11.0, drift: 1.6, rise: 11, d: 2100, delay: 1900, r: 0.38 },
  { x: 13.1, drift: -1.8, rise: 13, d: 2500, delay: 2500, r: 0.32 },
];

function Ember({ w, h, e }: { w: number; h: number; e: (typeof EMBERS)[number] }) {
  const t = useLoop(e.d, e.delay);
  const u = h / 36;
  const size = Math.max(1.5, e.r * 2 * u);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (w / 24) * e.x - size / 2,
        top: 6 * u,
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: '#FFC56B',
        shadowColor: T.amber,
        shadowOpacity: 0.9,
        shadowRadius: size,
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 0.6, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -e.rise * u] }) },
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, e.drift * u * 0.4, e.drift * u] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) },
        ],
      }}
    />
  );
}

/** Warm halo behind the flame that breathes irregularly. */
function GlowPulse() {
  const t = useLoop(2600);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          transformOrigin: '50% 25%',
          opacity: t.interpolate({ inputRange: [0, 0.2, 0.45, 0.6, 0.85, 1], outputRange: [0.45, 0.8, 0.55, 0.85, 0.5, 0.45] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 0.2, 0.45, 0.6, 0.85, 1], outputRange: [1, 1.12, 1.02, 1.16, 1.04, 1] }) }],
        },
      ]}>
      <Svg width="100%" height="100%" viewBox="0 0 24 36">
        <Defs>
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={T.amber} stopOpacity={0.55} />
            <Stop offset="55%" stopColor={T.rose} stopOpacity={0.18} />
            <Stop offset="100%" stopColor={T.rose} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="12" cy="8.5" r="11" fill="url(#halo)" />
      </Svg>
    </Animated.View>
  );
}

/**
 * 3-layer flickering flame (outer rose→amber, mid amber→cream, white core).
 * `subtle` (logo): the prototype flicker plus a slow, gentle sway.
 * `lively` (MATCH moment): irregular flicker, sway from the base, licking
 * tongues, rising embers and a breathing glow. Needs `size` (width in px).
 */
export function Flame({ mode = 'subtle', size }: { mode?: FlameMode; size?: number }) {
  const lively = mode === 'lively';
  const sway = useLoop(lively ? 2300 : 3100);
  const transform = useFlicker(
    lively ? 1450 : 1600,
    lively
      ? [
          [0, id],
          [0.17, { sy: 1.07, sx: 0.95, r: -2.6 }],
          [0.36, { sy: 0.96, sx: 1.04, r: 1.8 }],
          [0.52, { sy: 1.05, sx: 0.97, r: -1.2 }],
          [0.7, { sy: 0.97, sx: 1.03, r: 2.4 }],
          [0.86, { sy: 1.04, sx: 0.98, r: -0.8 }],
          [1, id],
        ]
      : [
          [0, id],
          [0.25, { sy: 1.06, sx: 0.96, r: -2 }],
          [0.5, { sy: 0.96, sx: 1.04, r: 1.5 }],
          [0.75, { sy: 1.03, sx: 0.98, r: -1 }],
          [1, id],
        ]
  );
  const swayDeg = lively ? 3.2 : 1.2;
  const w = size ?? 0;
  const h = w * 1.5;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          // sway pivots at the flame's base, like a draught moving it
          transformOrigin: '50% 40%',
          transform: [
            {
              rotate: sway.interpolate({
                inputRange: [0, 0.25, 0.5, 0.75, 1],
                outputRange: ['0deg', `${swayDeg}deg`, '0deg', `${-swayDeg * 0.8}deg`, '0deg'],
              }),
            },
          ],
        },
      ]}>
      {lively ? <GlowPulse /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: FLAME_ORIGIN, transform }]}>
        <FlameLayer path={OUTER} kind="outer" mode={mode} />
        {lively && w > 0 ? (
          <>
            <Tongue h={h} dx={-0.5} duration={1100} delay={0} />
            <Tongue h={h} dx={0.6} duration={1350} delay={520} />
          </>
        ) : null}
        <FlameLayer path={MID} kind="mid" mode={mode} />
        <FlameLayer path={CORE} kind="core" mode={mode} />
      </Animated.View>
      {lively && w > 0 ? EMBERS.map((e, i) => <Ember key={i} w={w} h={h} e={e} />) : null}
    </Animated.View>
  );
}

function Stick({ lit = true, glow = true, glowOpacity = 0.5 }: { lit?: boolean; glow?: boolean; glowOpacity?: number }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 24 36" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="wood" x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#B99566" />
          <Stop offset="50%" stopColor="#E2C393" />
          <Stop offset="100%" stopColor="#B99566" />
        </LinearGradient>
        <RadialGradient id="glow" cx="50%" cy="48%" r="50%">
          <Stop offset="0%" stopColor={T.amber} stopOpacity={glowOpacity} />
          <Stop offset="100%" stopColor={T.amber} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {glow && lit ? <Circle cx="12" cy="9" r="12" fill="url(#glow)" /> : null}
      <Rect x="10.7" y="14.5" width="2.6" height="19.5" rx="1.3" fill="url(#wood)" />
      <Path d={TIP} fill={lit ? '#2E2119' : '#B4453B'} />
      {lit ? <Circle cx="12" cy="12.8" r="0.9" fill="#FF9A4D" opacity={0.85} /> : null}
    </Svg>
  );
}

/** The MATCH logo mark: a lit matchstick with a flickering flame. */
export function LitMatch({ size = 30 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size * 1.5 }}>
      <Stick />
      <Flame mode="subtle" size={size} />
    </View>
  );
}

const SPARKS: [number, number][] = [[-14, -10], [12, -14], [-6, -18], [16, -4]];

function Spark({ sx, sy }: { sx: number; sy: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: '52%',
        top: '26%',
        width: 3,
        height: 3,
        borderRadius: 2,
        backgroundColor: T.amber,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [
          { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, sx] }) },
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, sy] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
        ],
      }}
    />
  );
}

/**
 * A match that strikes against an invisible surface, then ignites with a pop
 * and sparks. `steady` skips the strike (small already-lit badge).
 */
export function IgnitingMatch({
  size = 40,
  delay = 400,
  onIgnite,
  steady = false,
  lively = !steady && size >= 60,
}: {
  size?: number;
  delay?: number;
  onIgnite?: () => void;
  steady?: boolean;
  /** Livelier flame (sway, licking tips, embers, glow). Defaults on for the big strike. */
  lively?: boolean;
}) {
  const [lit, setLit] = useState(false);
  const strike = useRef(new Animated.Value(steady ? 1 : 0)).current;
  const ignite = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      setLit(true);
      onIgnite?.();
      Animated.timing(ignite, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    }, delay);
    if (!steady) {
      Animated.timing(strike, { toValue: 1, duration: 550, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const w = size;
  const h = size * 1.5;

  return (
    <View style={{ width: w, height: h }}>
      <Animated.View
        style={{
          width: w,
          height: h,
          transformOrigin: '50% 92%',
          transform: [
            { rotate: strike.interpolate({ inputRange: [0, 0.35, 0.55, 0.75, 1], outputRange: ['-22deg', '14deg', '-8deg', '4deg', '0deg'] }) },
            { translateY: strike.interpolate({ inputRange: [0, 0.35, 0.55, 1], outputRange: [3, -3, 0, 0] }) },
          ],
        }}>
        {lit ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] }),
                transformOrigin: '50% 25%',
                transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
              },
            ]}>
            <Svg width="100%" height="100%" viewBox="0 0 24 36">
              <Defs>
                <RadialGradient id="g" cx="50%" cy="48%" r="50%">
                  <Stop offset="0%" stopColor={T.amber} stopOpacity={0.6} />
                  <Stop offset="100%" stopColor={T.amber} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx="12" cy="9" r="12" fill="url(#g)" />
            </Svg>
          </Animated.View>
        ) : null}
        <Stick lit={lit} glow={false} />
        {lit ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: ignite.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
                transformOrigin: '50% 36%',
                transform: [{ scale: ignite.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.15, 1.25, 1] }) }],
              },
            ]}>
            <Flame mode={lively ? 'lively' : 'subtle'} size={size} />
          </Animated.View>
        ) : null}
      </Animated.View>
      {lit ? SPARKS.map(([sx, sy], i) => <Spark key={i} sx={sx} sy={sy} />) : null}
    </View>
  );
}
