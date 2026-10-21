#!/usr/bin/env python3
"""Generate extra link chips (YouTube, Email, AWS Builder Center, X) in the cyberpunk style."""
import pathlib, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
FF = (ROOT / "scripts" / "fontface.css").read_text().strip()

def chip(slug, title, label, sub, icon_svg):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="260" height="64" viewBox="0 0 260 64" role="img" aria-labelledby="t">
<title id="t">{html.escape(title)}</title>
<style>
{FF}
text{{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}}</style>
<rect x="4" y="6" width="252" height="52" rx="6" fill="#03040a" stroke="#00d9ff" stroke-opacity=".55"/>
<rect x="4" y="6" width="252" height="52" rx="6" fill="#00d9ff" fill-opacity=".05"/>
{icon_svg}
<text x="64" y="28" fill="#f0fbff" font-weight="700" style="font-size:15px">{html.escape(label)}</text>
<text x="64" y="46" fill="#8b949e" style="font-size:12px">{html.escape(sub)}</text>
<path d="M232 20h8v8" fill="none" stroke="#00d9ff" stroke-width="1.5"/>
</svg>
'''

# YouTube: rounded-rect + play triangle
youtube_icon = '''<g transform="translate(22,22)">
<rect width="30" height="21" rx="5" fill="#00d9ff" fill-opacity=".15" stroke="#00d9ff" stroke-width="1.3"/>
<path d="M12 6 L21 10.5 L12 15 Z" fill="#00d9ff"/>
</g>'''

# Email: envelope
email_icon = '''<g transform="translate(24,22)" fill="none" stroke="#00d9ff" stroke-width="2">
<rect x="0" y="2" width="26" height="20" rx="3"/>
<path d="M1 4 L13 13 L25 4"/>
</g>'''

# AWS Builder Center: "aws" smile-ish mark (simplified)
aws_icon = '''<g transform="translate(22,24)">
<text x="0" y="12" fill="#00d9ff" font-weight="800" font-family="'JBM',monospace" style="font-size:16px">aws</text>
<path d="M0 18 q16 7 32 0" fill="none" stroke="#f0b429" stroke-width="2" stroke-linecap="round"/>
</g>'''

# X (Twitter): the X glyph
x_icon = '''<g transform="translate(24,21)">
<rect width="24" height="24" rx="5" fill="#00d9ff" fill-opacity=".12" stroke="#00d9ff" stroke-opacity=".5"/>
<path d="M6 6 L18 18 M18 6 L6 18" stroke="#f0fbff" stroke-width="2.2" stroke-linecap="round"/>
</g>'''

chips = {
    "youtube": ("YouTube", "YOUTUBE", "@sarvar-nadaf", youtube_icon),
    "email":   ("Email", "EMAIL", "simplynadaf@gmail.com", email_icon),
    "awsbuilder": ("AWS Builder Center", "AWS BUILDER", "community/@sarvar", aws_icon),
    "x":       ("X (Twitter)", "X", "@SarvarN_04", x_icon),
}

for slug, (title, label, sub, icon) in chips.items():
    out = ROOT / "assets" / "links" / f"{slug}.svg"
    out.write_text(chip(slug, title, label, sub, icon))
    print("wrote", out.name, out.stat().st_size, "bytes")
