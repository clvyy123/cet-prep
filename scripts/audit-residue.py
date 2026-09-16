# -*- coding: utf-8 -*-
"""审计 papers.ts / builtin-banks.ts 中「非正文残渣」：标签、实体、导航残片、控制符、重复段。"""
import json, re, os, sys, collections

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = [
    ("HTML标签", re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?/?>|<[a-zA-Z/][^<>]*$")),
    ("HTML实体", re.compile(r"&(?:[a-zA-Z]{2,10}|#\d{2,5}|#x[0-9a-fA-F]{2,5});")),
    ("导航残片", re.compile(r"Part\s*(?:I{1,3}V?|IV|Ⅳ|Ⅲ|Ⅱ|Ⅰ)\s*>|\bSection\s*[ABC]\s*·|·\s*(?:概览|难词译注|参考译文|结构框图)\s*·?")),
    ("零宽/控制符", re.compile(r"[\u200b\u200c\u200d\ufeff\u00a0\u2007\u202f\x00-\x08\x0b\x0c\x0e-\x1f]")),
    ("连写(缺空格)", re.compile(r"[a-z]{2,}[A-Z][a-z]{2,}")),
    ("孤立标记行", re.compile(r"^\s*(?:Part|Section)\s*[IVXABC]{0,4}\s*>?\s*$", re.M)),
    ("重复短句", re.compile(r"([\u4e00-\u9fa5A-Za-z]{6,30}[。.!?])\s*\1")),
]

def load(rel):
    src = open(os.path.join(ROOT, rel), encoding="utf-8").read()
    i = src.index("= [") + 2
    j = src.rindex("]")
    return json.loads(src[i:j+1])

def walk(n, p=""):
    if isinstance(n, dict):
        for k, v in n.items(): yield from walk(v, f"{p}.{k}")
    elif isinstance(n, list):
        for i, v in enumerate(n): yield from walk(v, f"{p}[{i}]")
    elif isinstance(n, str):
        yield p, n

def short(p):
    return re.sub(r"\[\d+\]", "[]", p)

for rel in ("src/data/papers.ts", "src/data/builtin-banks.ts"):
    data = load(rel)
    per = collections.defaultdict(list)
    for path, s in walk(data):
        for name, pat in PATTERNS:
            for m in pat.finditer(s):
                per[name].append((short(path), m.group(0)[:70], s[max(0,m.start()-45):m.end()+45].replace("\n"," ")))
    print(f"\n{'='*70}\n{rel}")
    for name, _ in PATTERNS:
        items = per[name]
        if not items:
            print(f"\n-- {name}: 0")
            continue
        keys = collections.Counter(k for k, _, _ in items)
        print(f"\n-- {name}: {len(items)} 处 / {len(keys)} 个字段")
        for k, n in keys.most_common(12):
            ex = next(x for x in items if x[0] == k)
            print(f"     {n:>3}x {k}\n         {ex[1]!r}  ...{ex[2][-100:]}...")
