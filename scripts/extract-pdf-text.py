"""提取 PDF 文字层"""
import sys
import fitz

pdf_path = sys.argv[1]
doc = fitz.open(pdf_path)
for i, page in enumerate(doc):
    print(f"===== PAGE {i+1} =====")
    print(page.get_text())
doc.close()
