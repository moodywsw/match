"""Build a tiny static site (privacy, terms, account deletion; EN + PT) for the Play Store URLs.
Source of truth stays scripts/gen-legal.py. Run: python3 scripts/gen-site.py -> docs/site/
Host for free on GitHub Pages, Cloudflare Pages or Netlify Drop."""
import html, re
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / 'scripts/gen-legal.py').read_text()
# Only evaluate the data dicts, never the file writers.
head = src[:src.index('TERMS = {')]
terms_block = src[src.index('TERMS = {'):]
g = {'Path': Path, '__file__': str(ROOT / 'scripts/gen-legal.py')}
exec(head, g)
# TERMS dict ends at the first line that starts a non-dict statement after it
depth, end = 0, None
for i, ch in enumerate(terms_block):
    if ch == '{': depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0: end = i + 1; break
exec(terms_block[:end], g)
BANNER, PRIVACY, TERMS = g['BANNER'], g['PRIVACY'], g['TERMS']

CSS = """body{margin:0;background:#0E0C0D;color:#F3EEF0;font:16px/1.6 Inter,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 22px 80px}a{color:#FF5573}
h1{font-family:Fraunces,Georgia,serif;font-size:34px;margin:0 0 4px}h2{font-size:19px;margin:30px 0 6px;color:#FF5573}
.meta{color:#A79CA1;font-size:14px}.draft{border:1px solid #FF5573;border-radius:10px;padding:10px 14px;font-size:14px;color:#FFC2CD}
nav{display:flex;gap:16px;flex-wrap:wrap;font-family:'IBM Plex Mono',monospace;font-size:13px;margin-bottom:28px}"""

def page(title, lang, body):
    nav = ('<nav><a href="index.html">MATCH</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a>'
           '<a href="delete-account.html">Delete account</a><a href="privacy-pt.html">Privacidade</a>'
           '<a href="terms-pt.html">Termos</a><a href="delete-account-pt.html">Apagar conta</a></nav>')
    return (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{html.escape(title)} · MATCH</title><style>{CSS}</style></head><body><main>{nav}{body}</main></body></html>')

def para(text):
    lines = text.split('\n')
    if all(l.startswith('•') for l in lines):
        return '<ul>' + ''.join(f'<li>{html.escape(l[1:].strip())}</li>' for l in lines) + '</ul>'
    return ''.join(f'<p>{html.escape(l)}</p>' for l in lines)

def doc(d, lang):
    s = f'<h1>{html.escape(d["title"])}</h1><p class="meta">{html.escape(d["updated"])}</p>'
    for h, t in d['sections']:
        s += f'<h2>{html.escape(h)}</h2>{para(t)}'
    return s

DELETE = {
 'en': ('Delete your MATCH account', [
   ('In the app (instant)', 'Open MATCH, go to Profile → Settings & privacy → Delete account and confirm. Your profile, photos, matches, messages you sent, stories, likes and push tokens are erased immediately from our live systems.'),
   ('Without the app', 'Email emtudoe@gmail.com from the address you signed up with, with the subject "Delete my account". We confirm and delete the account within 30 days, usually much sooner.'),
   ('What we keep', 'Backups are overwritten within 30 days. Purchase records may be kept for up to 10 years where Portuguese tax law requires it. Reports about serious abuse may be kept for up to 12 months to protect other users. Subscriptions are billed by Google or Apple, so cancel them in your store account as well.')]),
 'pt': ('Apagar a tua conta MATCH', [
   ('Na app (imediato)', 'Abre a MATCH, vai a Profile → Settings & privacy → Delete account e confirma. O teu perfil, fotos, matches, mensagens que enviaste, stories, likes e tokens de notificação são apagados de imediato dos nossos sistemas.'),
   ('Sem a app', 'Envia um email para emtudoe@gmail.com a partir do endereço com que te registaste, com o assunto "Apagar a minha conta". Confirmamos e apagamos a conta no prazo de 30 dias, normalmente muito antes.'),
   ('O que guardamos', 'As cópias de segurança são substituídas em 30 dias. Os registos de compras podem ser guardados até 10 anos quando a lei fiscal portuguesa o exige. Denúncias de abuso grave podem ser guardadas até 12 meses para proteger outros utilizadores. As subscrições são cobradas pela Google ou Apple, por isso cancela-as também na tua conta da loja.')]),
}

out = ROOT / 'docs/site'; out.mkdir(parents=True, exist_ok=True)
for lang, sfx in (('en', ''), ('pt', '-pt')):
    (out / f'privacy{sfx}.html').write_text(page(PRIVACY[lang]['title'], lang, doc(PRIVACY[lang], lang)))
    (out / f'terms{sfx}.html').write_text(page(TERMS[lang]['title'], lang, doc(TERMS[lang], lang)))
    t, secs = DELETE[lang]
    body = f'<h1>{html.escape(t)}</h1>' + ''.join(f'<h2>{html.escape(h)}</h2>{para(x)}' for h, x in secs)
    (out / f'delete-account{sfx}.html').write_text(page(t, lang, body))
(out / 'index.html').write_text(page('MATCH', 'en', '<h1>MATCH</h1><p>Dating with a spark. 18+ only.</p><p><a href="privacy.html">Privacy Policy</a> · <a href="terms.html">Terms of Service</a> · <a href="delete-account.html">Delete your account</a></p>'))
print(sorted(p.name for p in out.iterdir()))
