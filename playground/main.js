// Playground wiring for the liveness SDK.
// Imports the BUILT SDK from ../dist — run `npm run build` (or `npm run dev`)
// before opening this page. MediaPipe is resolved via the import map in index.html.
import {
  LivenessDetector,
  attachCamera,
  stopCamera,
  DEFAULT_ASSETS,
} from "../dist/index.js";

const $ = (id) => document.getElementById(id);

const els = {
  video: $("video"),
  canvas: $("canvas"),
  phasePill: $("phasePill"),
  hint: $("hint"),
  startBtn: $("startBtn"),
  captureBtn: $("captureBtn"),
  challengeBtn: $("challengeBtn"),
  abortBtn: $("abortBtn"),
  resetBtn: $("resetBtn"),
  cfgMode: $("cfgMode"),
  cfgDelay: $("cfgDelay"),
  cfgAutoStart: $("cfgAutoStart"),
  cfgCount: $("cfgCount"),
  cfgTimeout: $("cfgTimeout"),
  cfgBlur: $("cfgBlur"),
  chips: $("challengeChips"),
  mBlur: $("mBlur"),
  mBright: $("mBright"),
  mFace: $("mFace"),
  mCenter: $("mCenter"),
  refThumb: $("refThumb"),
  log: $("log"),
  payload: $("payload"),
  banner: $("banner"),
};

let detector = null;
let stream = null;

function log(msg, obj) {
  const time = new Date().toLocaleTimeString();
  const line = obj !== undefined ? `${msg} ${JSON.stringify(obj)}` : msg;
  els.log.textContent += `[${time}] ${line}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.style.display = "block";
}

function setMetric(el, value, ok) {
  el.querySelector(".v").textContent = value;
  el.classList.toggle("ok", ok === true);
  el.classList.toggle("bad", ok === false);
}

function renderChips(list, activeIndex = -1, doneCount = 0) {
  els.chips.innerHTML = "";
  list.forEach((c, i) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (i < doneCount) chip.classList.add("done");
    else if (i === activeIndex) chip.classList.add("active");
    chip.textContent = c;
    els.chips.appendChild(chip);
  });
}

function setRunning(running) {
  els.startBtn.disabled = running;
  els.abortBtn.disabled = !running;
  els.resetBtn.disabled = running;
  [
    els.cfgMode,
    els.cfgDelay,
    els.cfgAutoStart,
    els.cfgCount,
    els.cfgTimeout,
    els.cfgBlur,
  ].forEach((i) => (i.disabled = running));
  if (!running) {
    els.captureBtn.disabled = true;
    els.challengeBtn.disabled = true;
  }
}

async function start() {
  els.banner.style.display = "none";
  els.log.textContent = "";
  els.payload.textContent = "—";
  els.refThumb.style.display = "none";

  const mode = els.cfgMode.value; // "auto" | "manual"
  const config = {
    challengeCount: Number(els.cfgCount.value) || 3,
    timeoutMs: Number(els.cfgTimeout.value) || 0,
    thresholds: { blurVariance: Number(els.cfgBlur.value) || 100, faceScaleMin: 0.2 },
    referenceCapture: {
      mode,
      delayMs: Number(els.cfgDelay.value) || 0,
      requireHold: true,
    },
    autoStartChallenges: els.cfgAutoStart.checked,
    // Uses public CDN assets by default (DEFAULT_ASSETS). Self-host in prod.
    landmarker: {
      wasmBasePath: DEFAULT_ASSETS.wasmBasePath,
      modelAssetPath: DEFAULT_ASSETS.faceLandmarkerModelUrl,
    },
  };

  detector = new LivenessDetector(els.video, els.canvas, config);

  detector.on("phase", (p) => {
    els.phasePill.textContent = p;
    log(`phase → ${p}`);
    // Manual capture is only offered while holding alignment.
    if (p !== "aligned") els.captureBtn.disabled = true;
    // Manual challenge start is offered once the reference is captured.
    els.challengeBtn.disabled = p !== "awaiting-challenge-start";
  });

  detector.on("alignment", (a) => {
    // In the "aligned" phase, the manual-capture button tracks whether the
    // face is still aligned right now (requireHold gate).
    if (detector.getPhase() === "aligned" && mode === "manual") {
      els.captureBtn.disabled = !detector.isAligned();
      els.hint.textContent = detector.isAligned()
        ? "Hold still — press Capture when ready"
        : a.hint;
    } else {
      els.hint.textContent = a.hint;
    }
    setMetric(els.mBlur, a.metrics.blurVariance.toFixed(1), a.metrics.blurVariance >= config.thresholds.blurVariance);
    setMetric(els.mBright, a.metrics.brightness.toFixed(0), a.metrics.brightness >= 40 && a.metrics.brightness <= 210);
    setMetric(els.mFace, a.scaleOk ? "in range" : "adjust", a.scaleOk);
    setMetric(els.mCenter, a.centered ? "yes" : "no", a.centered);
  });

  detector.on("align-ready", ({ mode: m, delayMs }) => {
    log("align-ready", { mode: m, delayMs });
    if (m === "manual") {
      els.captureBtn.disabled = !detector.isAligned();
      els.hint.textContent = "Aligned — press Capture when ready";
    }
  });

  detector.on("capture-countdown", ({ remainingMs }) => {
    if (remainingMs > 0) {
      els.hint.textContent = `Hold still… capturing in ${(remainingMs / 1000).toFixed(1)}s`;
    }
  });

  detector.on("reference-captured", ({ image, metrics }) => {
    els.captureBtn.disabled = true;
    els.refThumb.src = image;
    els.refThumb.style.display = "block";
    log("reference captured", { blurVariance: +metrics.blurVariance.toFixed(1), brightness: +metrics.brightness.toFixed(0) });
  });

  detector.on("awaiting-challenge-start", ({ challenges }) => {
    renderChips(challenges, -1, 0);
    els.hint.textContent = "Reference captured — press Start challenges";
    log("awaiting challenge start", { challenges });
  });

  let queue = [];
  detector.on("challenge-start", ({ challenge, index, total }) => {
    if (queue.length !== total) queue = new Array(total).fill("?");
    queue[index] = challenge;
    renderChips(queue, index, index);
    els.hint.textContent = `Please: ${challenge}`;
    log(`challenge ${index + 1}/${total} → ${challenge}`);
  });

  detector.on("challenge-pass", (ev) => {
    log(`✓ passed ${ev.challenge}`);
  });

  try {
    setRunning(true);
    els.hint.textContent = "Requesting camera…";
    stream = await attachCamera(els.video);

    els.hint.textContent = "Loading model…";
    await detector.init();

    els.hint.textContent = "Align your face";
    const payload = await detector.start();

    renderChips(payload.livenessEvents.map((e) => e.challenge), -1, payload.livenessEvents.length);
    els.hint.textContent = "✅ Liveness complete";
    els.payload.textContent = JSON.stringify(previewPayload(payload), null, 2);
    log("completed", { durationMs: payload.telemetry.totalDurationMs, events: payload.livenessEvents.length });
  } catch (err) {
    const code = err && err.code ? ` [${err.code}]` : "";
    els.hint.textContent = `⚠️ ${err?.message ?? err}`;
    showBanner(`Error${code}: ${err?.message ?? err}`);
    log(`error${code}`, { message: String(err?.message ?? err) });
  } finally {
    setRunning(false);
    els.abortBtn.disabled = true;
  }
}

// Trim the big base64 blobs so the payload preview stays readable.
function previewPayload(p) {
  const trim = (s) => (typeof s === "string" ? `${s.slice(0, 48)}… (${s.length} chars)` : s);
  return {
    ...p,
    referenceImage: trim(p.referenceImage),
    livenessEvents: p.livenessEvents.map((e) => ({ ...e, frameSnapshot: trim(e.frameSnapshot) })),
  };
}

function reset() {
  cleanup();
  els.phasePill.textContent = "idle";
  els.hint.textContent = "Press Start";
  els.refThumb.style.display = "none";
  els.payload.textContent = "—";
  els.chips.innerHTML = "";
  ["mBlur", "mBright", "mFace", "mCenter"].forEach((k) => setMetric(els[k], "—", undefined));
  els.captureBtn.disabled = true;
  els.challengeBtn.disabled = true;
  els.resetBtn.disabled = true;
}

function cleanup() {
  detector?.dispose();
  detector = null;
  stopCamera(stream);
  stream = null;
}

els.startBtn.addEventListener("click", start);
els.captureBtn.addEventListener("click", () => {
  if (detector?.captureReference()) els.captureBtn.disabled = true;
});
els.challengeBtn.addEventListener("click", () => {
  if (detector?.beginChallenges()) els.challengeBtn.disabled = true;
});
els.abortBtn.addEventListener("click", () => detector?.abort());
els.resetBtn.addEventListener("click", reset);
window.addEventListener("beforeunload", cleanup);

// Surface the most common setup mistake early.
if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  showBanner("Camera requires a secure context. Serve over http://localhost or https://.");
}
