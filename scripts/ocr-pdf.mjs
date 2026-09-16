/**
 * 单套解析 PDF → 页级 OCR JSON（本地 PP-OCRv5，OpenVINO CPU）
 *
 *   node scripts/ocr-pdf.mjs <pdf> <workDir> [dpi] [threads]
 *
 * workDir 必须是纯 ASCII 路径：ppocr.exe 在非 ASCII 路径下会崩。
 * 产出 <workDir>/out/page_001/page_001.json，供 scripts/layout-lines.mjs 还原版式。
 * 已有结果默认跳过，便于断点续跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PPOCR_BIN = 'c:/Users/yy/.trae-cn/skills/local-ocr-npu/bin';
const DET_DIR = '../../../../.openvino/models/PP-OCRv5_server_det_ov';
const REC_DIR = '../../../../.openvino/models/PP-OCRv5_server_rec_ov';
const PY = 'C:/Users/yy/AppData/Local/Programs/Python/Python312/python.exe';

const [pdfPath, workDir, dpiArg, threadsArg] = process.argv.slice(2);
const dpi = Number(dpiArg) || 200;
const threads = Number(threadsArg) || 8;

const imgDir = path.join(workDir, 'img');
const outRoot = path.join(workDir, 'out');
const rel = (p) => path.relative(PPOCR_BIN, p).split(path.sep).join('/');

if (!fs.existsSync(imgDir) || !fs.readdirSync(imgDir).some((f) => f.endsWith('.png'))) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(imgDir, { recursive: true });
  execFileSync(PY, ['scripts/render_pdf.py', path.resolve(pdfPath), imgDir, String(dpi)], {
    stdio: 'ignore',
    env: { ...process.env, PYTHONWARNINGS: 'ignore' },
  });
}
fs.mkdirSync(outRoot, { recursive: true });

const pages = fs.readdirSync(imgDir).filter((f) => f.endsWith('.png')).sort();
let done = 0;
for (const p of pages) {
  const name = path.parse(p).name;
  const outDir = path.join(outRoot, name);
  if (fs.existsSync(path.join(outDir, `${name}.json`))) {
    done++;
    continue;
  }
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync(
    `${PPOCR_BIN}/ppocr.exe`,
    [
      'ocr',
      `--input=${rel(path.join(imgDir, p))}`,
      '--text_detection_model_name=PP-OCRv5_server_det',
      `--text_detection_model_dir=${DET_DIR}`,
      '--text_recognition_model_name=PP-OCRv5_server_rec',
      `--text_recognition_model_dir=${REC_DIR}`,
      '--device=cpu',
      `--cpu_threads=${threads}`,
      '--text_recognition_batch_size=6',
      '--text_rec_score_thresh=0',
      `--save_path=${rel(outDir)}`,
    ],
    { cwd: PPOCR_BIN, stdio: 'ignore' }
  );
  done++;
}
console.log(`OCR ${path.basename(path.dirname(pdfPath))} · ${done}/${pages.length} 页`);
