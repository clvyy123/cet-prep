"""Harmonize the previously-filled watermark corners (v7) and derive app assets.

v6's fill formula halved the boundary values (visible rectangle). v7 uses the
exact 2-edge Coons patch f(x,y) = T(x) + L(y) - C, which is continuous with the
top row and left column by construction. Then derives:
  - public/app-icon.png  (256px, squircle cropped — favicon + sidebar logo)
"""
from PIL import Image, ImageFilter
import numpy as np
import os

ROOT = r"E:\词炬"


def coons_fill(arr: np.ndarray, x1: int, y1: int, x2: int, y2: int, seed: int = 5) -> None:
    """Diffusion inpainting: solve heat equation inside the box with the border
    ring fixed to surrounding pixels. Produces a seamless harmonic fill."""
    h, w = arr.shape[:2]
    x2 = min(x2, w); y2 = min(y2, h)
    bh, bw = y2 - y1, x2 - x1

    # Fixed border ring (from surrounding pixels; image edges replicate)
    ring = np.zeros((bh + 2, bw + 2, 3), dtype=np.float32)
    ring[0, 1:-1] = arr[y1 - 1, x1:x2, :3]                     # top
    ring[1:-1, 0] = arr[y1:y2, x1 - 1, :3]                     # left
    ring[-1, 1:-1] = arr[min(y2, h - 1), x1:x2, :3]            # bottom (replicate last row)
    ring[1:-1, -1] = arr[y1:y2, min(x2, w - 1) - 1, :3]        # right (replicate last col)
    ring[0, 0] = arr[y1 - 1, x1 - 1, :3]
    ring[0, -1] = arr[y1 - 1, min(x2, w - 1) - 1, :3]
    ring[-1, 0] = arr[min(y2, h - 1), x1 - 1, :3]
    ring[-1, -1] = arr[min(y2, h - 1), min(x2, w - 1) - 1, :3]

    # init interior with current content
    rng = np.random.default_rng(seed)
    interior = arr[y1:y2, x1:x2, :3].astype(np.float32)
    interior += rng.normal(0, 1.5, size=interior.shape)        # break flatness
    ring[1:-1, 1:-1] = np.clip(interior, 0, 255)

    # Jacobi iterations (diffusion). 164x84 box converges in a few hundred.
    work = ring.copy()
    for _ in range(600):
        avg = (
            work[:-2, 1:-1, :] + work[2:, 1:-1, :]
            + work[1:-1, :-2, :] + work[1:-1, 2:, :]
        ) / 4.0
        work[1:-1, 1:-1, :] = avg

    fill = np.clip(work[1:-1, 1:-1, :], 0, 255)
    # re-add photographic grain matching surroundings (measured: R3 G5 B11)
    grain_sigma = np.array([3.0, 5.0, 11.0])
    fill = fill + rng.normal(0.0, 1.0, size=fill.shape) * grain_sigma[None, None, :]
    fill = np.clip(fill, 0, 255).astype(np.uint8)
    arr[y1:y2, x1:x2, :3] = fill
    arr[y1:y2, x1:x2, 3] = 255

    # re-sprinkle a few faint stars
    n_stars = int(bw * bh * 0.0022)
    for _ in range(n_stars):
        sx = int(rng.integers(x1, x2)); sy = int(rng.integers(y1, y2))
        intensity = int(rng.integers(45, 110))
        arr[sy, sx, :3] = intensity


def feather_seam(arr: np.ndarray, x1: int, y1: int, x2: int, y2: int, pad: int = 10) -> None:
    """Blur-blend a band straddling the box border; weight fades outside->inside."""
    img = Image.fromarray(arr, "RGBA")
    h, w = arr.shape[:2]
    bx1 = max(0, x1 - pad); by1 = max(0, y1 - pad)
    bx2 = min(w, x2 + pad); by2 = min(h, y2 + pad)
    blurred = np.array(
        img.crop((bx1, by1, bx2, by2)).filter(ImageFilter.GaussianBlur(radius=2.0))
    )
    region = arr[by1:by2, bx1:bx2].astype(np.float32)
    hh, ww = region.shape[:2]
    yy0 = y1 - by1; xx0 = x1 - bx1
    yy1 = y2 - by1; xx1 = x2 - bx1
    ys = np.arange(hh)[:, None]
    xs = np.arange(ww)[None, :]
    # distance outside the box (0 inside)
    dy = np.maximum(np.maximum(yy0 - ys, ys - yy1 + 1), 0)
    dx = np.maximum(np.maximum(xx0 - xs, xs - xx1 + 1), 0)
    d = np.maximum(dx, dy).astype(np.float32)
    # weight: 1 inside box, fading to 0 at pad distance outside
    alpha = np.clip(1.0 - d / pad, 0.0, 1.0)[:, :, None]
    blended = region * (1 - alpha) + blurred.astype(np.float32) * alpha
    arr[by1:by2, bx1:bx2] = np.clip(blended, 0, 255).astype(np.uint8)


def find_squircle_bbox(arr: np.ndarray, thresh: float = 55.0) -> tuple[int, int, int, int]:
    rgb = arr[:, :, :3].astype(np.float32)
    bright = rgb.mean(axis=2)
    mask = bright > thresh
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def harmonize(path: str, box: tuple[int, int, int, int], seed: int) -> None:
    img = Image.open(path).convert("RGBA")
    arr = np.array(img).copy()
    coons_fill(arr, *box, seed=seed)
    feather_seam(arr, *box)
    Image.fromarray(arr).save(path, "PNG", optimize=True)
    print("harmonized", path)


def main() -> None:
    harmonize(os.path.join(ROOT, "build", "icon.png"), (860, 940, 1024, 1024), seed=5)
    harmonize(os.path.join(ROOT, "design", "icon-presentation.png"), (1395, 940, 1536, 1024), seed=9)

    # derive cropped app icon for favicon + sidebar
    p_icon = os.path.join(ROOT, "build", "icon.png")
    img = Image.open(p_icon).convert("RGBA")
    arr = np.array(img)
    x1, y1, x2, y2 = find_squircle_bbox(arr)
    print("squircle bbox:", x1, y1, x2, y2, "size:", x2 - x1, y2 - y1)
    crop = img.crop((x1, y1, x2, y2))
    side = max(crop.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
    icon256 = square.resize((256, 256), Image.LANCZOS)
    out_pub = os.path.join(ROOT, "public", "app-icon.png")
    icon256.save(out_pub, "PNG", optimize=True)
    print("saved", out_pub)


if __name__ == "__main__":
    main()