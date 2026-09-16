// 批量 OCR 扫描版试卷 PDF，直接调用 client.py
// 用法：node scripts/batch-ocr.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = path.resolve('scripts/.download');
const VENV_PY = 'C:\\Users\\yy\\.openvino\\venv\\mineru\\Scripts\\python.exe';
const CLIENT_PY = 'c:\\Users\\yy\\.trae-cn\\skills\\local-mineru\\scripts\\client.py';
const SKILL_ROOT = 'c:\\Users\\yy\\.trae-cn\\skills\\local-mineru';
const needsOcr = JSON.parse(fs.readFileSync('e:/词炬/scripts/needs-ocr.json', 'utf8'));

function ocrOne(testPdf, outDir) {
  execFileSync(VENV_PY, [CLIENT_PY, '-i', testPdf, '-o', outDir], {
    stdio: 'inherit',
    timeout: 1200000, // 20分钟超时
    cwd: SKILL_ROOT,
  });
}

let done = 0, failed = 0;
const failed_list = [];
for (const key of needsOcr) {
  const setDir = path.join(DIR, key);
  const testPdf = path.join(setDir, 'test.pdf');
  const ocrTxt = path.join(setDir, 'test-ocr.txt');

  // 已有 OCR 结果则跳过
  if (fs.existsSync(ocrTxt) && fs.statSync(ocrTxt).size > 500) {
    console.log(`[${done + failed + 1}/${needsOcr.length}] ${key} 已有 OCR，跳过`);
    done++;
    continue;
  }

  console.log(`\n[${done + failed + 1}/${needsOcr.length}] OCR: ${key}`);
  const outDir = path.join(setDir, 'ocr-out');
  fs.mkdirSync(outDir, { recursive: true });

  let success = false;
  for (let attempt = 1; attempt <= 3 && !success; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`  重试 ${attempt}/3...`);
        // 清理上次的输出目录
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(outDir, { recursive: true });
      }
      ocrOne(testPdf, outDir);

      // 先保存结果，再清理
      const mdFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.md'));
      if (mdFiles.length === 0) {
        console.log(`  ❌ 未找到输出 .md 文件`);
        if (attempt < 3) continue;
        failed++;
        failed_list.push(key);
        break;
      }
      const content = fs.readFileSync(path.join(outDir, mdFiles[0]), 'utf8');
      fs.writeFileSync(ocrTxt, content, 'utf8');
      done++;
      success = true;
      console.log(`  ✅ 完成 → test-ocr.txt (${content.length} 字符)`);
      // 保存后再清理（包括 images 子目录）
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch (e) {
      console.log(`  ❌ 失败(尝试${attempt}): ${e.message}`);
      if (attempt < 3) {
        console.log('  等待 30 秒后重试...');
        execFileSync(VENV_PY, ['-c', 'import time; time.sleep(30)'], { stdio: 'ignore' });
      } else {
        failed++;
        failed_list.push(key);
      }
    }
  }
}

console.log(`\n=== OCR 完成: 成功 ${done}, 失败 ${failed} ===`);
if (failed_list.length) console.log('失败列表:', failed_list.join(', '));
