"use strict";

const $ = id => document.getElementById(id);

const dropzone  = $("dropzone");
const fileInput = $("fileInput");
const browseBtn = $("browseBtn");
const changeBtn = $("changeBtn");
const dzIdle    = $("dzIdle");
const dzLoaded  = $("dzLoaded");
const thumbImg  = $("thumbImg");
const imgMeta   = $("imgMeta");

const resPreset  = $("resPreset");
const customRes  = $("customRes");
const customW    = $("customW");
const customH    = $("customH");
const colorMode  = $("colorMode");
const gammaChk   = $("gammaChk");
const ditherChk  = $("ditherChk");
const exportMode = $("exportMode");

const renderBtn   = $("renderBtn");
const errorBanner = $("errorBanner");
const emptyState  = $("emptyState");
const spinner     = $("spinner");
const resultsWrap = $("resultsWrap");
const resultsGrid = $("resultsGrid");

let loadedFile = null;

// ── Pip colors matching CSS pills ──────────────────────────────────────────
const MODE_PIP = {
  rgb8:   "#3ecf8e",
  rgb9:   "#f5c947",
  rgb64:  "#5baaef",
  rgb4096:"#b59ef7",
};

// ── File loading ───────────────────────────────────────────────────────────

browseBtn.addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
changeBtn.addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener("click", () => { if (!loadedFile) fileInput.click(); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("over"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

function loadFile(file) {
  loadedFile = file;
  const url = URL.createObjectURL(file);
  const probe = new Image();
  probe.onload = () => {
    thumbImg.src = url;
    imgMeta.innerHTML =
      `<strong>${file.name}</strong>` +
      `${probe.naturalWidth} × ${probe.naturalHeight}&ensp;·&ensp;${(file.size / 1024).toFixed(1)} KB`;
    dzIdle.classList.add("hidden");
    dzLoaded.classList.remove("hidden");
    renderBtn.disabled = false;
    emptyState.classList.add("hidden");
  };
  probe.src = url;
}

// ── Resolution ─────────────────────────────────────────────────────────────

resPreset.addEventListener("change", () => {
  customRes.classList.toggle("hidden", resPreset.value !== "custom");
});

function getResolution() {
  if (resPreset.value === "custom") {
    return { width: parseInt(customW.value, 10), height: parseInt(customH.value, 10) };
  }
  const [w, h] = resPreset.value.split("x").map(Number);
  return { width: w, height: h };
}

// ── Render ─────────────────────────────────────────────────────────────────

renderBtn.addEventListener("click", doRender);

async function doRender() {
  if (!loadedFile) return;

  hideError();
  resultsWrap.classList.add("hidden");
  spinner.classList.remove("hidden");
  renderBtn.disabled = true;

  const { width, height } = getResolution();
  const fd = new FormData();
  fd.append("image", loadedFile);
  fd.append("width", width);
  fd.append("height", height);
  fd.append("mode", colorMode.value);
  fd.append("gamma",  gammaChk.checked  ? "true" : "false");
  fd.append("dither", ditherChk.checked ? "true" : "false");
  fd.append("preview_scale", "1");   // we CSS-scale to fill card width
  fd.append("emit", exportMode.value);

  try {
    const resp = await fetch("/api/quantize", { method: "POST", body: fd });
    const data = await resp.json();
    if (!resp.ok) { showError(data.error || "Server error"); return; }
    buildCards(data);
  } catch (err) {
    showError("Network error: " + err.message);
  } finally {
    spinner.classList.add("hidden");
    renderBtn.disabled = false;
  }
}

// ── Build result cards ─────────────────────────────────────────────────────

function buildCards(items) {
  resultsGrid.innerHTML = "";

  for (const item of items) {
    const card = make("div", "card");

    // ── header ──
    const hdr = make("div", "card-header");
    const pip = make("div", "mode-pip");
    pip.style.background = MODE_PIP[item.mode] ?? "#888";

    const title = make("div", "card-title");
    title.textContent = item.mode;

    const sub = make("div", "card-sub");
    sub.textContent = `${item.width} × ${item.height}`;

    hdr.append(pip, title, sub);

    // ── image ──
    const imgWrap = make("div", "card-img");
    const img = make("img");
    img.src = "data:image/png;base64," + item.raw_png_b64;
    img.alt = item.label;
    imgWrap.appendChild(img);

    // ── footer ──
    const foot = make("div", "card-foot");

    foot.appendChild(pill(item.mode, `pill pill-${item.mode}`));
    foot.appendChild(pill(`${item.colors} colors`, "pill pill-info"));
    if (item.gamma)  foot.appendChild(pill("gamma",  "pill pill-active"));
    if (item.dither) foot.appendChild(pill("dither", "pill pill-active"));

    const actions = make("div", "card-actions");
    actions.appendChild(dlPng(item.raw_png_b64, `laser_${item.mode}.png`));
    if (item.data_text !== null) {
      const ext = item.data_filename.endsWith(".h") ? ".h" : "JSON";
      actions.appendChild(dlText(ext, item.data_text, item.data_filename));
    }
    foot.appendChild(actions);

    card.append(hdr, imgWrap, foot);
    resultsGrid.appendChild(card);
  }

  resultsWrap.classList.remove("hidden");
  // scroll main to top so results are visible
  document.getElementById("main").scrollTo({ top: 0, behavior: "smooth" });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function make(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

function pill(text, cls) {
  const el = make("span", cls);
  el.textContent = text;
  return el;
}

function dlPng(b64, filename) {
  const a = make("a", "dl-btn");
  a.textContent = "↓ PNG";
  a.download = filename;
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  a.href = URL.createObjectURL(new Blob([arr], { type: "image/png" }));
  return a;
}

function dlText(label, text, filename) {
  const a = make("a", "dl-btn");
  a.textContent = "↓ " + label;
  a.download = filename;
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  return a;
}

function showError(msg) { errorBanner.textContent = msg; errorBanner.classList.remove("hidden"); }
function hideError()    { errorBanner.classList.add("hidden"); }
