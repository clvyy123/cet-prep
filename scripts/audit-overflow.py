# -*- coding: utf-8 -*-
"""分析 analysis 字段末尾越界段（翻译/概览内容被吞进阅读题解析）与目标字段的重复关系。"""
import json, re, sys, os

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "src/data/papers.ts"), encoding="utf-8").read()
i = src.index("= [") + 2
j = src.rindex("]")
d = json.loads(src[i:j + 1])

NAV = re.compile(r"Part\s*(?:I{1,3}V?|IV)\s*>\s*(?:Translation\s*\d*\s*)?|\bSection\s*[ABC]\s*·\s*[A-Za-z]+\s*·?\s*")
norm = lambda s: re.sub(r"\s+", "", s or "")

def blocks_of(p, name):
    out = []
    for s in p["sections"]:
        if s["partName"] == name:
            out += s["blocks"]
    return out

print(f"{'卷':<18} {'越界段':<8} {'类型':<6} {'目标字段':<28} {'覆盖':<8} 结论")
print("-" * 110)
for pi, p in enumerate(d):
    trans = blocks_of(p, "翻译")
    tpool = norm(" ".join(
        " ".join(b.get("terms", []) or []) + " " + (b.get("reference") or "") + " " + (b.get("notes") or "")
        for b in trans))
    for si, s in enumerate(p["sections"]):
        for bi, b in enumerate(s["blocks"]):
            for q in b.get("questions", []):
                a = q.get("analysis", "")
                m = NAV.search(a)
                if not m or len(a) - m.start() <= 60:
                    continue
                tail = a[m.start():]
                nt = norm(tail)
                # 用 tail 里最长的 3 段 40 字探针，看目标字段是否已覆盖
                probes = [nt[k:k + 40] for k in range(0, max(1, len(nt) - 40), 40)][:6]
                hit = sum(1 for pr in probes if pr and pr in tpool)
                kind = "翻译" if re.search(r"难词译注|参考译文|Translation", tail) else ("概览" if "概览" in tail[:30] else "其他")
                tgt = "翻译block.terms+reference" if kind == "翻译" else "block.analysisOverview"
                print(f"{p['id']:<18} sec{si}blk{bi}q{q.get('num'):<4} {kind:<6} {tgt:<28} {hit}/{len(probes):<6} "
                      f"{'可安全删除' if hit == len(probes) and hit else '需迁移/人工'}")
                if hit != len(probes):
                    print(f"      tail: {tail[:150]}")
                    print(f"      目标: {(tpool[:150]) if tpool else '(空)'}")
