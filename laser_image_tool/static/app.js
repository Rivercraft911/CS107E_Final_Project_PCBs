"use strict";

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const dropPrompt = document.getElementById("dropzone-prompt");
const dropPreview = document.getElementById("dropzone-preview");
const thumbImg = document.getElementById("thumbImg");
const imgMeta = document.getElementById("imgMeta");

const resPreset = document.getElementById("resPreset");
const customRes = document.getElementById("customRes");
const customW = document.getElementById("customW");
const customH = document.getElementById("customH");

const colorMode = document.getElementById("colorMode");
const gammaChk = document.getElementById("gammaChk");
const ditherChk = document.getElementById("ditherChk");
const previewScale = document.getElementById("previewScale");
const scaleVal = document.getElementById("scaleVal");
const exportMode = document.getElementById("exportMode");

const renderBtn = document.getElementById("renderBtn");
const errorBanner = document.getElementById("errorBanner");
const results = document.getElementById("results");
const resultsGrid = document.getElementById("resultsGrid");
const spinner = document.getElementById("spinner");

let loadedFile = null;

// --- File loading ---

browseBtn.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("click", (e) => {
  if (e.target === dropzone || e.target.closest(".dropzone-prompt")) fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

function loadFile(file) {
  loadedFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    thumbImg.src = url;
    imgMeta.innerHTML =
      `<strong>${file.name}</strong>` +
      `${img.naturalWidth} × ${img.naturalHeight} px<br>` +
      `${(file.size / 1024).toFixed(1)} KB`;
    dropPrompt.classList.add("hidden");
    dropPreview.classList.remove("hidden");
    renderBtn.disabled = false;
  };
  img.src = url;
}

// --- Resolution preset ---

resPreset.addEventListener("change", () => {
  if (resPreset.value === "custom") {
    customRes.classList.remove("hidden");
  } else {
    customRes.classList.add("hidden");
  }
});

function getResolution() {
  if (resPreset.value === "custom") {
    return { width: parseInt(customW.value, 10), height: parseInt(customH.value, 10) };
  }
  const [w, h] = resPreset.value.split("x").map(Number);
  return { width: w, height: h };
}

// --- Preview scale ---

previewScale.addEventListener("input", () => {
  scaleVal.textContent = previewScale.value + "×";
});

// --- Render ---

renderBtn.addEventListener("click", doRender);

async function doRender() {
  if (!loadedFile) return;

  hideError();
  results.classList.add("hidden");
  spinner.classList.remove("hidden");
  renderBtn.disabled = true;

  const { width, height } = getResolution();
  const fd = new FormData();
  fd.append("image", loadedFile);
  fd.append("width", width);
  fd.append("height", height);
  fd.append("mode", colorMode.value);
  fd.append("gamma", gammaChk.checked ? "true" : "false");
  fd.append("dither", ditherChk.checked ? "true" : "false");
  fd.append("preview_scale", previewScale.value);
  fd.append("emit", exportMode.value);

  try {
    const resp = await fetch("/api/quantize", { method: "POST", body: fd });
    const data = await resp.json();

    if (!resp.ok) {
      showError(data.error || "Unknown server error");
      return;
    }

    renderResults(data);
  } catch (err) {
    showError("Network error: " + err.message);
  } finally {
    spinner.classList.add("hidden");
    renderBtn.disabled = false;
  }
}

function renderResults(items) {
  resultsGrid.innerHTML = "";

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "result-card";

    // Image
    const imgWrap = document.createElement("div");
    imgWrap.className = "card-img-wrap";
    const img = document.createElement("img");
    img.src = "data:image/png;base64," + item.preview_png_b64;
    img.alt = item.label;
    imgWrap.appendChild(img);

    // Body
    const body = document.createElement("div");
    body.className = "card-body";

    const labelDiv = document.createElement("div");
    labelDiv.className = "card-label";
    labelDiv.innerHTML =
      `<strong>${item.mode}</strong>` +
      `${item.colors} colors · ${item.width}×${item.height}` +
      (item.gamma ? " · gamma" : "") +
      (item.dither ? " · dither" : "");
    body.appendChild(labelDiv);

    // Downloads
    const hasExport = item.data_text !== null;
    const dlRow = document.createElement("div");
    dlRow.className = "card-downloads";

    // Always offer raw PNG download
    const rawBtn = makeDlBtn("PNG", item.raw_png_b64, `image_${item.mode}.png`, "image/png", true);
    dlRow.appendChild(rawBtn);

    if (hasExport) {
      const dataBtn = makeDlTextBtn(
        item.data_filename.endsWith(".h") ? "C header" : "JSON",
        item.data_text,
        item.data_filename
      );
      dlRow.appendChild(dataBtn);
    }

    body.appendChild(dlRow);
    card.appendChild(imgWrap);
    card.appendChild(body);
    resultsGrid.appendChild(card);
  }

  results.classList.remove("hidden");
}

function makeDlBtn(label, b64, filename, mime, isBase64) {
  const a = document.createElement("a");
  a.className = "dl-btn";
  a.textContent = "↓ " + label;
  a.download = filename;
  if (isBase64) {
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    a.href = URL.createObjectURL(blob);
  } else {
    a.href = b64;
  }
  return a;
}

function makeDlTextBtn(label, text, filename) {
  const a = document.createElement("a");
  a.className = "dl-btn";
  a.textContent = "↓ " + label;
  a.download = filename;
  const blob = new Blob([text], { type: "text/plain" });
  a.href = URL.createObjectURL(blob);
  return a;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove("hidden");
}

function hideError() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}
