// 测试不同 NPU OCR 参数对质量的影响（单页测试）
// 用法: node scripts/test-ocr-params.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PYTHON = 'C:\\Users\\yy\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const RENDER_SCRIPT = path.resolve('scripts/render_pdf.py');
const PPOCR_EXE = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin\\ppocr.exe';
const PPOCR_DIR = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin';
const DET_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_det_ov';
const REC_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_rec_ov';
const TEMP_WORK = 'C:\\Users\\yy\\AppData\\Local\\Temp\\ocr_param_test';

// 用 cet4 2022_09 第1套第1页测试
const testPdf = 'e:\\词炬\\scripts\\.download\\cet4\\2022_09_1\\test.pdf';

// 清理
if (fs.existsSync(TEMP_WORK)) fs.rmSync(TEMP_WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(TEMP_WORK, 'images'), { recursive: true });
fs.mkdirSync(path.join(TEMP_WORK, 'output'), { recursive: true });

// 渲染第1页（用 600 DPI 测试更高分辨率）
console.log('渲染 PDF 第1页 @ 600 DPI...');
execFileSync(PYTHON, [RENDER_SCRIPT, testPdf, path.join(TEMP_WORK, 'images'), '600'], {
  stdio: 'pipe', timeout: 60000,
});
const pngs = fs.readdirSync(path.join(TEMP_WORK, 'images')).filter(f => f.endsWith('.png'));
console.log(`生成 ${pngs.length} 页, 用第1页测试`);

// 测试参数组合
const configs = [
  { name: 'default', args: [] },
  { name: 'side960', args: ['--text_det_limit_side_len=960', '--text_det_limit_type=max'] },
  { name: 'side960-unclip2.0', args: ['--text_det_limit_side_len=960', '--text_det_limit_type=max', '--text_det_unclip_ratio=2.0'] },
  { name: 'side960-thresh0.2', args: ['--text_det_limit_side_len=960', '--text_det_limit_type=max', '--text_det_thresh=0.2', '--text_det_box_thresh=0.5'] },
];

for (const cfg of configs) {
  const outDir = path.join(TEMP_WORK, 'output_' + cfg.name);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  console.log(`\n=== ${cfg.name} ===`);
  const relDet = path.relative(PPOCR_DIR, DET_MODEL_DIR);
  const relRec = path.relative(PPOCR_DIR, REC_MODEL_DIR);
  const relInput = path.relative(PPOCR_DIR, path.join(TEMP_WORK, 'images'));
  const relOutput = path.relative(PPOCR_DIR, outDir);

  const args = [
    'ocr',
    `--input=${relInput}`,
    '--text_detection_model_name=PP-OCRv5_server_det',
    `--text_detection_model_dir=${relDet}`,
    '--text_recognition_model_name=PP-OCRv5_server_rec',
    `--text_recognition_model_dir=${relRec}`,
    '--device=npu',
    '--text_recognition_batch_size=1',
    '--text_rec_score_thresh=0.0',
    `--save_path=${relOutput}`,
    ...cfg.args,
  ];

  try {
    execFileSync(PPOCR_EXE, args, { stdio: 'inherit', timeout: 120000, cwd: PPOCR_DIR });
    const txts = fs.readdirSync(outDir).filter(f => f.endsWith('.txt')).sort();
    if (txts.length > 0) {
      const text = fs.readFileSync(path.join(outDir, txts[0]), 'utf8');
      console.log(`\n输出 (${text.length} 字符):`);
      console.log(text.slice(0, 600));
    } else {
      console.log('无输出');
    }
  } catch (e) {
    console.log('失败:', e.message);
  }
}
