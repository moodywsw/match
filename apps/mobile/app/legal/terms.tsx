import { LegalScreen } from '@/components/app/LegalScreen';
import { TERMS } from '@/lib/legal';

export default function TermsScreen() {
  return <LegalScreen docs={TERMS} />;
}
