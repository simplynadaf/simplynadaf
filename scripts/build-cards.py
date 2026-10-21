#!/usr/bin/env python3
"""Generate cyberpunk project cards as SVG. Each card is half-width (430px)."""
import pathlib, textwrap, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTFACE = pathlib.Path("/tmp/fontface.css").read_text().strip()

CARDS = [
    {
        "slug": "devpub",
        "title": "DEVPUB",
        "lang": "Python", "stars": "5",
        "tag": "CLI · ANALYTICS",
        "desc": ["Write in your editor. Publish to Dev.to.",
                 "Analytics, semantic search, content discovery."],
    },
    {
        "slug": "aws-auditor-agent",
        "title": "AWS-AUDITOR-AGENT",
        "lang": "Shell", "stars": "1",
        "tag": "AGENTIC AI · AWS",
        "desc": ["Read-only AI agent that audits a live AWS",
                 "account for security risks & wasted spend."],
    },
    {
        "slug": "aws-security-posture-agent",
        "title": "AWS-SECURITY-POSTURE",
        "lang": "Python", "stars": "1",
        "tag": "CREWAI · BEDROCK",
        "desc": ["5 specialist agents scan AWS for misconfigs,",
                 "map to CIS benchmarks, score risk, fix."],
    },
    {
        "slug": "aws-oncall-triage-ai-agent",
        "title": "AWS-ONCALL-TRIAGE",
        "lang": "Python", "stars": "0",
        "tag": "STRANDS · INCIDENTS",
        "desc": ["Replaces 20-30 min of 3AM on-call triage.",
                 "CloudWatch + CloudTrail report in 45s."],
    },
]

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" width="430" height="150" viewBox="0 0 430 150" role="img" aria-labelledby="t d">
<title id="t">{title}</title>
<desc id="d">{adesc}</desc>
<style>
{fontface}
text{{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}}
.cy{{fill:#00d9ff}}.fg{{fill:#c9d1d9}}.dim{{fill:#8b949e}}.gr{{fill:#3fb950}}
@keyframes pulse{{0%,100%{{opacity:1}}50%{{opacity:.4}}}}
.dot{{animation:pulse 2.6s ease-in-out infinite}}
@media (prefers-reduced-motion:reduce){{*{{animation:none!important}}}}
</style>
<defs>
<pattern id="grid{slug}" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#00d9ff" stroke-opacity=".05"/></pattern>
<filter id="g{slug}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
</defs>
<rect x="6" y="8" width="418" height="134" rx="6" fill="#03040a" stroke="#00d9ff" stroke-opacity=".45"/>
<rect x="6" y="8" width="418" height="134" rx="6" fill="url(#grid{slug})"/>
<rect x="6" y="8" width="418" height="30" fill="#00d9ff" fill-opacity=".07"/>
<line x1="6" y1="38" x2="424" y2="38" stroke="#00d9ff" stroke-opacity=".35"/>
<text x="22" y="28" class="cy" letter-spacing="1" style="font-size:12px">&gt; {tag}</text>
<circle class="dot" cx="406" cy="23" r="3.2" fill="#3fb950"/>
<circle class="dot" cx="406" cy="23" r="3.2" fill="#3fb950" filter="url(#g{slug})"/>
<text x="22" y="66" class="fg" font-weight="800" style="font-size:18px">{title}</text>
<text x="22" y="92" class="dim" style="font-size:12.5px">{d0}</text>
<text x="22" y="110" class="dim" style="font-size:12.5px">{d1}</text>
<circle cx="26" cy="128" r="4" fill="#00d9ff"/>
<text x="38" y="132" class="dim" style="font-size:12px">{lang}</text>
<text x="150" y="132" class="gr" style="font-size:12px">★ {stars}</text>
<path d="M398 124h10v10" fill="none" stroke="#00d9ff" stroke-width="1.4"/>
</svg>
"""

for c in CARDS:
    adesc = html.escape(" ".join(c["desc"]))
    svg = TEMPLATE.format(
        title=html.escape(c["title"]), adesc=adesc, fontface=FONTFACE,
        slug=c["slug"].replace("-", ""), tag=c["tag"],
        d0=html.escape(c["desc"][0]), d1=html.escape(c["desc"][1]),
        lang=c["lang"], stars=c["stars"],
    )
    out = ROOT / "assets" / f"card-{c['slug']}.svg"
    out.write_text(svg)
    print("wrote", out.name, out.stat().st_size, "bytes")
