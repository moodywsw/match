import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconBtn } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { T } from '@/constants/theme';
import { LEGAL_DRAFT_BANNER, type LegalDoc, type LegalLang } from '@/lib/legal';

export function LegalScreen({ docs }: { docs: Record<LegalLang, LegalDoc> }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [lang, setLang] = useState<LegalLang>('pt');
  const doc = docs[lang];

  return (
    <View style={{ flex: 1, backgroundColor: T.ink, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
        <IconBtn onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <X size={16} color={T.text} />
        </IconBtn>
        <Txt v="display" size={18} style={{ flex: 1 }}>
          {doc.title}
        </Txt>
        <View style={{ flexDirection: 'row', backgroundColor: T.surface2, borderRadius: 999, padding: 3 }}>
          {(['pt', 'en'] as LegalLang[]).map((l) => (
            <Pressable key={l} onPress={() => setLang(l)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: lang === l ? T.rose : 'transparent' }}>
              <Txt w={700} size={11} color={lang === l ? '#fff' : T.muted}>
                {l.toUpperCase()}
              </Txt>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <View style={{ backgroundColor: `${T.amber}22`, borderColor: `${T.amber}66`, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 18 }}>
          <Txt w={700} size={11} color={T.amber} style={{ marginBottom: 4 }}>
            DRAFT / RASCUNHO
          </Txt>
          <Txt size={12} color={T.text} style={{ lineHeight: 17 }}>
            {LEGAL_DRAFT_BANNER[lang]}
          </Txt>
        </View>
        <Txt size={11.5} color={T.mutedDim} style={{ marginBottom: 18 }}>
          {doc.updated}
        </Txt>
        {doc.sections.map((s) => (
          <View key={s.heading} style={{ marginBottom: 20 }}>
            <Txt w={700} size={15} style={{ marginBottom: 8 }}>
              {s.heading}
            </Txt>
            <Txt size={13.5} color={T.muted} style={{ lineHeight: 20 }}>
              {s.body}
            </Txt>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
