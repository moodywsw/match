/**
 * Paywall copy (pt-PT / EN) — single source for the plan feature lists and the
 * Free vs MATCH+ vs SUPER MATCH comparison. Server enforcement lives in
 * supabase/migrations/20261008_premium_perks.sql; keep this list in sync with
 * docs/STORE_CHECKLIST.md (store descriptions).
 */
import type { EntitlementId } from './iap';

export type PaywallLang = 'pt' | 'en';
export type PlanKey = 'free' | EntitlementId;

export function defaultPaywallLang(): PaywallLang {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || '';
    return loc.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  } catch {
    return 'en';
  }
}

export const PLAN_FEATURES: Record<PaywallLang, Record<PlanKey, string[]>> = {
  en: {
    free: ['25 likes every 24h', '1 super like every 24h', 'Basic filters (distance & age)'],
    match_plus: [
      'Unlimited likes',
      'See who liked you',
      'Advanced filters: verified only, intention, exact age & distance',
      "5 super likes a day — they're notified instantly and see you highlighted",
      'Undo your last swipe (Rewind)',
      'Full “why you match” — all 7 dimensions',
      '1 Boost a month — 30 min at the top of Discover',
    ],
    super_match: [
      'Everything in MATCH+',
      'Incognito: only people you like can see you',
      'Unlimited super likes',
      'See who viewed your profile',
      'Message priority: your first message is pinned at the top of their inbox',
    ],
  },
  pt: {
    free: ['25 likes a cada 24h', '1 super like a cada 24h', 'Filtros básicos (distância e idade)'],
    match_plus: [
      'Likes ilimitados',
      'Vê quem gostou de ti',
      'Filtros avançados: só verificados, intenção, idade e distância exatas',
      '5 super likes por dia — a pessoa é notificada na hora e vê-te em destaque',
      'Desfaz o último swipe (Rewind)',
      '“Porque combinam” completo — as 7 dimensões',
      '1 Boost por mês — 30 min no topo do Descobrir',
    ],
    super_match: [
      'Tudo do MATCH+',
      'Incógnito: só quem tu gostas te pode ver',
      'Super likes ilimitados',
      'Vê quem visitou o teu perfil',
      'Prioridade nas mensagens: a tua primeira mensagem fica fixada no topo da caixa da outra pessoa',
    ],
  },
};

/** [label, free, MATCH+, SUPER MATCH] — '✓' / '—' render as icons. */
export const COMPARISON: Record<PaywallLang, [string, string, string, string][]> = {
  en: [
    ['Likes', '25/24h', '∞', '∞'],
    ['Super likes', '1/24h', '5/day', '∞'],
    ['Filters', 'Basic', 'Advanced', 'Advanced'],
    ['See who liked you', '—', '✓', '✓'],
    ['Rewind', '—', '✓', '✓'],
    ['Why you match', 'Teaser', '7 dims', '7 dims'],
    ['Boost (30 min)', '—', '1/month', '1/month'],
    ['Incognito', '—', '—', '✓'],
    ['Who viewed you', '—', '—', '✓'],
    ['Message priority', '—', '—', '✓'],
  ],
  pt: [
    ['Likes', '25/24h', '∞', '∞'],
    ['Super likes', '1/24h', '5/dia', '∞'],
    ['Filtros', 'Básicos', 'Avançados', 'Avançados'],
    ['Quem gostou de ti', '—', '✓', '✓'],
    ['Rewind', '—', '✓', '✓'],
    ['Porque combinam', 'Resumo', '7 dim.', '7 dim.'],
    ['Boost (30 min)', '—', '1/mês', '1/mês'],
    ['Incógnito', '—', '—', '✓'],
    ['Quem te visitou', '—', '—', '✓'],
    ['Prioridade nas mensagens', '—', '—', '✓'],
  ],
};

export const PAYWALL_COPY: Record<PaywallLang, {
  title: string;
  subtitle: string;
  compare: string;
  current: string;
  youHave: (n: string) => string;
  continueWith: (n: string) => string;
  restore: string;
  restoring: string;
  later: string;
  preview: string;
  renew: string;
  terms: string;
  privacy: string;
  free: string;
}> = {
  en: {
    title: 'Go further with MATCH+',
    subtitle: 'Cancel anytime. Your free experience stays fully usable.',
    compare: 'Compare plans',
    current: 'Current plan',
    youHave: (n) => `You have ${n}`,
    continueWith: (n) => `Continue with ${n}`,
    restore: 'Restore purchases',
    restoring: 'Restoring…',
    later: 'Maybe later',
    preview: 'Expo Go preview — purchases are simulated, no money is charged.',
    renew: 'Subscriptions renew monthly until cancelled in your App Store / Google Play settings.',
    terms: 'Terms',
    privacy: 'Privacy',
    free: 'Free',
  },
  pt: {
    title: 'Vai mais longe com o MATCH+',
    subtitle: 'Cancela quando quiseres. A versão gratuita continua totalmente utilizável.',
    compare: 'Comparar planos',
    current: 'Plano atual',
    youHave: (n) => `Já tens ${n}`,
    continueWith: (n) => `Continuar com ${n}`,
    restore: 'Restaurar compras',
    restoring: 'A restaurar…',
    later: 'Agora não',
    preview: 'Pré-visualização Expo Go — as compras são simuladas, não é cobrado dinheiro.',
    renew: 'As subscrições renovam mensalmente até as cancelares nas definições da App Store / Google Play.',
    terms: 'Termos',
    privacy: 'Privacidade',
    free: 'Grátis',
  },
};
