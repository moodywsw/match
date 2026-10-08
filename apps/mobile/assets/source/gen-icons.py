"""Regenerate app icons / splash from the LitMatch logo geometry.

Usage (needs google-chrome + Pillow):
  cd /tmp && python3 <repo>/apps/mobile/assets/source/gen-icons.py  # writes *.html
  then screenshot each with headless Chrome (see docs/STORE_CHECKLIST.md) and copy PNGs to assets/images.
"""
OUTER='M12 1C9.2 4.5 7.6 7.7 7.8 10.3C7.95 12.6 9.8 14.2 12 14.2C14.2 14.2 16.05 12.6 16.2 10.3C16.4 7.7 14.8 4.5 12 1Z'
MID='M12 3.4C10.5 5.6 9.6 7.5 9.85 9.4C10 10.8 11 11.7 12 11.7C13 11.7 14 10.8 14.15 9.4C14.4 7.5 13.5 5.6 12 3.4Z'
CORE='M12 7.2C11.3 8.2 11 9 11.05 9.7C11.1 10.5 11.5 11 12 11C12.5 11 12.9 10.5 12.95 9.7C13 9 12.7 8.2 12 7.2Z'
TIP='M8.9 13.6c0-2.1 1.4-3.4 3.1-3.4s3.1 1.3 3.1 3.4c0 1.9-1.3 3.4-3.1 3.4s-3.1-1.5-3.1-3.4z'

def match(glow=True):
    g = '<circle cx="12" cy="9" r="12" fill="url(#glow)"/>' if glow else ''
    return f'''
<defs>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFB65C" stop-opacity="0.55"/><stop offset="55%" stop-color="#FF5573" stop-opacity="0.18"/><stop offset="100%" stop-color="#FF5573" stop-opacity="0"/></radialGradient>
  <linearGradient id="outer" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#C23A3F"/><stop offset="50%" stop-color="#FF5573"/><stop offset="100%" stop-color="#FFB65C"/></linearGradient>
  <linearGradient id="mid" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="#FFB65C"/><stop offset="100%" stop-color="#FFF2CE"/></linearGradient>
  <radialGradient id="core" cx="50%" cy="60%" r="60%"><stop offset="0%" stop-color="#FFFDF5"/><stop offset="100%" stop-color="#FFE9B0"/></radialGradient>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#B99566"/><stop offset="50%" stop-color="#E2C393"/><stop offset="100%" stop-color="#B99566"/></linearGradient>
</defs>
{g}
<rect x="10.7" y="14.5" width="2.6" height="19.5" rx="1.3" fill="url(#wood)"/>
<path d="{TIP}" fill="#2E2119"/>
<path d="{OUTER}" fill="url(#outer)"/>
<path d="{MID}" fill="url(#mid)"/>
<path d="{CORE}" fill="url(#core)"/>
<circle cx="12" cy="12.8" r="0.9" fill="#FF9A4D"/>'''

def silhouette():
    return f'''<rect x="10.7" y="14.5" width="2.6" height="19.5" rx="1.3" fill="#fff"/><path d="{TIP}" fill="#fff"/><path d="{OUTER}" fill="#fff"/>'''

def page(size, inner, scale_h, bg=None, bgglow=False):
    # match box 24x36 scaled so height = scale_h * size, centered (slightly lifted)
    h = scale_h * size
    w = h * 24 / 36
    x = (size - w) / 2
    y = (size - h) / 2
    bgrect = ''
    if bg:
        bgrect = f'<rect width="{size}" height="{size}" fill="{bg}"/>'
        if bgglow:
            bgrect += f'<defs><radialGradient id="bgg" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#3A1F35"/><stop offset="100%" stop-color="{bg}"/></radialGradient></defs><rect width="{size}" height="{size}" fill="url(#bgg)"/>'
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">{bgrect}<svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="0 0 24 36" overflow="visible">{inner}</svg></svg>'''
    return f'<!doctype html><html><head><style>html,body{{margin:0;padding:0;background:transparent;overflow:hidden}}svg{{display:block}}</style></head><body>{svg}</body></html>'

INK = '#15121C'
jobs = {
  'icon': (1024, match(), 0.72, INK, True),
  'android-icon-foreground': (1024, match(), 0.52, None, False),
  'android-icon-background': (1024, '', 0.5, INK, True),
  'android-icon-monochrome': (1024, silhouette(), 0.52, None, False),
  'splash-icon': (1024, match(), 0.8, None, False),
  'notification-icon': (96, silhouette(), 0.8, None, False),
  'favicon': (196, match(), 0.8, INK, True),
}
for name, (size, inner, sh, bg, glow) in jobs.items():
    open(f'{name}.html', 'w').write(page(size, inner, sh, bg, glow))
    print(name, size)
