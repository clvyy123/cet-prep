# 批量 PaddleOCR-VL 云 OCR：对 scripts/needs-ocr.json 列出的全部扫描版试卷
# 重新 OCR，输出写入各套题目录的 test-ocr.txt（格式与 mineru 版一致：===== PAGE N ===== 分页）
# 用法：python scripts/batch-ocr-paddle.py
import json
import os
import re
import sys
import time

import requests

JOB_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
TOKEN = "505a5ee60741e66f8ca73f8248d566716d896068"
MODEL = "PaddleOCR-VL-1.6"

ROOT = os.path.dirname(os.path.abspath(__file__))
DOWNLOAD_DIR = os.path.join(ROOT, ".download")
NEEDS_OCR = os.path.join(ROOT, "needs-ocr.json")

headers = {
    "Authorization": f"bearer {TOKEN}",
}

optional_payload = {
    "useDocOrientationClassify": False,
    "useDocUnwarping": False,
    "useChartRecognition": False,
}

PAGE_RE = re.compile(r"=====\s*PAGE\s*\d+\s*=====")
IMG_MD_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")  # markdown 图片引用
HTML_RE = re.compile(r"<[^>]+>")                  # 残留 HTML 标签


def submit_job(file_path):
    data = {
        "model": MODEL,
        "optionalPayload": json.dumps(optional_payload),
    }
    with open(file_path, "rb") as f:
        files = {"file": f}
        resp = requests.post(JOB_URL, headers=headers, data=data, files=files, timeout=120)
    resp.raise_for_status()
    return resp.json()["data"]["jobId"]


def poll_job(job_id, poll_interval=5, timeout_s=1800):
    """轮询任务直到 done / failed，返回结果 JSON。"""
    start = time.time()
    while True:
        resp = requests.get(f"{JOB_URL}/{job_id}", headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()["data"]
        state = data.get("state")
        if state == "pending":
            pass
        elif state == "running":
            prog = data.get("extractProgress") or {}
            total = prog.get("totalPages")
            done_p = prog.get("extractedPages")
            if total is not None and done_p is not None:
                print(f"  [running] {done_p}/{total} 页")
            else:
                print("  [running] ...")
        elif state == "done":
            jsonl_url = (data.get("resultUrl") or {}).get("jsonUrl")
            if not jsonl_url:
                raise RuntimeError("job done 但缺少 jsonUrl")
            return jsonl_url
        elif state == "failed":
            raise RuntimeError(data.get("errorMsg", "未知失败原因"))
        else:
            raise RuntimeError(f"未知任务状态: {state}")
        if time.time() - start > timeout_s:
            raise TimeoutError(f"任务 {job_id} 轮询超时")
        time.sleep(poll_interval)


def fetch_pages(jsonl_url):
    """下载 JSONL，解析每页 markdown 文本，返回 [{page: N, text: str}]。

    JSONL 每行是一个分片（dataInfo.numPages 页），行内 layoutParsingResults
    逐条对应一页，需用全局页计数器累加页码。
    """
    resp = requests.get(jsonl_url, timeout=300)
    resp.raise_for_status()
    pages = []
    page_no = 0
    for line in resp.text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        result = obj.get("result") or {}
        for res in result.get("layoutParsingResults") or []:
            md = res.get("markdown") or {}
            t = md.get("text") or ""
            if not t.strip():
                continue
            page_no += 1
            pages.append({"page": page_no, "text": t})
    return pages


def build_ocr_text(pages):
    """按 ===== PAGE N ===== 分页组装，并清理图片引用/HTML，兼容 build-banks 的清理逻辑。"""
    parts = []
    for p in pages:
        t = IMG_MD_RE.sub("", p["text"])
        t = HTML_RE.sub("", t)
        t = re.sub(r"\n{3,}", "\n\n", t).strip()
        parts.append(f"===== PAGE {p['page']} =====\n{t}")
    return "\n\n".join(parts)


def ocr_paper(key, force=False):
    set_dir = os.path.join(DOWNLOAD_DIR, key)
    test_pdf = os.path.join(set_dir, "test.pdf")
    ocr_txt = os.path.join(set_dir, "test-ocr.txt")

    if not os.path.exists(test_pdf):
        print(f"  ❌ 缺少 test.pdf")
        return False
    if os.path.exists(ocr_txt) and os.stat(ocr_txt).st_size > 500 and not force:
        print(f"  跳过（已有 test-ocr.txt）")
        return True

    print(f"  提交任务: {test_pdf}")
    job_id = submit_job(test_pdf)
    print(f"  job id: {job_id}")
    jsonl_url = poll_job(job_id)
    pages = fetch_pages(jsonl_url)
    if not pages:
        print("  ❌ 无解析结果")
        return False
    text = build_ocr_text(pages)
    if len(text) < 500:
        print(f"  ❌ 输出过短 ({len(text)} 字符)")
        return False
    with open(ocr_txt, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  ✅ 写入 test-ocr.txt ({len(text)} 字符, {len(pages)} 页)")
    return True


def main():
    force = "--force" in sys.argv
    if not os.path.exists(NEEDS_OCR):
        print("缺少 needs-ocr.json")
        sys.exit(1)
    keys = json.loads(open(NEEDS_OCR, encoding="utf-8").read())
    print(f"待处理 {len(keys)} 套试卷")

    ok, failed = 0, []
    for i, key in enumerate(keys, 1):
        print(f"\n[{i}/{len(keys)}] {key}")
        try:
            if ocr_paper(key, force=force):
                ok += 1
            else:
                failed.append(key)
        except Exception as e:
            print(f"  ❌ 异常: {e}")
            failed.append(key)
        time.sleep(2)  # 避免提交过快触发限流

    print(f"\n=== 完成: 成功 {ok}, 失败 {len(failed)} ===")
    if failed:
        print("失败列表:", ", ".join(failed))
        sys.exit(1)


if __name__ == "__main__":
    main()
