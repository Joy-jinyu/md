/** 水渍画在 #desk-base 上，只在改尺寸时画一次；#desk-art 叠在上面，每帧重画四角植物和落花 */
const deskBase = document.querySelector("#desk-base");
const desk = document.querySelector("#desk-art");
const screen = desk.getContext("2d");
/** 下面的画法函数都画在 ink 上；画缓存层时 paint() 临时把它指向离屏画布 */
let ink = screen;

function paletteNoise(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function stain(rng, x, y, rx, ry, tint) {
  for (let pass = 0; pass < 6; pass++) {
    const ox = x + (rng() - 0.5) * rx * 0.27,
      oy = y + (rng() - 0.5) * ry * 0.27;
    const pigment = ink.createRadialGradient(
      ox,
      oy,
      0,
      ox,
      oy,
      Math.max(rx, ry),
    );
    pigment.addColorStop(0, tint + "18");
    pigment.addColorStop(0.61, tint + "0d");
    pigment.addColorStop(1, tint + "00");
    ink.beginPath();
    for (let i = 0; i <= 52; i++) {
      const angle = (i / 52) * Math.PI * 2;
      const rough = 0.8 + Math.sin(angle * 5 + pass) * 0.11 + rng() * 0.095;
      const px = ox + Math.cos(angle) * rx * rough;
      const py = oy + Math.sin(angle) * ry * rough;
      if (i === 0) ink.moveTo(px, py);
      else ink.lineTo(px, py);
    }
    ink.closePath();
    ink.fillStyle = pigment;
    ink.fill();
  }
}

function stem(points, color, width) {
  ink.beginPath();
  ink.moveTo(points[0], points[1]);
  ink.bezierCurveTo(...points.slice(2));
  ink.strokeStyle = color;
  ink.lineWidth = width;
  ink.lineCap = "round";
  ink.stroke();
}

function leaf(x, y, angle, length, width, shift, color, vein) {
  ink.save();
  ink.translate(x, y);
  ink.rotate(angle);
  ink.beginPath();
  ink.moveTo(0, 0);
  ink.bezierCurveTo(
    length * 0.18,
    -width * 0.7,
    length * 0.7,
    -width * 0.55,
    length,
    shift,
  );
  ink.bezierCurveTo(
    length * 0.64,
    width * 0.52,
    length * 0.28,
    width * 0.5,
    0,
    0,
  );
  ink.fillStyle = color;
  ink.fill();
  stem(
    [
      0,
      0,
      length * 0.41,
      -width * 0.05,
      length * 0.65,
      shift * 0.22,
      length * 0.94,
      shift * 0.85,
    ],
    vein,
    0.85,
  );
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    stem(
      [
        length * t,
        shift * t * 0.8,
        length * (t + 0.04),
        -width * 0.09,
        length * (t + 0.08),
        -width * 0.2,
        length * (t + 0.12),
        -width * 0.3 + shift * t,
      ],
      vein,
      0.48,
    );
    stem(
      [
        length * t,
        shift * t * 0.8,
        length * (t + 0.04),
        width * 0.06,
        length * (t + 0.08),
        width * 0.19,
        length * (t + 0.095),
        width * 0.26 + shift * t,
      ],
      vein,
      0.44,
    );
  }
  ink.restore();
}

function reed(rng, x, y, angle, size, tones) {
  ink.save();
  ink.translate(x, y);
  ink.rotate(angle);
  ink.scale(size, size);
  stem([0, 0, 14, 58, 38, 163, 102, 254], tones[2], 1.9);
  for (let i = 0; i < 13; i++) {
    const t = 0.13 + i * 0.066;
    const px = 5 * t + 97 * t * t;
    const py = 252 * t;
    const size = (43 + Math.sin(t * Math.PI) * 55) * (1 - t * 0.45);
    leaf(
      px,
      py,
      2.73 - t * 0.36,
      size,
      13 + rng() * 10,
      -12,
      tones[i % 2],
      tones[2],
    );
    if (i > 1)
      leaf(
        px + 3,
        py + 4,
        0.15 + t * 0.47,
        size * 0.93,
        13 + rng() * 9,
        10,
        tones[(i + 1) % 2],
        tones[2],
      );
  }
  ink.restore();
}

function flower(rng, x, y, angle, scale) {
  ink.save();
  ink.translate(x, y);
  ink.rotate(angle);
  ink.scale(scale, scale);
  for (let i = 0; i < 5; i++) {
    ink.rotate((Math.PI * 2) / 5);
    ink.beginPath();
    ink.moveTo(0, 0);
    ink.bezierCurveTo(-22, -14, -24, -40, -6, -41);
    ink.bezierCurveTo(11, -51, 23, -24, 0, 0);
    ink.fillStyle = ["#c0a68834", "#b9947c2c", "#d5ac822f"][i % 3];
    ink.fill();
    ink.strokeStyle = "#82694b29";
    ink.lineWidth = 0.75;
    ink.stroke();
    for (let j = 0; j < 4; j++)
      stem(
        [0, -2, rng() * 12 - 6, -10, -9, -18, rng() * 21 - 10, -34],
        "#9f7b5827",
        0.62,
      );
  }
  for (let j = 0; j < 22; j++) {
    ink.fillStyle = j % 2 ? "#8f694957" : "#a7834e61";
    ink.beginPath();
    ink.ellipse(
      (rng() - 0.5) * 15,
      (rng() - 0.5) * 15,
      0.75 + rng(),
      0.8 + rng(),
      0,
      0,
      Math.PI * 2,
    );
    ink.fill();
  }
  ink.restore();
}

function sprig(rng, x, y, scale, angle) {
  ink.save();
  ink.translate(x, y);
  ink.rotate(angle);
  ink.scale(scale, scale);
  stem([0, 0, 16, -108, 28, -183, 90, -259], "#67664f7e", 2);
  stem([26, -132, 45, -146, 73, -158, 111, -214], "#67664f79", 1.3);
  stem([32, -155, 25, -174, 14, -184, -9, -214], "#67664f72", 1.2);
  leaf(10, -77, -2.5, 88, 33, -1, "#9da68d45", "#62675355");
  leaf(17, -111, -0.64, 90, 39, -11, "#7e947545", "#586d5150");
  leaf(61, -177, -0.83, 70, 31, -4, "#8a946f3d", "#52665255");
  leaf(49, -198, -2.76, 72, 28, 2, "#8a997841", "#566a4e4a");
  flower(rng, 90, -259, 0.34, 0.78);
  flower(rng, 110, -215, 0.1, 0.55);
  flower(rng, -9, -214, 0.42, 0.61);
  ink.restore();
}

/* ---------- 四角植物会动：微风、指针拨叶、点击落花、翻页带风、偶尔自己落一片（DESIGN.md「Web landing page」） ---------- */

const stage = document.querySelector("#stage");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(pointer: fine)");
/** 命中格子的边长（CSS 像素）：只用来判断指针落没落在叶子上，粗一点就够 */
const CELL = 12;
const MAX_PIECES = 24;
/** 弹簧：角度回到目标的力度和阻尼（每秒）。约 0.6 Hz、略欠阻尼，拨开、抖动后慢慢晃回来 */
const STIFF = 14;
const DAMP = 3.4;
/** 微风摆幅约 ±1.3°，指针拨开最多再加 4° 左右，总角度不超过 7° */
const BREEZE = 0.026;
const PUSH = 0.07;
const MAX_ANGLE = 0.12;
/** 每组按到根部的距离切成几圈：外圈转得多、晚一点跟上（风从根传到梢要 LAG 秒），植物看起来是弯的而不是一块板在转 */
const BANDS = 7;
const LAG = 0.7;
const TAU = Math.PI * 2;
/** 落花：重力、最大下落速度、空中打转的快慢和左右飘的幅度、点击处多远内的叶子会掉，都是对着画面手调的值 */
const GRAVITY = 38;
const FALL_SPEED = { leaf: 34, petal: 26 };
const FLUTTER_RATE = 2.4;
const FLUTTER_DRIFT = 14;
const DROP_RADIUS = 70;
/** 指针离一组植物中心多远开始拨动：这组外接框对角线的 0.55 倍 */
const BRUSH_REACH = 0.55;
/** 按下到松开移动超过这么多（CSS 像素）就算拖动或滚动，不算点 */
const TAP_SLOP = 10;
const PETALS = ["#c9a98ac4", "#bd987eb8", "#d8b28abd"];
const LEAVES = ["#8a9978b8", "#7e9475b0", "#9da68db0"];

let view = null;
let frame = 0;
let last = 0;
let onScreen = true;
let nextDrift = 0;
const pieces = [];
const pointer = { clientX: 0, clientY: 0, x: 0, y: 0, inside: false };
let press = null;
let turned = false;

/**
 * 在离屏画布上画，画完 ink 指回屏幕。margin：四周多画一圈（CSS 像素），旋转时屏幕外的茎才不会露出断口。
 * 不开 willReadFrequently：那样画在 CPU 画布上，细叶脉的抗锯齿和原来一次画完的不一样（实测最多差 40/255）；crop 只读一次，慢一点无妨
 */
function paint(w, h, density, draw, margin = 0, canvas = document.createElement("canvas")) {
  canvas.width = Math.round((w + margin * 2) * density);
  canvas.height = Math.round((h + margin * 2) * density);
  ink = canvas.getContext("2d");
  ink.scale(density, density);
  ink.translate(margin, margin);
  try {
    draw();
  } finally {
    ink = screen;
  }
  return canvas;
}

/** 裁到有颜色的范围（外框看任何不透明度，再放宽 2 像素，免得淡边被裁掉），顺便按格子记下有叶子的地方，坐标换回屏幕的。margin 要是 CELL 的整数倍 */
function crop(canvas, density, margin, w, h) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const cols = Math.ceil(width / density / CELL);
  const grid = new Uint8Array(cols * Math.ceil(height / density / CELL));
  const box = { x0: width, y0: height, x1: -1, y1: -1 };
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (!alpha) continue;
      box.x0 = Math.min(box.x0, x);
      box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x);
      box.y1 = Math.max(box.y1, y);
      if (alpha >= 12) grid[Math.floor(y / density / CELL) * cols + Math.floor(x / density / CELL)] = 1;
    }
  }
  if (box.x1 < 0) return null;
  const x0 = Math.max(0, box.x0 - 2),
    y0 = Math.max(0, box.y0 - 2);
  const part = document.createElement("canvas");
  part.width = Math.min(width, box.x1 + 3) - x0;
  part.height = Math.min(height, box.y1 + 3) - y0;
  part.getContext("2d").drawImage(canvas, x0, y0, part.width, part.height, 0, 0, part.width, part.height);
  const shift = margin / CELL;
  const filled = [...grid.keys()].filter((i) => grid[i]).map((i) => [(i % cols) - shift, Math.floor(i / cols) - shift]);
  const cells = new Set(filled.map(([cx, cy]) => `${cx},${cy}`));
  const spots = filled
    .map(([cx, cy]) => [(cx + 0.5) * CELL, (cy + 0.5) * CELL])
    .filter(([x, y]) => x > 0 && x < w && y > 0 && y < h);
  return { canvas: part, x: x0 / density - margin, y: y0 / density - margin, w: part.width / density, h: part.height / density, cells, spots };
}

/** 四角各一组，顺序和以前一次画完时一样（rng 按顺序取数，换顺序花叶就变样）。pivot 是茎的根部，side 是左右 */
function cornerGroups(w, h, rng, botanical, mobile) {
  const olive = ["#71826547", "#919d7e48", "#6d7b5f5a"];
  const slate = ["#718e8646", "#9aa67d43", "#6b806858"];
  return [
    { kind: "leaf", side: -1, pivot: [30, -60], draw() {
      reed(rng, mobile ? -13 : 13, -58, -0.69, botanical * 1.2, olive);
      reed(rng, mobile ? 11 : 58, -65, -0.34, botanical * 0.96, slate);
    } },
    { kind: "petal", side: 1, pivot: [w, h * 0.15], draw() {
      reed(rng, w * 0.99 + 26, h * 0.025, -0.06, botanical * 0.85, olive);
      sprig(rng, w + 2, h * 0.28, botanical * 0.94, -0.46);
    } },
    { kind: "petal", side: -1, pivot: [w * 0.08, h * 1.05], draw() {
      reed(rng, w * 0.09, h * 1.07, 2.88, botanical * 0.83, olive);
      sprig(rng, w * 0.075 - 11, h * 1.045, botanical * 0.76, -0.27);
    } },
    { kind: "petal", side: 1, pivot: [w, h * 1.03], draw() {
      sprig(rng, w * 0.99 + 20, h * 1.03, botanical * 1.12, -0.55);
      reed(rng, w * 1.04, h * 1.02, 2.58, botanical * 0.83, slate);
    } },
  ];
}

/** 每帧分圈拼一组植物用的缓冲画布：外接框四周留出最大转角扫过的余量；reach 是这组离根部最近、最远的距离 */
function buffer([px, py], layer, density) {
  const corners = [[layer.x, layer.y], [layer.x + layer.w, layer.y], [layer.x, layer.y + layer.h], [layer.x + layer.w, layer.y + layer.h]];
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - px, y - py)));
  const nx = Math.max(layer.x, Math.min(px, layer.x + layer.w)),
    ny = Math.max(layer.y, Math.min(py, layer.y + layer.h));
  const pad = Math.ceil(MAX_ANGLE * far) + 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((layer.w + pad * 2) * density);
  canvas.height = Math.round((layer.h + pad * 2) * density);
  return { reach: [Math.hypot(nx - px, ny - py), far], strip: { canvas, x: layer.x - pad, y: layer.y - pad, w: layer.w + pad * 2, h: layer.h + pad * 2 } };
}

function build() {
  const rect = desk.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const density = Math.min(window.devicePixelRatio, 1.6);
  const w = rect.width,
    h = rect.height;
  desk.width = Math.round(w * density);
  desk.height = Math.round(h * density);
  const scale = Math.min(w / 1320, h / 770);
  const mobile = w < 680;
  const rng = paletteNoise(883);
  const margin = Math.ceil((MAX_ANGLE * Math.hypot(w, h)) / CELL) * CELL;
  paint(w, h, density, () => {
    stain(rng, -w * 0.04, h * 0.24, w * 0.29, h * 0.37, "#9d8d6a");
    stain(rng, w * 0.99, h * 0.44, w * 0.22, h * 0.43, "#b9a67d");
    stain(rng, w * 0.06, h * 0.82, w * 0.21, h * 0.41, "#a9a88c");
    stain(rng, w * 1.05, h * 0.9, w * 0.28, h * 0.36, "#c1a67d");
    stain(rng, w * 0.1, h * 0.1, w * 0.16, h * 0.24, "#7b947f");
    stain(rng, w * 0.97, h * 0.11, w * 0.18, h * 0.2, "#a59671");
  }, 0, deskBase);
  const botanical = mobile ? 1.45 * scale : scale;
  const corners = cornerGroups(w, h, rng, botanical, mobile).flatMap((group, i) => {
    const layer = crop(paint(w, h, density, group.draw, margin), density, margin, w, h);
    if (!layer) return [];
    const center = [layer.x + layer.w / 2, layer.y + layer.h / 2];
    const inward = ([x, y]) => Math.hypot(x - w / 2, y - h / 2);
    const spots = [...layer.spots].sort((a, b) => inward(a) - inward(b));
    return [{ ...group, ...layer, ...buffer(group.pivot, layer, density), spots, center, angle: 0, speed: 0, phase: i * 1.7, period: 6.2 + i * 0.9 }];
  });
  view = { w, h, density, corners };
  pieces.length = 0;
  render();
}

function render() {
  const { density, corners } = view;
  screen.setTransform(1, 0, 0, 1, 0, 0);
  screen.clearRect(0, 0, desk.width, desk.height);
  screen.setTransform(density, 0, 0, density, 0, 0);
  const t = performance.now() / 1000;
  for (const c of corners) {
    if (reduceMotion.matches) screen.drawImage(c.canvas, c.x, c.y, c.w, c.h);
    else drawBent(c, t, density);
  }
  for (const piece of pieces) drawPiece(piece);
}

function breeze(c, t) {
  const wave = (period, phase) => Math.sin((t / period) * TAU + phase);
  const swell = 0.75 + 0.25 * wave(17, c.phase);
  return BREEZE * swell * (0.7 * wave(c.period, c.phase) + 0.3 * wave(c.period * 0.47, c.phase * 2));
}

/**
 * 一圈一圈画进缓冲再贴上屏幕。圈与圈的交界用 lighter 叠加：裁剪边缘的抗锯齿覆盖率一边是 a、一边是 1-a，
 * 加起来正好补满；用默认的 source-over 交界处会透出一道浅色的环
 */
function drawBent(c, t, density) {
  const { canvas, x, y, w, h } = c.strip;
  const g = canvas.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(density, 0, 0, density, -x * density, -y * density);
  g.globalCompositeOperation = "lighter";
  const [px, py] = c.pivot,
    [near, far] = c.reach;
  for (let k = 0; k < BANDS; k++) {
    const along = (k + 0.5) / BANDS;
    const inner = k ? near + ((far - near) * k) / BANDS : 0;
    const outer = k === BANDS - 1 ? far + 2 : near + ((far - near) * (k + 1)) / BANDS;
    const angle = (0.15 + 0.85 * along ** 1.5) * (c.angle + breeze(c, t - LAG * along));
    g.save();
    g.beginPath();
    g.arc(px, py, outer, 0, TAU);
    if (inner) g.arc(px, py, inner, 0, TAU, true);
    g.clip();
    g.translate(px, py);
    g.rotate(Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle)));
    g.translate(-px, -py);
    g.drawImage(c.canvas, c.x, c.y, c.w, c.h);
    g.restore();
  }
  screen.drawImage(canvas, x, y, w, h);
}

/** 力 (fx, fy) 推在这组植物的中心上，转多少、往哪边转（叉积）；返回 -1…1 */
function torque(c, fx, fy) {
  const rx = c.center[0] - c.pivot[0],
    ry = c.center[1] - c.pivot[1];
  const length = Math.hypot(rx, ry) * Math.hypot(fx, fy);
  return length ? (rx * fy - ry * fx) / length : 0;
}

function brush(c) {
  if (!pointer.inside || !finePointer.matches) return 0;
  const dx = c.center[0] - pointer.x,
    dy = c.center[1] - pointer.y;
  const near = 1 - Math.hypot(dx, dy) / (Math.hypot(c.w, c.h) * BRUSH_REACH);
  return near > 0 ? PUSH * near * torque(c, dx, dy) : 0;
}

function sway(c, dt) {
  c.speed += (STIFF * (brush(c) - c.angle) - DAMP * c.speed) * dt;
  c.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, c.angle + c.speed * dt));
}

/** 从点击处附近的叶子上掉；自己飘落的挑靠屏幕中间的（spots 已按离中心远近排好），落在屏幕最边上就看不见了 */
function dropPoint(c, from) {
  const near = from ? c.spots.filter(([x, y]) => Math.hypot(x - from[0], y - from[1]) < DROP_RADIUS) : [];
  const pool = near.length ? near : c.spots.slice(0, Math.max(1, Math.ceil(c.spots.length * 0.3)));
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawn(c, kind, { gentle = false, from = null } = {}) {
  if (!c.spots.length) return;
  if (pieces.length >= MAX_PIECES) pieces.shift();
  const [x, y] = dropPoint(c, from);
  const low = c.pivot[1] > view.h / 2;
  const leaf = kind === "leaf";
  const tones = leaf ? LEAVES : PETALS;
  pieces.push({
    leaf,
    x,
    y,
    vx: gentle ? -c.side * 8 : -c.side * (15 + Math.random() * 30),
    vy: gentle ? 6 : low ? -(40 + Math.random() * 40) : 10 + Math.random() * 20,
    turn: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 3,
    flutter: Math.random() * Math.PI * 2,
    age: 0,
    life: 4.5 + Math.random() * 2.5,
    size: leaf ? 20 + Math.random() * 10 : 10 + Math.random() * 5,
    tone: tones[Math.floor(Math.random() * tones.length)],
  });
}

function fall(p, dt) {
  p.age += dt;
  p.vy = Math.min(p.vy + GRAVITY * dt, p.leaf ? FALL_SPEED.leaf : FALL_SPEED.petal);
  p.flutter += dt * FLUTTER_RATE;
  p.vx *= 1 - 0.6 * dt;
  p.x += (p.vx + Math.sin(p.flutter) * FLUTTER_DRIFT) * dt;
  p.y += p.vy * dt;
  p.turn += p.spin * dt;
}

function drawPiece(p) {
  const fade = Math.min(1, p.age / 0.3, (p.life - p.age) / 1.2);
  if (fade <= 0) return;
  screen.save();
  screen.globalAlpha = fade;
  screen.translate(p.x, p.y);
  screen.rotate(p.turn);
  screen.scale(p.size / 10, (p.size / 10) * (0.35 + 0.65 * Math.abs(Math.cos(p.flutter))));
  screen.beginPath();
  if (p.leaf) {
    screen.moveTo(-10, 0);
    screen.bezierCurveTo(-4, -4.5, 6, -4, 10, 0);
    screen.bezierCurveTo(6, 3.6, -4, 4.2, -10, 0);
  } else {
    screen.moveTo(0, 6);
    screen.bezierCurveTo(-7, 1, -6, -7, 0, -6);
    screen.bezierCurveTo(6, -7, 7, 1, 0, 6);
  }
  screen.fillStyle = p.tone;
  screen.fill();
  screen.restore();
}

function step(dt, t) {
  for (const c of view.corners) sway(c, dt);
  for (const p of pieces) fall(p, dt);
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].age > pieces[i].life || pieces[i].y > view.h + 40) pieces.splice(i, 1);
  }
  if (!nextDrift) nextDrift = t + 8;
  if (t < nextDrift) return;
  nextDrift = t + 15 + Math.random() * 10;
  const flowering = view.corners.filter((c) => c.kind === "petal");
  if (flowering.length) spawn(flowering[Math.floor(Math.random() * flowering.length)], "petal", { gentle: true });
}

function running() {
  return Boolean(view) && onScreen && !document.hidden && !reduceMotion.matches;
}

function tick(now) {
  frame = 0;
  if (!running()) return;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  step(dt, now / 1000);
  render();
  frame = requestAnimationFrame(tick);
}

function resume() {
  if (frame || !running()) return;
  last = 0;
  frame = requestAnimationFrame(tick);
}

/** 指针下面是哪一组植物（按格子判断，四周放宽一格，不算旋转：最多转几度，差不了一格） */
function plantAt(x, y) {
  if (!view || reduceMotion.matches) return null;
  const cx = Math.floor(x / CELL),
    cy = Math.floor(y / CELL);
  return (
    view.corners.find((c) => [-1, 0, 1].some((i) => [-1, 0, 1].some((j) => c.cells.has(`${cx + i},${cy + j}`)))) ?? null
  );
}

function rustle(c, from) {
  c.speed += (Math.random() < 0.5 ? -1 : 1) * 0.45;
  const leaf = c.kind === "leaf";
  const count = leaf ? 1 + Math.round(Math.random()) : 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) spawn(c, leaf || Math.random() < 0.2 ? "leaf" : "petal", { from });
  resume();
}

function gust(direction) {
  if (!running()) return;
  const wind = direction === 1 ? -1 : 1;
  for (const c of view.corners) {
    const strength = 0.28 + (c.side === wind ? 0.16 : 0);
    c.speed += strength * Math.sign(torque(c, wind, 0));
  }
}

function locate() {
  const rect = desk.getBoundingClientRect();
  pointer.x = pointer.clientX - rect.left;
  pointer.y = pointer.clientY - rect.top;
  pointer.inside = pointer.y >= 0 && pointer.y <= rect.height;
  stage.classList.toggle("over-plant", !stage.classList.contains("over-book") && Boolean(plantAt(pointer.x, pointer.y)));
}

function track(event) {
  pointer.clientX = event.clientX;
  pointer.clientY = event.clientY;
  locate();
}

window.addEventListener("pointermove", track, { passive: true });
// 滚轮滚动时指针不动、桌面在动
window.addEventListener("scroll", locate, { passive: true });
document.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) pointer.inside = false;
});
stage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  press = { id: event.pointerId, x: event.clientX, y: event.clientY };
  turned = false;
});
stage.addEventListener("pointerup", (event) => {
  const start = press;
  press = null;
  if (start?.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP) return;
  track(event);
  const at = [pointer.x, pointer.y];
  // book.js 的 pointerup 排在这之后：等它跑完，这一下翻了页就只算翻页
  setTimeout(() => {
    const plant = turned ? null : plantAt(...at);
    if (plant) rustle(plant, at);
  });
});
document.addEventListener("pairdown:turn", (event) => {
  turned = true;
  gust(event.detail.direction);
});
document.addEventListener("visibilitychange", resume);
reduceMotion.addEventListener("change", () => {
  if (!view) return;
  for (const c of view.corners) Object.assign(c, { angle: 0, speed: 0 });
  pieces.length = 0;
  stage.classList.remove("over-plant");
  render();
  resume();
});
new IntersectionObserver(([entry]) => {
  onScreen = entry.isIntersecting;
  resume();
}).observe(desk);

// 改窗口大小时要重画、重新扫像素；停下 120ms 再做，拖动中先让旧画面跟着拉伸
let rebuild = 0;
new ResizeObserver(() => {
  clearTimeout(rebuild);
  rebuild = setTimeout(() => {
    build();
    resume();
  }, view ? 120 : 0);
}).observe(desk);
