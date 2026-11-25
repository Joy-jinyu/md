const desk = document.querySelector("#desk-art");
const ink = desk.getContext("2d");

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

function drawDesk() {
  const rect = desk.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const density = Math.min(window.devicePixelRatio, 1.6);
  desk.width = Math.round(rect.width * density);
  desk.height = Math.round(rect.height * density);
  ink.scale(density, density);
  const w = rect.width,
    h = rect.height;
  const scale = Math.min(w / 1320, h / 770);
  const mobile = w < 680;
  const rng = paletteNoise(883);

  stain(rng, -w * 0.04, h * 0.24, w * 0.29, h * 0.37, "#9d8d6a");
  stain(rng, w * 0.99, h * 0.44, w * 0.22, h * 0.43, "#b9a67d");
  stain(rng, w * 0.06, h * 0.82, w * 0.21, h * 0.41, "#a9a88c");
  stain(rng, w * 1.05, h * 0.9, w * 0.28, h * 0.36, "#c1a67d");
  stain(rng, w * 0.1, h * 0.1, w * 0.16, h * 0.24, "#7b947f");
  stain(rng, w * 0.97, h * 0.11, w * 0.18, h * 0.2, "#a59671");

  const olive = ["#71826547", "#919d7e48", "#6d7b5f5a"];
  const slate = ["#718e8646", "#9aa67d43", "#6b806858"];
  const botanical = mobile ? 1.45 * scale : scale;
  reed(rng, mobile ? -13 : 13, -58, -0.69, botanical * 1.2, olive);
  reed(rng, mobile ? 11 : 58, -65, -0.34, botanical * 0.96, slate);
  reed(rng, w * 0.99 + 26, h * 0.025, -0.06, botanical * 0.85, olive);
  sprig(rng, w + 2, h * 0.28, botanical * 0.94, -0.46);
  reed(rng, w * 0.09, h * 1.07, 2.88, botanical * 0.83, olive);
  sprig(rng, w * 0.075 - 11, h * 1.045, botanical * 0.76, -0.27);
  sprig(rng, w * 0.99 + 20, h * 1.03, botanical * 1.12, -0.55);
  reed(rng, w * 1.04, h * 1.02, 2.58, botanical * 0.83, slate);
}

new ResizeObserver(drawDesk).observe(desk);
drawDesk();
