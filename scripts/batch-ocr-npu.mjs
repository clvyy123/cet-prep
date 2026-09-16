// 批量 OCR：pdftoppm 渲染 PDF → ppocr.exe NPU OCR → 合并为 test-ocr.txt
// 用法：node scripts/batch-ocr-npu.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const DIR = path.resolve('scripts/.download');
const PYTHON = 'C:\\Users\\yy\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const RENDER_SCRIPT = path.resolve('scripts/render_pdf.py');
const PPOCR_EXE = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin\\ppocr.exe';
const PPOCR_DIR = 'c:\\Users\\yy\\.trae-cn\\skills\\local-ocr-npu\\bin';
const DET_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_det_ov';
const REC_MODEL_DIR = 'C:\\Users\\yy\\.openvino\\models\\PP-OCRv5_server_rec_ov';
const TEMP_WORK = 'C:\\Users\\yy\\AppData\\Local\\Temp\\ocr_npu_work';

const remaining = JSON.parse(fs.readFileSync('e:/词炬/scripts/needs-ocr-remaining.json', 'utf8'));

let done = 0, failed = 0;
const failedList = [];

for (const key of remaining) {
  const setDir = path.join(DIR, key);
  const testPdf = path.join(setDir, 'test.pdf');
  const ocrTxt = path.join(setDir, 'test-ocr.txt');

  if (fs.existsSync(ocrTxt) && fs.statSync(ocrTxt).size > 500) {
    console.log(`[${done + failed + 1}/${remaining.length}] ${key} 已有 OCR，跳过`);
    done++;
    continue;
  }

  console.log(`\n[${done + failed + 1}/${remaining.length}] OCR: ${key}`);

  // 准备临时目录（在 C 盘，和 ppocr.exe 同驱动器）
  const tmpImgDir = path.join(TEMP_WORK, key.replace(/[\\/]/g, '_'), 'images');
  const tmpOutDir = path.join(TEMP_WORK, key.replace(/[\\/]/g, '_'), 'output');
  fs.mkdirSync(tmpImgDir, { recursive: true });
  fs.mkdirSync(tmpOutDir, { recursive: true });
  // 清空临时目录
  for (const f of fs.readdirSync(tmpImgDir)) fs.unlinkSync(path.join(tmpImgDir, f));
  for (const f of fs.readdirSync(tmpOutDir)) fs.unlinkSync(path.join(tmpOutDir, f));

  try {
    // Step 1: PyMuPDF 渲染 PDF 为 PNG（300 DPI）
    console.log('  渲染 PDF → PNG...');
    execFileSync(PYTHON, [RENDER_SCRIPT, testPdf, tmpImgDir, '300'], {
      stdio: 'pipe',
      timeout: 120000,
    });
    const pngs = fs.readdirSync(tmpImgDir).filter(f => f.endsWith('.png'));
    console.log(`  生成 ${pngs.length} 张 PNG`);

    // Step 2: ppocr.exe NPU OCR
    console.log('  NPU OCR...');
    // ppocr.exe 工作目录在 bin，用相对路径引用模型
    const relDet = path.relative(PPOCR_DIR, DET_MODEL_DIR);
    const relRec = path.relative(PPOCR_DIR, REC_MODEL_DIR);
    const relInput = path.relative(PPOCR_DIR, tmpImgDir);
    const relOutput = path.relative(PPOCR_DIR, tmpOutDir);

    execFileSync(PPOCR_EXE, [
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
    ], {
      stdio: 'inherit',
      timeout: 300000, // 5 分钟
      cwd: PPOCR_DIR,
    });

    // Step 3: 合并输出 txt 文件
    const txtFiles = fs.readdirSync(tmpOutDir).filter(f => f.endsWith('.txt')).sort();
    if (txtFiles.length === 0) {
      console.log('  ❌ 无 OCR 输出');
      failed++;
      failedList.push(key);
      continue;
    }

    let allText = '';
    for (const f of txtFiles) {
      const pageName = path.basename(f, '.txt');
      allText += `# ${pageName}\n\n`;
      allText += fs.readFileSync(path.join(tmpOutDir, f), 'utf8') + '\n\n---\n\n';
    }

    fs.writeFileSync(ocrTxt, allText, 'utf8');
    done++;
    console.log(`  ✅ 完成 → test-ocr.txt (${allText.length} 字符, ${txtFiles.length} 页)`);

    // 清理临时目录
    fs.rmSync(path.join(TEMP_WORK, key.replace(/[\\/]/g, '_')), { recursive: true, force: true });
  } catch (e) {
    console.log(`  ❌ 失败: ${e.message}`);
    failed++;
    failedList.push(key);
  }
}

console.log(`\n=== NPU OCR 完成: 成功 ${done}, 失败 ${failed} ===`);
if (failedList.length) console.log('失败列表:', failedList.join(', '));
