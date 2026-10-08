/**
 * MATCH design system — ported 1:1 from MatchApp.jsx (MATCH_FULL_PROJECT.md §3).
 */
export const T = {
  ink: '#15121C',
  /** alias kept for older screens */
  bg: '#15121C',
  surface: '#1E1928',
  surface2: '#26202F',
  surface3: '#2E2739',
  border: 'rgba(255,255,255,0.09)',
  rose: '#FF5573',
  roseDim: '#B23B52',
  coral: '#FF7A63',
  amber: '#FFB65C',
  violet: '#8B6BFF',
  mint: '#4DD9C0',
  text: '#F6F2FA',
  muted: '#AA9EC4',
  mutedDim: '#786C93',
  glass: 'rgba(30,25,40,0.72)',
  scrim: 'rgba(10,8,14,0.72)',
  scrimDeep: 'rgba(10,8,14,0.78)',
  chipDark: 'rgba(20,16,26,0.75)',
} as const;

/** Primary CTA gradient: linear-gradient(90deg, rose, #FF7A63) */
export const PRIMARY_GRADIENT = [T.rose, T.coral] as const;
/** Match ring gradient: rose -> amber -> violet */
export const RING_GRADIENT = [T.rose, T.amber, T.violet] as const;

/** Hex colour + alpha suffix helper, e.g. withAlpha(T.rose, '22'). */
export const withAlpha = (hex: string, alpha: string) => `${hex}${alpha}`;

type Weight = 400 | 500 | 600 | 700 | 800;

const FRAUNCES: Record<Weight, string> = {
  400: 'Fraunces_500Medium',
  500: 'Fraunces_500Medium',
  600: 'Fraunces_600SemiBold',
  700: 'Fraunces_700Bold',
  800: 'Fraunces_700Bold',
};
const INTER: Record<Weight, string> = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
  800: 'Inter_800ExtraBold',
};
const MONO: Record<Weight, string> = {
  400: 'IBMPlexMono_400Regular',
  500: 'IBMPlexMono_500Medium',
  600: 'IBMPlexMono_600SemiBold',
  700: 'IBMPlexMono_600SemiBold',
  800: 'IBMPlexMono_600SemiBold',
};

/** Fraunces — display / headlines (never italic). */
export const display = (w: Weight = 500) => ({ fontFamily: FRAUNCES[w] });
/** Inter — UI / body. */
export const body = (w: Weight = 400) => ({ fontFamily: INTER[w] });
/** IBM Plex Mono — percentages, labels. */
export const mono = (w: Weight = 400) => ({ fontFamily: MONO[w] });
