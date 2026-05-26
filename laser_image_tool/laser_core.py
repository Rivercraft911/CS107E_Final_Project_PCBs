"""
laser_core.py — quantization logic for the laser image tool.

Calibration hook: edit R_LEVELS / G_LEVELS / B_LEVELS below to replace the
default evenly-spaced values with measured output levels from your laser.
- rgb64  → lists of 4 values each, range 0–255
- rgb4096 → lists of 16 values each, range 0–255
These are ignored for rgb8 / rgb9.
"""

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# CALIBRATION HOOK — edit these to match measured laser output levels
# ---------------------------------------------------------------------------
R_LEVELS = None   # e.g. [0, 72, 158, 255] for rgb64; None = use default
G_LEVELS = None
B_LEVELS = None
# ---------------------------------------------------------------------------


def _default_levels(n: int) -> list[int]:
    return [round(i * 255 / (n - 1)) for i in range(n)]


def _get_levels(override, n: int) -> list[int]:
    if override is not None:
        if len(override) != n:
            raise ValueError(f"Expected {n} calibration levels, got {len(override)}")
        return list(override)
    return _default_levels(n)


def _build_palette(mode: str) -> tuple[np.ndarray, list[tuple[int, int, int]] | None]:
    """Return (palette_rgb_uint8 [N,3], level_codes or None).
    level_codes[i] = (r_code, g_code, b_code) for palette entry i.
    """
    if mode == "rgb8":
        vals = [0, 255]
        palette = np.array(
            [(r, g, b) for r in vals for g in vals for b in vals], dtype=np.uint8
        )
        return palette, None

    if mode == "rgb9":
        vals = [0, 255]
        colors = [(r, g, b) for r in vals for g in vals for b in vals]
        colors.append((128, 128, 128))
        return np.array(colors, dtype=np.uint8), None

    if mode == "rgb64":
        n = 4
        rl = _get_levels(R_LEVELS, n)
        gl = _get_levels(G_LEVELS, n)
        bl = _get_levels(B_LEVELS, n)
        palette = np.array(
            [(r, g, b) for r in rl for g in gl for b in bl], dtype=np.uint8
        )
        codes = [
            (ri, gi, bi)
            for ri in range(n)
            for gi in range(n)
            for bi in range(n)
        ]
        return palette, codes

    if mode == "rgb4096":
        n = 16
        rl = _get_levels(R_LEVELS, n)
        gl = _get_levels(G_LEVELS, n)
        bl = _get_levels(B_LEVELS, n)
        palette = np.array(
            [(r, g, b) for r in rl for g in gl for b in bl], dtype=np.uint8
        )
        codes = [
            (ri, gi, bi)
            for ri in range(n)
            for gi in range(n)
            for bi in range(n)
        ]
        return palette, codes

    raise ValueError(f"Unknown mode: {mode}")


def _srgb_to_linear(u8: np.ndarray) -> np.ndarray:
    """sRGB uint8 → linear float32 [0,1]."""
    f = u8.astype(np.float32) / 255.0
    return np.where(f <= 0.04045, f / 12.92, ((f + 0.055) / 1.055) ** 2.4)


def _nearest_palette(pixels: np.ndarray, palette: np.ndarray) -> np.ndarray:
    """pixels [H*W, 3] float32, palette [N, 3] float32 → indices [H*W]."""
    # Use broadcasting; for large palettes chunk to avoid OOM
    diff = pixels[:, None, :] - palette[None, :, :]   # [HW, N, 3]
    dist = (diff * diff).sum(axis=2)                   # [HW, N]
    return dist.argmin(axis=1)


def quantize(
    img: Image.Image,
    width: int,
    height: int,
    mode: str,
    gamma: bool = False,
    dither: bool = False,
) -> dict:
    """
    Quantize *img* to *mode* at *width*×*height*.

    Returns a dict with keys:
        quantized_img   PIL Image (sRGB, mode RGB)
        palette         np.ndarray [N,3] uint8
        level_codes     list of (r_code,g_code,b_code) or None
        indices         np.ndarray [H,W] int  (palette index per pixel)
    """
    img = img.convert("RGB")
    img = img.resize((width, height), Image.LANCZOS)

    palette_u8, level_codes = _build_palette(mode)

    pixels = np.array(img, dtype=np.uint8)  # [H, W, 3]
    H, W = pixels.shape[:2]

    if gamma:
        work = _srgb_to_linear(pixels)
        pal_work = _srgb_to_linear(palette_u8)
    else:
        work = pixels.astype(np.float32)
        pal_work = palette_u8.astype(np.float32)

    if dither:
        indices = _quantize_dither(work, pal_work, H, W)
    else:
        flat = work.reshape(-1, 3)
        indices = _nearest_palette(flat, pal_work).reshape(H, W)

    out_pixels = palette_u8[indices]  # [H, W, 3] uint8
    quantized_img = Image.fromarray(out_pixels, "RGB")

    return {
        "quantized_img": quantized_img,
        "palette": palette_u8,
        "level_codes": level_codes,
        "indices": indices,
    }


def _quantize_dither(work: np.ndarray, pal_work: np.ndarray, H: int, W: int) -> np.ndarray:
    """Floyd-Steinberg error diffusion. work is float32 [H,W,3]."""
    buf = work.copy()
    indices = np.zeros((H, W), dtype=np.int32)

    for y in range(H):
        for x in range(W):
            old = buf[y, x]
            # find nearest
            diff = pal_work - old[None, :]
            dist = (diff * diff).sum(axis=1)
            idx = int(dist.argmin())
            indices[y, x] = idx
            err = old - pal_work[idx]

            if x + 1 < W:
                buf[y, x + 1] += err * (7 / 16)
            if y + 1 < H:
                if x > 0:
                    buf[y + 1, x - 1] += err * (3 / 16)
                buf[y + 1, x] += err * (5 / 16)
                if x + 1 < W:
                    buf[y + 1, x + 1] += err * (1 / 16)

    return indices


def _mode_color_count(mode: str) -> int:
    return {"rgb8": 8, "rgb9": 9, "rgb64": 64, "rgb4096": 4096}[mode]


def build_label(mode: str, width: int, height: int, gamma: bool, dither: bool) -> str:
    count = _mode_color_count(mode)
    opts = []
    if gamma:
        opts.append("gamma")
    if dither:
        opts.append("dither")
    suffix = " · " + " · ".join(opts) if opts else ""
    return f"{mode} · {count} colors · {width}×{height}{suffix}"


MODES = ["rgb8", "rgb9", "rgb64", "rgb4096"]
