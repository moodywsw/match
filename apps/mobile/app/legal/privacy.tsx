import { LegalScreen } from '@/components/app/LegalScreen';
import { PRIVACY } from '@/lib/legal';

export default function PrivacyScreen() {
  return <LegalScreen docs={PRIVACY} />;
}
