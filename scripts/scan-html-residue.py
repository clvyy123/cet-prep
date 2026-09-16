# -*- coding: utf-8 -*-
"""精确枚举 papers.ts / builtin-banks.ts 中所有 HTML 残留片段（含上下文与 JSON 路径）。"""
import json, re, os, sys, collections

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["src/data/papers.ts", "src/data/builtin-banks.ts"]

# 严格：完整的 <tag ...> 或 </tag>；宽松：孤立的 <tag 或 tag=" 片段
STRICT = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?/?>")
LOOSE  = re.compile(r"<[a-zA-Z/][^<>]{0,200}|(?:^|[\s，。；])[a-zA-Z-]{2,20}=\"[^\"]{0,200}\">?")
ENTITY = re.compile(r"&(?:nbsp|amp|lt|gt|quot|ldquo|rdquo|lsquo|rsquo|hellip|mdash|ndash|middot|emsp|ensp|thinsp|copy|reg|deg|times);|&#\d{2,5};|&#x[0-9a-fA-F]{2,5};")

def load_body(path):
    src = open(path, encoding="utf-8").read()
    i = src.index("= [") + 2
    j = src.rindex("]")
    return json.loads(src[i:j+1])

def walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, node

def main():
    for rel in FILES:
        data = load_body(os.path.join(ROOT, rel))
        hits = []
        for path, s in walk(data):
            for name, pat in (("STRICT", STRICT), ("LOOSE", LOOSE), ("ENTITY", ENTITY)):
                for m in pat.finditer(s):
                    hits.append((name, path, m.group(0), s[max(0,m.start()-80):m.end()+80]))
        print(f"\n================ {rel}  命中 {len(hits)} ================")
        for name, path, frag, ctx in hits:
            print(f"[{name}] {path}")
            print(f"   frag={frag!r}")
            print(f"   ctx ={ctx!r}")
if __name__ == "__main__":
    main()
