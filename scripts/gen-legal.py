import json
from pathlib import Path

# Source of truth for the legal DRAFTS. Edit here, then run: python3 scripts/gen-legal.py
ROOT = Path(__file__).resolve().parent.parent

BANNER = {
 'en': 'DRAFT — not legal advice. This text must be reviewed by a qualified lawyer (GDPR / Portuguese law) before the app is published. Items in [brackets] must be completed.',
 'pt': 'RASCUNHO — não constitui aconselhamento jurídico. Este texto tem de ser revisto por um advogado qualificado (RGPD / lei portuguesa) antes da publicação da app. Os itens entre [parênteses retos] têm de ser preenchidos.',
}

PRIVACY = {
 'en': {
  'title': 'Privacy Policy',
  'updated': 'Last updated: [date] · Version 0.1 (draft)',
  'sections': [
   ('Who we are', 'MATCH is operated by [Company legal name], NIF [number], registered at [address], Portugal ("we", "us"). We are the data controller for the personal data described here. Contact: [privacy@yourdomain] · Data Protection Officer (if appointed): [name / email].'),
   ('Adults only', 'MATCH is only for people aged 18 or over. We check the age you give us when you sign up and we block accounts under 18. If we learn that a minor is using MATCH, we delete the account.'),
   ('Data we collect', '• Account: email address, password (stored as a hash by our authentication provider), sign-in timestamps.\n• Profile: name, date of birth (we only show your age), gender and who you want to meet, relationship intention, bio, interests, photos, city or approximate location, verification status, your "Friday" answer.\n• Activity: likes, super likes, passes, matches, messages (text, images, voice notes), stories (photos, videos, text, polls, questions) and responses to them, posts, comments, event RSVPs, blocks and reports.\n• Device: push notification token, device type and app version, crash and diagnostic logs.\n• Purchases: subscription tier, status, store, product, renewal dates and transaction identifiers. Payments are processed by Apple or Google; we never receive your card details.'),
   ('Sensitive data', 'Information about who you want to meet may reveal your sexual orientation, which is a special category of data under Article 9 GDPR. We process it only with your explicit consent, which you give by entering it in your profile. You can change or remove it at any time in your profile.'),
   ('Why we use your data (legal bases)', '• To provide the service — create your account, show your profile, suggest people, enable matches and chat (performance of a contract, Art. 6(1)(b)).\n• To keep the community safe — moderation, reports, blocks, fraud and abuse prevention, enforcing 18+ (legitimate interests, Art. 6(1)(f), and legal obligations).\n• To send push notifications you have allowed (consent, Art. 6(1)(a)); you can turn them off in your device settings.\n• To manage subscriptions and comply with tax and accounting rules (contract and legal obligation, Art. 6(1)(b) and (c)).\n• Sensitive data as described above (explicit consent, Art. 9(2)(a)).'),
   ('Who can see your data', 'Other users see your public profile (name, age, photos, bio, interests, intention, approximate distance — never your exact location). Messages are visible only to the people in the conversation. Stories are visible for 24 hours to people allowed by your settings. Blocked users cannot see you.'),
   ('Service providers (processors)', '• Supabase Inc. — database, authentication, file storage and server functions (region: [EU region]).\n• Expo (650 Industries Inc.) — delivery of push notifications.\n• RevenueCat Inc. — subscription management.\n• Apple Inc. / Google LLC — app distribution and payments.\nWe have data processing agreements with these providers. Where data is transferred outside the EEA, we rely on the EU–US Data Privacy Framework and/or Standard Contractual Clauses. [Confirm provider list and regions.]'),
   ('How long we keep data', '• Stories: deleted automatically 24 hours after posting.\n• Account and profile data: until you delete your account.\n• When you delete your account in the app, your profile, photos, matches, messages you sent, stories, likes and push tokens are erased immediately from our live systems; backups are overwritten within [30] days.\n• Purchase records may be retained for up to [10] years where required by Portuguese tax law.\n• Reports about serious abuse may be retained for up to [X] months to protect other users.'),
   ('Your rights', 'You can access, correct, delete, or export your data, object to or restrict certain processing, and withdraw consent at any time (without affecting earlier processing). Delete your account any time in Settings → Delete account. For other requests contact [privacy@yourdomain]; we reply within one month. You may also complain to the Comissão Nacional de Proteção de Dados (CNPD), www.cnpd.pt.'),
   ('Security', 'Data is encrypted in transit (TLS). Access to every table is restricted by row-level security so users can only read what they are allowed to see. Private media is served via short-lived signed links.'),
   ('Changes', 'We will notify you in the app before material changes to this policy take effect.'),
  ],
 },
 'pt': {
  'title': 'Política de Privacidade',
  'updated': 'Última atualização: [data] · Versão 0.1 (rascunho)',
  'sections': [
   ('Quem somos', 'A MATCH é explorada por [Denominação social], NIF [número], com sede em [morada], Portugal ("nós"). Somos o responsável pelo tratamento dos dados pessoais aqui descritos. Contacto: [privacidade@seudominio] · Encarregado de Proteção de Dados (se nomeado): [nome / email].'),
   ('Apenas para adultos', 'A MATCH destina-se exclusivamente a pessoas com 18 ou mais anos. Verificamos a idade indicada no registo e bloqueamos contas de menores de 18 anos. Se soubermos que um menor está a utilizar a MATCH, eliminamos a conta.'),
   ('Dados que recolhemos', '• Conta: endereço de email, palavra-passe (guardada sob a forma de hash pelo nosso fornecedor de autenticação), datas de início de sessão.\n• Perfil: nome, data de nascimento (só mostramos a idade), género e quem pretende conhecer, intenção, biografia, interesses, fotografias, cidade ou localização aproximada, estado de verificação, a sua resposta de "sexta-feira".\n• Atividade: gostos, super gostos, passagens, matches, mensagens (texto, imagens, notas de voz), histórias (fotos, vídeos, texto, sondagens, perguntas) e respostas, publicações, comentários, inscrições em eventos, bloqueios e denúncias.\n• Dispositivo: token de notificações push, tipo de dispositivo e versão da app, registos de erros e diagnóstico.\n• Compras: plano de subscrição, estado, loja, produto, datas de renovação e identificadores de transação. Os pagamentos são processados pela Apple ou pela Google; nunca recebemos os dados do seu cartão.'),
   ('Dados sensíveis', 'A informação sobre quem pretende conhecer pode revelar a sua orientação sexual, que é uma categoria especial de dados nos termos do artigo 9.º do RGPD. Só a tratamos com o seu consentimento explícito, prestado ao introduzi-la no perfil. Pode alterá-la ou removê-la a qualquer momento.'),
   ('Finalidades e fundamentos de licitude', '• Prestar o serviço — criar a conta, mostrar o perfil, sugerir pessoas, permitir matches e conversas (execução de contrato, art. 6.º, n.º 1, al. b)).\n• Manter a comunidade segura — moderação, denúncias, bloqueios, prevenção de fraude e abuso, garantia de 18+ (interesses legítimos, al. f), e obrigações legais).\n• Enviar notificações push que autorizou (consentimento, al. a)); pode desativá-las nas definições do telemóvel.\n• Gerir subscrições e cumprir obrigações fiscais e contabilísticas (contrato e obrigação legal, als. b) e c)).\n• Dados sensíveis conforme acima (consentimento explícito, art. 9.º, n.º 2, al. a)).'),
   ('Quem pode ver os seus dados', 'Outros utilizadores veem o seu perfil público (nome, idade, fotos, biografia, interesses, intenção, distância aproximada — nunca a localização exata). As mensagens só são visíveis para os participantes da conversa. As histórias ficam visíveis durante 24 horas para as pessoas permitidas pelas suas definições. Utilizadores bloqueados não o conseguem ver.'),
   ('Subcontratantes', '• Supabase Inc. — base de dados, autenticação, armazenamento de ficheiros e funções de servidor (região: [região UE]).\n• Expo (650 Industries Inc.) — entrega de notificações push.\n• RevenueCat Inc. — gestão de subscrições.\n• Apple Inc. / Google LLC — distribuição da app e pagamentos.\nCelebrámos acordos de tratamento de dados com estes fornecedores. Quando há transferências para fora do EEE, baseamo-nos no Quadro de Privacidade de Dados UE-EUA e/ou em Cláusulas Contratuais-Tipo. [Confirmar lista de fornecedores e regiões.]'),
   ('Prazos de conservação', '• Histórias: eliminadas automaticamente 24 horas após a publicação.\n• Dados de conta e perfil: até eliminar a conta.\n• Ao eliminar a conta na app, o perfil, fotos, matches, mensagens que enviou, histórias, gostos e tokens push são apagados de imediato dos sistemas em produção; as cópias de segurança são substituídas no prazo de [30] dias.\n• Registos de compras podem ser conservados até [10] anos quando exigido pela lei fiscal portuguesa.\n• Denúncias de abuso grave podem ser conservadas até [X] meses para proteger outros utilizadores.'),
   ('Os seus direitos', 'Tem direito de acesso, retificação, apagamento e portabilidade, de oposição ou limitação de certos tratamentos, e de retirar o consentimento a qualquer momento (sem afetar o tratamento anterior). Pode eliminar a conta em Definições → Eliminar conta. Para outros pedidos contacte [privacidade@seudominio]; respondemos no prazo de um mês. Pode ainda apresentar reclamação à Comissão Nacional de Proteção de Dados (CNPD), www.cnpd.pt.'),
   ('Segurança', 'Os dados são cifrados em trânsito (TLS). O acesso a cada tabela é restringido por segurança ao nível da linha, para que cada utilizador só leia o que lhe é permitido. Os ficheiros privados são servidos através de ligações assinadas de curta duração.'),
   ('Alterações', 'Avisaremos na app antes de alterações relevantes a esta política entrarem em vigor.'),
  ],
 },
}

TERMS = {
 'en': {
  'title': 'Terms of Service',
  'updated': 'Last updated: [date] · Version 0.1 (draft)',
  'sections': [
   ('Agreement', 'These Terms are a contract between you and [Company legal name], NIF [number], [address], Portugal. By creating an account you accept them and our Privacy Policy.'),
   ('Eligibility', 'You must be at least 18 years old, legally able to enter into a contract, and not prohibited from using the service. One personal account per person.'),
   ('Your account', 'Keep your login details secure and give accurate information, including your real age. You are responsible for activity on your account. You can delete your account at any time in Settings → Delete account.'),
   ('Community rules', 'Be respectful. You must not: harass, threaten, or discriminate; post nudity, sexual content involving minors, violence, hate speech or illegal content; impersonate others or use fake photos; spam, advertise or solicit money; share other people\'s private information; or use bots, scrapers or attempt to bypass security. We may remove content, restrict features or suspend accounts that break these rules. Report anyone who makes you feel unsafe.'),
   ('Your content', 'You keep ownership of what you post. You grant us a non-exclusive, worldwide, royalty-free licence to host, display and process it only to operate and improve MATCH, for as long as it remains on the service. You confirm you have the rights to everything you upload.'),
   ('Safety', 'We do not run criminal background checks and cannot guarantee the conduct of other users. Meet in public places, tell a friend where you are going, and never send money to people you have met online.'),
   ('Subscriptions (MATCH+ and SUPER MATCH)', 'Paid plans are billed by Apple App Store or Google Play to your store account. Subscriptions renew automatically at the end of each period at the then-current price unless cancelled at least 24 hours before renewal in your store account settings. Deleting your account does not cancel a subscription. Refunds are handled by Apple or Google under their policies. EU consumers: by starting a subscription you request immediate access to digital content and acknowledge losing the 14-day withdrawal right once access begins, to the extent permitted by law. [Lawyer to confirm.]'),
   ('Free plan limits', 'Free accounts have daily limits (for example, a number of likes and super likes per 24 hours). We may change features and limits with reasonable notice.'),
   ('Termination', 'You may stop using MATCH at any time. We may suspend or terminate accounts that breach these Terms or the law, with notice where appropriate.'),
   ('Liability', 'MATCH is provided "as is". To the extent permitted by law, we are not liable for indirect losses or for the conduct of other users. Nothing in these Terms limits liability that cannot be limited under Portuguese or EU consumer law.'),
   ('Governing law and disputes', 'These Terms are governed by Portuguese law. Consumers may use the courts of their place of residence and alternative dispute resolution entities (see www.consumidor.gov.pt) and the EU ODR platform. [Lawyer to confirm.]'),
   ('Contact', '[support@yourdomain]'),
  ],
 },
 'pt': {
  'title': 'Termos de Serviço',
  'updated': 'Última atualização: [data] · Versão 0.1 (rascunho)',
  'sections': [
   ('Acordo', 'Estes Termos são um contrato entre si e [Denominação social], NIF [número], [morada], Portugal. Ao criar uma conta aceita estes Termos e a nossa Política de Privacidade.'),
   ('Elegibilidade', 'Tem de ter pelo menos 18 anos, capacidade legal para contratar e não estar impedido de utilizar o serviço. Uma conta pessoal por pessoa.'),
   ('A sua conta', 'Mantenha os dados de acesso seguros e forneça informação verdadeira, incluindo a idade real. É responsável pela atividade na sua conta. Pode eliminar a conta a qualquer momento em Definições → Eliminar conta.'),
   ('Regras da comunidade', 'Seja respeitoso. É proibido: assediar, ameaçar ou discriminar; publicar nudez, conteúdo sexual envolvendo menores, violência, discurso de ódio ou conteúdo ilegal; fazer-se passar por outra pessoa ou usar fotos falsas; enviar spam, publicidade ou pedir dinheiro; partilhar informação privada de terceiros; ou usar bots, scrapers ou tentar contornar a segurança. Podemos remover conteúdos, restringir funcionalidades ou suspender contas que violem estas regras. Denuncie quem o faça sentir inseguro.'),
   ('O seu conteúdo', 'Mantém a titularidade do que publica. Concede-nos uma licença não exclusiva, mundial e gratuita para alojar, mostrar e tratar esse conteúdo apenas para operar e melhorar a MATCH, enquanto permanecer no serviço. Confirma que tem os direitos sobre tudo o que carrega.'),
   ('Segurança', 'Não fazemos verificação de registo criminal e não podemos garantir a conduta de outros utilizadores. Encontre-se em locais públicos, avise um amigo de onde vai e nunca envie dinheiro a pessoas que conheceu online.'),
   ('Subscrições (MATCH+ e SUPER MATCH)', 'Os planos pagos são cobrados pela App Store da Apple ou pelo Google Play na sua conta da loja. As subscrições renovam-se automaticamente no fim de cada período ao preço em vigor, salvo se as cancelar pelo menos 24 horas antes da renovação nas definições da sua conta da loja. Eliminar a conta não cancela a subscrição. Os reembolsos são tratados pela Apple ou pela Google segundo as respetivas políticas. Consumidores da UE: ao iniciar a subscrição solicita acesso imediato a conteúdo digital e reconhece a perda do direito de livre resolução de 14 dias a partir do início do acesso, na medida permitida por lei. [A confirmar por advogado.]'),
   ('Limites do plano gratuito', 'As contas gratuitas têm limites diários (por exemplo, um número de gostos e super gostos por 24 horas). Podemos alterar funcionalidades e limites com pré-aviso razoável.'),
   ('Cessação', 'Pode deixar de usar a MATCH a qualquer momento. Podemos suspender ou encerrar contas que violem estes Termos ou a lei, com aviso quando adequado.'),
   ('Responsabilidade', 'A MATCH é fornecida "tal como está". Na medida permitida por lei, não somos responsáveis por danos indiretos nem pela conduta de outros utilizadores. Nada nestes Termos limita a responsabilidade que não possa ser limitada pela lei portuguesa ou europeia de defesa do consumidor.'),
   ('Lei aplicável e litígios', 'Estes Termos regem-se pela lei portuguesa. Os consumidores podem recorrer aos tribunais da sua residência e a entidades de resolução alternativa de litígios (ver www.consumidor.gov.pt) e à plataforma europeia de RLL. [A confirmar por advogado.]'),
   ('Contacto', '[suporte@seudominio]'),
  ],
 },
}

docs = {'privacy': PRIVACY, 'terms': TERMS}
ts = "/* AUTO-GENERATED by scripts/gen-legal.py (also writes docs/legal/*.md) — DRAFT, needs legal review. */\n\n"
ts += "export type LegalLang = 'en' | 'pt';\nexport type LegalDoc = { title: string; updated: string; sections: { heading: string; body: string }[] };\n\n"
ts += "export const LEGAL_DRAFT_BANNER: Record<LegalLang, string> = " + json.dumps(BANNER, ensure_ascii=False, indent=2) + ";\n\n"
for key, d in docs.items():
    obj = {lang: {'title': v['title'], 'updated': v['updated'], 'sections': [{'heading': h, 'body': b} for h, b in v['sections']]} for lang, v in d.items()}
    ts += f"export const {key.upper()}: Record<LegalLang, LegalDoc> = " + json.dumps(obj, ensure_ascii=False, indent=2) + ";\n\n"
(ROOT / 'apps/mobile/lib/legal.ts').write_text(ts)

for key, d in docs.items():
    for lang, v in d.items():
        md = f"> **{BANNER[lang]}**\n\n# MATCH — {v['title']}\n\n_{v['updated']}_\n\n"
        for h, b in v['sections']:
            md += f"## {h}\n\n{b}\n\n"
        (ROOT / f'docs/legal/{key}.{lang}.md').write_text(md)
print('legal generated')
