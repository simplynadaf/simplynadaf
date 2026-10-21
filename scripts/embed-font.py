#!/usr/bin/env python3
"""Inject embedded JBM font-face into all profile SVGs and switch font-family to JBM."""
import re, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONTFACE = pathlib.Path("/tmp/fontface.css").read_text()

OLD_STACK = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"
NEW_STACK = "'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

svgs = list((ROOT / "assets").rglob("*.svg"))
for p in svgs:
    s = p.read_text()
    # switch font stack
    s = s.replace(OLD_STACK, NEW_STACK)
    # inject font-face once, right after the opening <style>
    if "font-family:\"JBM\"" not in s and "<style>" in s:
        s = s.replace("<style>", "<style>\n" + FONTFACE, 1)
    p.write_text(s)
    print("patched", p.relative_to(ROOT))
print("done:", len(svgs), "files")
