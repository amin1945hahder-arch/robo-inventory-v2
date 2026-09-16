import re

src = open("public/kiri/lib/main/kiri.js", encoding="utf-8", errors="replace").read()
print("size", len(src))
for pat in [
    r"new Worker\([^)]*\)",
    r"importScripts\([^)]*\)",
    r"[\"'][^\"']*worker[^\"']*[\"']",
    r"[\"'][^\"']*kiri-main[^\"']*[\"']",
]:
    hits = re.findall(pat, src)
    print(pat, "->", list(dict.fromkeys(hits))[:6])
