/**
 * 解析 PDF → 干净 OCR 文本（本地 PP-OCRv5，OpenVINO CPU）
 *
 *   node scripts/ocr-papers.mjs "<pdf路径>" "<输出txt路径>" [dpi]
 *
 * 为什么走临时 ASCII 目录：ppocr.exe 在非 ASCII 路径下会崩（GBK/UTF-8 编码问题）。
 * 为什么记录每行坐标：解析 PDF 是双栏排版，按 y 聚类还原行、再按 x 分栏，才能得到正确阅读顺序。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PPOCR_BIN = 'c:/Users/yy/.trae-cn/skills/local-ocr-npu/bin';
const DET_DIR = '../../../../.openvino/models/PP-OCRv5_server_det_ov';
const REC_DIR = '../../../../.openvino/models/PP-OCRv5_server_rec_ov';
const TEMP = 'C:/Users/yy/AppData/Local/Temp/cetocr';
const PY = 'C:/Users/yy/AppData/Local/Programs/Python/Python312/python.exe';

const [pdfPath, outTxt, dpiArg] = process.argv.slice(2);
const dpi = Number(dpiArg) || 200;

const work = path.join(TEMP, 'job');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'img'), { recursive: true });
fs.mkdirSync(path.join(work, 'out'), { recursive: true });

// 1. 渲染 PDF 为 PNG
execFileSync(
  PY,
  ['scripts/render_pdf.py', path.resolve(pdfPath), path.join(work, 'img'), String(dpi)],
  { stdio: 'inherit', env: { ...process.env, PYTHONWARNINGS: 'ignore' } }
);

const pages = fs.readdirSync(path.join(work, 'img')).filter((f) => f.endsWith('.png')).sort();
console.log(`共 ${pages.length} 页，开始 OCR…`);

// ppocr.exe 必须用相对于自身工作目录的路径（绝对路径 + 中文会崩）
const rel = (p) => path.relative(PPOCR_BIN, p).split(path.sep).join('/');

// 2. 逐页 OCR
const results = [];
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  const outDir = path.join(work, 'out', path.parse(p).name);
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  execFileSync(
    `${PPOCR_BIN}/ppocr.exe`,
    [
      'ocr',
      `--input=${rel(path.join(work, 'img', p))}`,
      '--text_detection_model_name=PP-OCRv5_server_det',
      `--text_detection_model_dir=${DET_DIR}`,
      '--text_recognition_model_name=PP-OCRv5_server_rec',
      `--text_recognition_model_dir=${REC_DIR}`,
      '--device=cpu',
      '--text_recognition_batch_size=6',
      '--text_rec_score_thresh=0',
      `--save_path=${rel(outDir)}`,
    ],
    { cwd: PPOCR_BIN, stdio: 'ignore' }
  );
  const jsonPath = path.join(outDir, `${path.parse(p).name}.json`);
  if (fs.existsSync(jsonPath)) {
    results.push({ page: p, data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')) });
  }
  console.log(`  [${i + 1}/${pages.length}] ${p}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// 3. 按坐标还原阅读顺序（先按 y 聚行，再把同一行按 x 左→右）
const lines = [];
results.forEach(({ page, data }, pageIdx) => {
  const items = (data.rec_texts || [])
    .map((text, i) => {
      const b = data.rec_boxes?.[i] || [0, 0, 0, 0];
      return { text: String(text).trim(), x0: b[0], x1: b[2], y: (b[1] + b[3]) / 2 };
    })
    .filter((it) => it.text);

  items.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const pageLines = [];
  for (const it of items) {
    const last = pageLines[pageLines.length - 1];
    if (last && Math.abs(last.y - it.y) < 12 && it.x0 - last.x1 < 120) {
      last.parts.push(it);
      last.y = (last.y + it.y) / 2;
      last.x1 = Math.max(last.x1, it.x1);
    } else {
      pageLines.push({ y: it.y, x0: it.x0, x1: it.x1, parts: [it] });
    }
  }
  lines.push(`\n===== PAGE ${pageIdx + 1} =====`);
  for (const l of pageLines) {
    lines.push(l.parts.sort((a, b) => a.x0 - b.x0).map((p) => p.text).join(' '));
  }
});

fs.writeFileSync(outTxt, lines.join('\n'), 'utf8');
console.log(`\n✅ → ${outTxt} (${lines.length} 行)`);
