// 测试不同参数名格式
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PPOCR_EXE = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin\\ppocr.exe';
const PPOCR_DIR = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin';
const DET_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_det_ov';
const REC_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_rec_ov';
const TEMP_WORK = 'C:\\Users\\yy\\AppData\\Local\\Temp\\ocr_param_test2';

if (fs.existsSync(TEMP_WORK)) fs.rmSync(TEMP_WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(TEMP_WORK, 'images'), { recursive: true });
fs.mkdirSync(path.join(TEMP_WORK, 'output'), { recursive: true });

// 复制一张测试图片
const srcPng = 'C:\\Users\\yy\\AppData\\Local\\Temp\\ocr_param_test\\images\\page_001.png';
if (fs.existsSync(srcPng)) {
  fs.copyFileSync(srcPng, path.join(TEMP_WORK, 'images', 'page_001.png'));
  console.log('使用已有测试图片');
} else {
  console.log('请先运行 test-ocr-params.mjs');
  process.exit(1);
}

const relDet = path.relative(PPOCR_DIR, DET_MODEL_DIR);
const relRec = path.relative(PPOCR_DIR, REC_MODEL_DIR);
const relInput = path.relative(PPOCR_DIR, path.join(TEMP_WORK, 'images'));
const relOutput = path.relative(PPOCR_DIR, path.join(TEMP_WORK, 'output'));

// 测试不同参数名格式
const tests = [
  { name: 'underscore', args: ['--text_det_limit_side_len=960'] },
  { name: 'space', args: ['--text_det_limit_side_len', '960'] },
  { name: 'SubModules', args: ['--SubModules.TextDetection.limit_side_len=960'] },
];

for (const t of tests) {
  const outDir = path.join(TEMP_WORK, 'output_' + t.name);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  const relOut = path.relative(PPOCR_DIR, outDir);

  console.log(`\n=== ${t.name} ===`);
  try {
    const out = execFileSync(PPOCR_EXE, [
      'ocr',
      `--input=${relInput}`,
      '--text_detection_model_name=PP-OCRv5_server_det',
      `--text_detection_model_dir=${relDet}`,
      '--text_recognition_model_name=PP-OCRv5_server_rec',
      `--text_recognition_model_dir=${relRec}`,
      '--device=npu',
      '--text_recognition_batch_size=1',
      '--text_rec_score_thresh=0.0',
      `--save_path=${relOut}`,
      ...t.args,
    ], { stdio: 'pipe', timeout: 120000, cwd: PPOCR_DIR, encoding: 'utf8' });

    // 检查 limit_side_len 是否变化
    const match = out.match(/limit_side_len' = '(\d+)'/);
    console.log('limit_side_len:', match ? match[1] : '未找到');
  } catch (e) {
    const match = (e.stdout || e.message || '').match(/limit_side_len' = '(\d+)'/);
    console.log('limit_side_len:', match ? match[1] : '错误');
  }
}
