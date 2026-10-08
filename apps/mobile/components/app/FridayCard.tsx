import { Pencil } from 'lucide-react-native';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';

/** "Perfect Friday night?" onboarding answer (violet, as in the onboarding step). */
export function FridayCard({
  answer,
  name,
  onEdit,
  style,
}: {
  answer: string | null | undefined;
  /** other person's first name; omit for my own profile */
  name?: string;
  onEdit?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!answer && !onEdit) return null;
  return (
    <Pressable
      disabled={!onEdit}
      onPress={onEdit}
      style={[
        {
          padding: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderStyle: answer ? 'solid' : 'dashed',
          borderColor: answer ? `${T.violet}66` : 'rgba(255,255,255,0.16)',
          backgroundColor: answer ? `${T.violet}1A` : 'transparent',
        },
        style,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt v="mono" size={10.5} color={T.violet} style={{ letterSpacing: 1 }}>
          🌙 {name ? `${name.toUpperCase()}'S PERFECT FRIDAY` : 'MY PERFECT FRIDAY NIGHT'}
        </Txt>
        {onEdit ? <Pencil size={12} color={T.muted} /> : null}
      </View>
      <Txt w={answer ? 600 : 400} size={14} color={answer ? T.text : T.muted} style={{ marginTop: 6 }}>
        {answer || 'Tell people your perfect Friday night — it’s a great icebreaker'}
      </Txt>
    </Pressable>
  );
}
