"""渲染 PDF 为 PNG 图片（使用 PyMuPDF）
用法: python render_pdf.py <input.pdf> <output_dir> [dpi]
"""
import sys
import os

def render_pdf(pdf_path, out_dir, dpi=300):
    import fitz  # PyMuPDF
    os.makedirs(out_dir, exist_ok=True)
    # 清空输出目录
    for f in os.listdir(out_dir):
        fp = os.path.join(out_dir, f)
        if os.path.isfile(fp):
            os.unlink(fp)
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        out_path = os.path.join(out_dir, f"page_{i+1:03d}.png")
        pix.save(out_path)
    doc.close()
    print(f"Rendered {page_count} pages to {out_dir}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python render_pdf.py <input.pdf> <output_dir> [dpi]")
        sys.exit(1)
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 300
    render_pdf(sys.argv[1], sys.argv[2], dpi)
