# Laser Image Tool

A local web app for previewing how images will look quantized for the raster laser projector.

## What it does

- Drag in any image (JPEG, PNG, etc.)
- Choose target resolution, color mode, and processing options
- See pixel-accurate previews of the quantized result, with crisp nearest-neighbor upscaling
- Optionally export a C header or JSON file with per-pixel palette codes ready for the iC-HG30 hardware

**Color modes:**

| Mode | Colors | Description |
|------|--------|-------------|
| `rgb8` | 8 | Binary RGB — each channel 0 or 255 |
| `rgb9` | 9 | `rgb8` + neutral gray (128,128,128) |
| `rgb64` | 64 | 4 levels/channel (2 bits) — one iC-HG30 board |
| `rgb4096` | 4096 | 16 levels/channel (4 bits) — two iC-HG30 boards |

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

The browser opens automatically to `http://127.0.0.1:5173/`.

## Calibration hook

`laser_core.py` has three constants at the top:

```python
R_LEVELS = None   # e.g. [0, 72, 158, 255] for rgb64
G_LEVELS = None
B_LEVELS = None
```

Set any of these to a list of measured laser output levels (4 values for `rgb64`, 16 for `rgb4096`) to replace the default evenly-spaced palette. `None` means use the default `[0, 85, 170, 255]` (or 0–255 in 16 steps) spacing. These values map directly to the EN current-DAC bits on the HG30.
