"""
app.py — Flask backend for the laser image preview tool.
Run: python app.py
"""

import base64
import io
import json
import threading
import webbrowser
from flask import Flask, request, jsonify, send_from_directory
from PIL import Image
import numpy as np

from laser_core import quantize, build_label, MODES, _mode_color_count

app = Flask(__name__, static_folder="static")

PORT = 5173


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory("static", filename)


def _img_to_b64_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _upscale(img: Image.Image, scale: int) -> Image.Image:
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def _emit_c(mode: str, result: dict) -> str:
    indices = result["indices"]
    codes = result["level_codes"]
    H, W = indices.shape
    lines = [
        f"// Auto-generated laser image — {mode} {W}x{H}",
        f"#define IMG_WIDTH  {W}",
        f"#define IMG_HEIGHT {H}",
        "",
    ]
    if codes is not None:
        lines.append(f"// Each entry: {{r_code, g_code, b_code}}")
        lines.append(f"uint8_t img_data[{H}][{W}][3] = {{")
        for y in range(H):
            row_parts = []
            for x in range(W):
                rc, gc, bc = codes[indices[y, x]]
                row_parts.append(f"{{{rc},{gc},{bc}}}")
            lines.append("  {" + ",".join(row_parts) + "},")
        lines.append("};")
    else:
        # rgb8/rgb9 — emit palette RGB
        pal = result["palette"]
        lines.append("// Each entry: {r, g, b} (0 or 255)")
        lines.append(f"uint8_t img_data[{H}][{W}][3] = {{")
        for y in range(H):
            row_parts = []
            for x in range(W):
                r, g, b = pal[indices[y, x]]
                row_parts.append(f"{{{r},{g},{b}}}")
            lines.append("  {" + ",".join(row_parts) + "},")
        lines.append("};")
    return "\n".join(lines)


def _emit_json(mode: str, result: dict) -> str:
    indices = result["indices"]
    codes = result["level_codes"]
    pal = result["palette"]
    H, W = indices.shape
    rows = []
    for y in range(H):
        row = []
        for x in range(W):
            idx = int(indices[y, x])
            entry: dict = {"palette_index": idx, "rgb": list(map(int, pal[idx]))}
            if codes is not None:
                rc, gc, bc = codes[idx]
                entry["codes"] = [rc, gc, bc]
            row.append(entry)
        rows.append(row)
    return json.dumps({"mode": mode, "width": W, "height": H, "pixels": rows}, indent=2)


def _process_one(img: Image.Image, mode: str, width: int, height: int,
                 gamma: bool, dither: bool, preview_scale: int, emit: str) -> dict:
    result = quantize(img, width, height, mode, gamma=gamma, dither=dither)
    label = build_label(mode, width, height, gamma, dither)

    preview_png = _img_to_b64_png(_upscale(result["quantized_img"], preview_scale))
    raw_png = _img_to_b64_png(result["quantized_img"])

    data_text = None
    data_filename = None
    if emit == "c":
        data_text = _emit_c(mode, result)
        data_filename = f"image_{mode}.h"
    elif emit == "json":
        data_text = _emit_json(mode, result)
        data_filename = f"image_{mode}.json"

    return {
        "label": label,
        "mode": mode,
        "colors": _mode_color_count(mode),
        "width": width,
        "height": height,
        "gamma": gamma,
        "dither": dither,
        "preview_png_b64": preview_png,
        "raw_png_b64": raw_png,
        "data_text": data_text,
        "data_filename": data_filename,
    }


@app.route("/api/quantize", methods=["POST"])
def api_quantize():
    try:
        # --- validate image ---
        if "image" not in request.files:
            return jsonify({"error": "No image file provided"}), 400
        file = request.files["image"]
        try:
            img = Image.open(file.stream).convert("RGB")
        except Exception:
            return jsonify({"error": "Could not decode image file"}), 400

        # --- validate params ---
        def _int(key, lo=1, hi=32768):
            val = request.form.get(key, "")
            try:
                v = int(val)
            except ValueError:
                raise ValueError(f"'{key}' must be an integer, got {val!r}")
            if not (lo <= v <= hi):
                raise ValueError(f"'{key}' must be between {lo} and {hi}, got {v}")
            return v

        width = _int("width", 1, 8192)
        height = _int("height", 1, 8192)
        preview_scale = _int("preview_scale", 1, 64)

        mode_raw = request.form.get("mode", "rgb8")
        valid_modes = MODES + ["all"]
        if mode_raw not in valid_modes:
            return jsonify({"error": f"mode must be one of {valid_modes}"}), 400

        gamma = request.form.get("gamma", "false").lower() in ("1", "true", "yes")
        dither = request.form.get("dither", "false").lower() in ("1", "true", "yes")

        emit = request.form.get("emit", "none")
        if emit not in ("none", "c", "json"):
            return jsonify({"error": "emit must be none, c, or json"}), 400

        modes_to_run = MODES if mode_raw == "all" else [mode_raw]
        results = [
            _process_one(img, m, width, height, gamma, dither, preview_scale, emit)
            for m in modes_to_run
        ]
        return jsonify(results)

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Internal error: {type(e).__name__}: {e}"}), 500


def _open_browser():
    webbrowser.open(f"http://127.0.0.1:{PORT}/")


if __name__ == "__main__":
    threading.Timer(0.8, _open_browser).start()
    app.run(host="127.0.0.1", port=PORT, debug=False)
