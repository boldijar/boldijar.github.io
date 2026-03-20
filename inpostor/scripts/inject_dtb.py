#!/usr/bin/env python3
"""Rescrie blocul #inpostor-dtb-json din HTML-uri pornind de la dtb.json (rădăcina proiectului)."""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML_FILES = ["index.html", "cum-functioneaza.html", "setup.html"]
COMMENT = "<!-- Baza de date: același bloc JSON trebuie păstrat în index.html, cum-functioneaza.html și setup.html -->\n"

dtb_str = json.dumps(json.loads(ROOT.joinpath("dtb.json").read_text(encoding="utf-8")), ensure_ascii=False, indent=2)

snippet = (
    COMMENT
    + f'    <script id="inpostor-dtb-json" type="application/json">\n{dtb_str}\n    </script>\n'
    + """    <script>
      window.INPOSTOR_DTB = (function () {
        var el = document.getElementById("inpostor-dtb-json");
        if (!el) return { categories: [], words: [] };
        try {
          return JSON.parse(el.textContent);
        } catch (e) {
          console.error(e);
          return { categories: [], words: [] };
        }
      })();
    </script>
"""
)

block_re = re.compile(
    r"<!-- Baza de date: același bloc JSON.*?-->\s*"
    r'<script id="inpostor-dtb-json" type="application/json">.*?</script>\s*'
    r"<script>\s*window\.INPOSTOR_DTB = \(function.*?</script>\n",
    re.DOTALL,
)

for name in HTML_FILES:
    path = ROOT / name
    text = path.read_text(encoding="utf-8")
    if not block_re.search(text):
        raise SystemExit(f"Nu găsesc blocul INPOSTOR_DTB în {name}")
    path.write_text(block_re.sub(snippet, text, count=1), encoding="utf-8")
    print("updated", name)

print("OK din dtb.json")
