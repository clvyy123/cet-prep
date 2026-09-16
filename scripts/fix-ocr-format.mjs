// 后处理 NPU OCR 输出：修复格式使其与 build-banks.mjs 解析器兼容
// 用法：node scripts/fix-ocr-format.mjs
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('scripts/.download');
const needsOcr = JSON.parse(fs.readFileSync('e:/词炬/scripts/needs-ocr.json', 'utf8'));

let fixed = 0;
for (const key of needsOcr) {
  const ocrTxt = path.join(DIR, key, 'test-ocr.txt');
  if (!fs.existsSync(ocrTxt) || fs.statSync(ocrTxt).size < 500) continue;

  let text = fs.readFileSync(ocrTxt, 'utf8');

  // 检查是否需要修复（NPU OCR: # page_ 或已转换的 ===== PAGE；mineru: ## Part）
  const isNpu = text.includes('# page_') || text.includes('===== PAGE');
  const isMineru = text.includes('## Part');
  if (!isNpu && !isMineru) continue;

  let original = text;

  if (isNpu) {
    // 1. 把 "# page_XXX" 行替换为 "===== PAGE N =====" 标记
    let pageNum = 0;
    text = text.replace(/^# page_\d+\s*$/gm, () => {
      pageNum++;
      return `===== PAGE ${pageNum} =====`;
    });

    // 2. PartI → Part I, PartII → Part II, PartIII → Part III, PartIV → Part IV
    text = text.replace(/\bPart(I{1,3}|IV|V)\b/g, 'Part $1');

    // 3. SectionA → Section A, SectionB → Section B 等
    text = text.replace(/\bSection([A-F])\b/g, 'Section $1');
  }

  // 通用：把 "Part I\nWriting" 合并成 "Part I Writing"（build-banks 同行匹配关键词）
  // 兼容 mineru 的 "## Part I\n\n## Writing" 和 NPU 的 "Part I\nWriting"
  text = text.replace(/^(#{0,2}\s*Part\s+[IVX]+)\s*\n+\s*#{0,2}\s*(Writing|Listening|Reading|Translation)/gm, '$1 $2');
  // Section 同理
  text = text.replace(/^(#{0,2}\s*Section\s+[A-F])\s*\n+\s*#{0,2}\s*(Directions|Questions)/gm, '$1 $2');

  // 4. 在选项间添加空格（NPU OCR 经常把选项粘连）
  // "1.A)" → "1. A)", "2.B)" → "2. B)" 等
  text = text.replace(/(\d{1,2})\.?([A-D]\))/g, '$1. $2');

  // 5. 折叠多余空行
  text = text.replace(/\n{3,}/g, '\n\n');

  if (text !== original) {
    fs.writeFileSync(ocrTxt, text, 'utf8');
    fixed++;
    console.log(`✅ ${key}`);
  }
}

console.log(`\n修复完成: ${fixed} 套`);
