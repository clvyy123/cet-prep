"""Generate multi-size ICO from the master icon.png."""
import os
from PIL import Image

SRC = r"E:\词炬\build\icon.png"
DST_ICO = r"E:\词炬\build\icon.ico"


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    # PIL ICO save: pass sizes, PIL handles multi-resolution internally
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(DST_ICO, format="ICO", sizes=sizes)
    print("ico saved:", DST_ICO, os.path.getsize(DST_ICO), "bytes")
    # Verify
    out = Image.open(DST_ICO)
    out.load()
    print("verified frames:", out.info.get("sizes", "unknown"))


if __name__ == "__main__":
    main()