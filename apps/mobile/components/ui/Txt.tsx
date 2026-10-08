import { Text, type TextProps, type TextStyle } from 'react-native';

import { T, body, display, mono } from '@/constants/theme';

type Variant = 'body' | 'display' | 'mono';
type Weight = 400 | 500 | 600 | 700 | 800;

export type TxtProps = TextProps & {
  v?: Variant;
  w?: Weight;
  size?: number;
  color?: string;
  center?: boolean;
  lh?: number;
};

/** Text with the MATCH font stack baked in (Inter by default). */
export function Txt({ v = 'body', w = 400, size = 14, color = T.text, center, lh, style, ...rest }: TxtProps) {
  const fam = v === 'display' ? display(w) : v === 'mono' ? mono(w) : body(w);
  const base: TextStyle = {
    ...fam,
    fontSize: size,
    color,
    ...(center ? { textAlign: 'center' } : null),
    ...(lh ? { lineHeight: size * lh } : null),
  };
  return <Text {...rest} style={[base, style]} />;
}
