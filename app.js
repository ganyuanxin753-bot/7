const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const bgm = document.getElementById("bgm");
const tapHint = document.getElementById("tapHint");
const audioStatus = document.getElementById("audioStatus");
const cameraStatus = document.getElementById("cameraStatus");
const motionStatus = document.getElementById("motionStatus");

const COLS = 10;
const ROWS = 20;
const MAX_CELL = 24;
const MOTION_SAMPLE_W = 160;
const MOTION_SAMPLE_H = 120;
const MOTION_DIFF_THRESHOLD = 34;
const MOTION_PIXELS_THRESHOLD = 760;
const MOTION_TRIGGER_COOLDOWN_MS = 760;

const palette = ["#d8c29d", "#c8d8b1", "#d5b9a8", "#b8d4df", "#d8cf8f", "#c7b3a2"];
const SHAPES = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]]
];

const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

let currentPiece = null;
let cell = 24;
let dpr = window.devicePixelRatio || 1;
let gameFinished = false;
let lastMotionTriggerAt = 0;
let lastMotionLabel = "";

const motionVideo = document.createElement("video");
motionVideo.setAttribute("playsinline", "true");
motionVideo.setAttribute("muted", "true");
motionVideo.muted = true;

const motionCanvas = document.createElement("canvas");
motionCanvas.width = MOTION_SAMPLE_W;
motionCanvas.height = MOTION_SAMPLE_H;
const motionCtx = motionCanvas.getContext("2d", { willReadFrequently: true });
let previousGrayFrame = null;
let cameraReady = false;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  const nextCell = Math.floor(Math.min(rect.width / COLS, rect.height / ROWS, MAX_CELL));
  if (!nextCell) return;
  cell = nextCell;
  canvas.width = Math.floor(cell * COLS * dpr);
  canvas.height = Math.floor(cell * ROWS * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function randomPiece() {
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return {
    shape,
    color: palette[Math.floor(Math.random() * palette.length)],
    x: Math.floor((COLS - shape[0].length) / 2),
    y: -1
  };
}

function rotateMatrix(shape) {
  const rows = shape.length;
  const cols = shape[0].length;
  const rotated = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      rotated[x][rows - 1 - y] = shape[y][x];
    }
  }
  return rotated;
}

function canMove(piece, dx, dy, shape = piece.shape) {
  for (let y = 0; y < shape.length; y += 1) {
    for (let x = 0; x < shape[y].length; x += 1) {
      if (!shape[y][x]) continue;
      const nextX = piece.x + x + dx;
      const nextY = piece.y + y + dy;
      if (nextX < 0 || nextX >= COLS || nextY >= ROWS) return false;
      if (nextY >= 0 && board[nextY][nextX]) return false;
    }
  }
  return true;
}

function spawn() {
  if (gameFinished) return;
  currentPiece = randomPiece();

  if (!canMove(currentPiece, 0, 0)) {
    gameFinished = true;
    currentPiece = null;
    motionStatus.textContent = "已落满";
    return;
  }
}

function move(dx) {
  if (!currentPiece || gameFinished) return;
  if (canMove(currentPiece, dx, 0)) {
    currentPiece.x += dx;
  }
}

function rotatePiece() {
  if (!currentPiece || gameFinished) return;
  const nextShape = rotateMatrix(currentPiece.shape);
  if (canMove(currentPiece, 0, 0, nextShape)) {
    currentPiece.shape = nextShape;
  }
}

function lockPiece(piece) {
  for (let y = 0; y < piece.shape.length; y += 1) {
    for (let x = 0; x < piece.shape[y].length; x += 1) {
      if (!piece.shape[y][x]) continue;
      const boardY = piece.y + y;
      const boardX = piece.x + x;
      if (boardY >= 0) board[boardY][boardX] = piece.color;
    }
  }
}

function stepDown() {
  if (!currentPiece || gameFinished) return;
  if (canMove(currentPiece, 0, 1)) {
    currentPiece.y += 1;
    return;
  }

  lockPiece(currentPiece);
  spawn();
}

function drawCell(x, y, color) {
  const px = x * cell + 1;
  const py = y * cell + 1;
  const size = cell - 2;
  const radius = Math.max(2, Math.floor(cell * 0.22));

  roundRectPath(px, py, size, size, radius);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.strokeStyle = "rgba(88, 70, 52, 0.26)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.save();
  roundRectPath(px, py, size, size, radius);
  ctx.clip();

  const gloss = ctx.createLinearGradient(px, py, px, py + size * 0.7);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(px, py, size, size);

  ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
  ctx.beginPath();
  ctx.ellipse(px + size * 0.32, py + size * 0.28, size * 0.16, size * 0.11, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRectPath(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(122, 106, 88, 0.2)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, ROWS * cell);
    ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(COLS * cell, y * cell + 0.5);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, COLS * cell, ROWS * cell);
  drawGrid();

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (board[y][x]) drawCell(x, y, board[y][x]);
    }
  }

  if (!currentPiece) return;
  currentPiece.shape.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value) drawCell(currentPiece.x + x, currentPiece.y + y, currentPiece.color);
    });
  });
}

function startRenderLoop() {
  const loop = () => {
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function setupAudio() {
  bgm.volume = 0.42;
  bgm.addEventListener("playing", () => {
    audioStatus.textContent = "播放中";
  });
  bgm.addEventListener("waiting", () => {
    audioStatus.textContent = "缓冲中";
  });
  bgm.addEventListener("stalled", () => {
    audioStatus.textContent = "网络慢";
  });
  bgm.addEventListener("error", () => {
    audioStatus.textContent = "音频异常";
  });
}

function startAudio() {
  audioStatus.textContent = "启动中";
  return bgm.play();
}

function showHint() {
  tapHint.classList.add("show");
}

function hideHint() {
  tapHint.classList.remove("show");
}

function updateMotionText(nextLabel) {
  if (lastMotionLabel === nextLabel) return;
  lastMotionLabel = nextLabel;
  motionStatus.textContent = nextLabel;
}

function getUserMediaCompat(constraints) {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (!legacy) return Promise.reject(new Error("getUserMedia not supported"));
  return new Promise((resolve, reject) => {
    legacy.call(navigator, constraints, resolve, reject);
  });
}

async function startCamera() {
  if (cameraReady) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    cameraStatus.textContent = "需 HTTPS";
    updateMotionText("键盘模式");
    return;
  }

  cameraStatus.textContent = "请求授权";
  try {
    const stream = await getUserMediaCompat({
      video: {
        facingMode: "environment",
        width: { ideal: 640 },
        height: { ideal: 360 }
      },
      audio: false
    });
    motionVideo.srcObject = stream;
    await motionVideo.play();
    cameraReady = true;
    cameraStatus.textContent = "已连接";
    updateMotionText("等待动作");
  } catch (error) {
    cameraStatus.textContent = "不可用";
    updateMotionText("键盘模式");
  }
}

function triggerByMotion(centroidX) {
  if (!currentPiece || gameFinished) return;
  const now = Date.now();
  if (now - lastMotionTriggerAt < MOTION_TRIGGER_COOLDOWN_MS) return;
  lastMotionTriggerAt = now;

  if (centroidX < 0.38) {
    move(-1);
    updateMotionText("检测到左移");
  } else if (centroidX > 0.62) {
    move(1);
    updateMotionText("检测到右移");
  } else {
    updateMotionText("检测到动作");
  }
  stepDown();
}

function processMotionFrame() {
  if (!cameraReady || !motionCtx || motionVideo.readyState < 2 || document.hidden) return;
  motionCtx.drawImage(motionVideo, 0, 0, MOTION_SAMPLE_W, MOTION_SAMPLE_H);
  const frameData = motionCtx.getImageData(0, 0, MOTION_SAMPLE_W, MOTION_SAMPLE_H).data;
  const pixelCount = MOTION_SAMPLE_W * MOTION_SAMPLE_H;
  const grayFrame = new Uint8Array(pixelCount);

  let motionPixels = 0;
  let sumX = 0;

  for (let i = 0, px = 0; i < frameData.length; i += 4, px += 1) {
    const gray = (frameData[i] * 3 + frameData[i + 1] * 4 + frameData[i + 2]) >> 3;
    grayFrame[px] = gray;
    if (!previousGrayFrame) continue;
    const diff = Math.abs(gray - previousGrayFrame[px]);
    if (diff > MOTION_DIFF_THRESHOLD) {
      motionPixels += 1;
      sumX += px % MOTION_SAMPLE_W;
    }
  }

  previousGrayFrame = grayFrame;
  if (motionPixels < MOTION_PIXELS_THRESHOLD) return;
  const centroidX = (sumX / motionPixels) / MOTION_SAMPLE_W;
  triggerByMotion(centroidX);
}

function setupInputAndMedia() {
  setupAudio();

  cameraStatus.textContent = "待启动";
  updateMotionText("等待中");

  function onUserGesture() {
    hideHint();
    startAudio().catch(() => {
      audioStatus.textContent = "需点击";
      showHint();
    });
    startCamera();
    window.removeEventListener("pointerdown", onUserGesture);
  }

  startAudio().catch(() => {
    audioStatus.textContent = "需点击";
    showHint();
  });
  startCamera();

  window.addEventListener("pointerdown", onUserGesture);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && bgm.paused) {
      bgm.play().catch(() => {
        audioStatus.textContent = "需点击";
        showHint();
      });
    }
  });

  window.addEventListener("keydown", (event) => {
    if (!currentPiece || gameFinished) return;
    if (event.key === "ArrowLeft") {
      move(-1);
      stepDown();
      updateMotionText("键盘左移");
    } else if (event.key === "ArrowRight") {
      move(1);
      stepDown();
      updateMotionText("键盘右移");
    } else if (event.key === "ArrowUp") {
      rotatePiece();
      stepDown();
      updateMotionText("键盘旋转");
    } else if (event.key === "ArrowDown" || event.key === " ") {
      stepDown();
      updateMotionText("键盘下落");
    }
  });
}

spawn();
startRenderLoop();
setupInputAndMedia();
resizeCanvas();

window.addEventListener("resize", resizeCanvas);
window.setInterval(processMotionFrame, 110);
