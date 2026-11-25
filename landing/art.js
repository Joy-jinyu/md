function random(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function path(ctx, points, fill, stroke, width = 2) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  if (fill) {
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function wash(ctx, rng, x, y, rx, ry, color, strokes = 11) {
  for (let j = 0; j < strokes; j++) {
    const ox = x + (rng() - 0.5) * rx * 0.46,
      oy = y + (rng() - 0.5) * ry * 0.44;
    const edge = Array.from({ length: 41 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      const q = 0.58 + rng() * 0.39 + 0.12 * Math.sin(a * 6 + j);
      return [ox + Math.cos(a) * rx * q, oy + Math.sin(a) * ry * q];
    });
    path(ctx, edge, color);
  }
}

function woodedHill(ctx, rng, y, amplitude, color) {
  const outline = [];
  for (let x = 45; x <= 2075; x += 14) {
    const fade = Math.sin((Math.PI * (x - 45)) / 2030) ** 0.43;
    const h =
      Math.sin(x * 0.004) * 0.5 +
      Math.cos(x * 0.0062) * 0.25 +
      Math.sin(x * 0.012) * 0.1;
    outline.push([x, y - amplitude * (h + 0.7) * fade + (rng() - 0.5) * 12]);
  }
  path(ctx, [...outline, [2075, y + 62], [45, y + 62]], color);
  path(ctx, outline, "", "#58695d30", 1.2);
}

function house(ctx, rng, x, floor, w, h, dir, palette) {
  const gable = h * 0.23,
    story = h * 0.63;
  const depth = w * (0.18 + rng() * 0.25) * dir;
  const frontX = x + w;
  const ridge = [x + w * 0.48, floor - story - gable];
  const left = [x - 9, floor - story + 9],
    right = [frontX + 8, floor - story + 8];
  const backRight = [right[0] + depth, right[1] - 13],
    backRidge = [ridge[0] + depth, ridge[1] - 13];
  path(
    ctx,
    [
      [frontX, floor],
      [frontX + depth, floor - 11],
      [frontX + depth, floor - story - 2],
      [frontX, floor - story + 9],
    ],
    palette[1],
    "#373931a2",
    2,
  );
  path(
    ctx,
    [
      [x, floor],
      [frontX, floor],
      [frontX, floor - story],
      [ridge[0], ridge[1] + 6],
      [x, floor - story],
    ],
    palette[0],
    "#34362ea4",
    1.8,
  );
  path(ctx, [right, ridge, backRidge, backRight], palette[2], "#32392fd5", 2.4);
  path(
    ctx,
    [
      left,
      [x + w * 0.15, floor - story - 5],
      ridge,
      [x + w * 0.69, floor - story - 7],
      right,
    ],
    null,
    "#31352be0",
    3,
  );
  path(
    ctx,
    [
      [left[0] - 3, left[1] + 5],
      [ridge[0], ridge[1] + 8],
      [right[0] + 3, right[1] + 5],
    ],
    null,
    "#544e3dd4",
    2,
  );
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    const ox = ridge[0] + (right[0] - ridge[0]) * t;
    const oy = ridge[1] + (right[1] - ridge[1]) * t;
    path(
      ctx,
      [
        [ox, oy],
        [ox + depth * 0.42, oy - 7],
        [ox + depth, oy - 13],
      ],
      null,
      "#2328237f",
      1.2,
    );
  }
  const stories = h > 147 ? 2 : 1;
  for (let row = 0; row < stories; row++) {
    const oy = floor - ((row + 1) * story) / (stories + 1) - 4;
    for (let i = 1; i <= 3; i++) {
      const wx = x + (w * i) / 4,
        ww = 5 + rng() * 7,
        wh = 11 + rng() * 9;
      path(
        ctx,
        [
          [wx - ww / 2, oy - wh],
          [wx + ww / 2, oy - wh],
          [wx + ww / 2, oy],
          [wx - ww / 2, oy],
        ],
        "#504d3fce",
        "#716856",
        1,
      );
      path(
        ctx,
        [
          [wx, oy - wh],
          [wx, oy],
        ],
        null,
        "#e2d2af9e",
        1,
      );
    }
  }
  for (let i = 0; i < 8; i++) {
    const ox = x + w * rng(),
      oy = floor - story * 0.43 * rng();
    path(
      ctx,
      [
        [ox, oy],
        [ox + 2 + rng() * 12, oy + (rng() - 0.5) * 3],
      ],
      null,
      "#726b504d",
      0.8,
    );
  }
}

function bridge(ctx, rng, x, y, w, h) {
  const arch = (t, r) => [x + w * t, y - h * Math.sin(t * Math.PI) * r];
  const upper = Array.from({ length: 35 }, (_, i) => arch(i / 34, 1.34));
  const lower = Array.from({ length: 35 }, (_, i) => arch(i / 34, 0.79));
  path(
    ctx,
    [...upper.map(([u, v]) => [u, v - 15]), ...lower.slice().reverse()],
    "#d2bc8f",
    "#4b4939d9",
    3,
  );
  path(ctx, upper, null, "#4f4a36d6", 3);
  path(ctx, lower, null, "#514634c2", 3);
  for (let i = 0; i <= 20; i++) {
    const a = arch(i / 20, 1.34),
      b = arch(i / 20, 0.79);
    path(
      ctx,
      [
        [a[0], a[1] - 15],
        [a[0], a[1] + 3],
      ],
      null,
      "#4e4b39e0",
      2.3,
    );
    path(
      ctx,
      [
        [a[0] + (rng() - 0.5) * 9, a[1] + 8],
        [b[0] + (rng() - 0.5) * 16, b[1]],
      ],
      null,
      "#74684f9d",
      1.5,
    );
  }
  path(
    ctx,
    upper.map(([u, v]) => [u, v - 15]),
    null,
    "#413e32e0",
    3,
  );
}

function willow(ctx, rng, x, y, h) {
  const branches = 18;
  const stem = "#484735b6";
  path(
    ctx,
    [
      [x - 8, y],
      [x - 4, y - h * 0.53],
      [x - 32, y - h * 0.77],
      [x - 25, y - h * 0.9],
      [x + 7, y - h * 0.58],
      [x + 13, y],
    ],
    "#6f694a",
    stem,
    2,
  );
  for (let i = 0; i < branches; i++) {
    const ox = x + (rng() - 0.45) * 230;
    const oy = y - h * 0.66 + (rng() - 0.4) * 105;
    const a = x + (rng() - 0.5) * 20;
    const b = y - h * (0.6 + rng() * 0.24);
    const bend = (rng() - 0.5) * 38;
    const drop = 25 + rng() * 80;
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.quadraticCurveTo((x + ox) / 2, y - h * 0.94, ox, oy);
    ctx.quadraticCurveTo(ox + bend, oy + drop * 0.7, ox + 5, oy + drop);
    ctx.strokeStyle = i % 3 ? "#59674cb8" : stem;
    ctx.lineWidth = i % 3 ? 1.25 : 2.1;
    ctx.stroke();
    for (let k = 0; k < 19; k++) {
      const t = rng(),
        px = ox + Math.sin(t * Math.PI) * bend * 0.45 + (rng() - 0.5) * 11,
        py = oy + t * drop;
      path(
        ctx,
        [
          [px, py],
          [px + (rng() - 0.5) * 16, py + 3 + rng() * 8],
        ],
        null,
        i % 3 ? "#65775071" : "#4b644787",
        1.1,
      );
    }
  }
  wash(ctx, rng, x - 45, y - h * 0.78, 137, 50, "#7180560e", 8);
}

export function makeArtwork(index) {
  const art = document.createElement("canvas");
  art.width = 2120;
  art.height = 940;
  const ctx = art.getContext("2d");
  const rng = random(17 + index * 18);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const palettes = [
    ["#e7ddbd", "#b4aa8b", "#53615b", "#435e76"],
    ["#dfdcc0", "#aab49b", "#4b645a", "#577669"],
    ["#e8d5b4", "#b9a389", "#66504a", "#635c74"],
  ];
  const palette = palettes[index];
  const y = 592;
  for (let i = 0; i < 44; i++) {
    const x = 108 + rng() * 1900;
    const z = 320 + rng() * 285;
    wash(
      ctx,
      rng,
      x,
      z,
      45 + rng() * 200,
      19 + rng() * 98,
      i % 3 ? "#a58c5410" : "#8190840f",
      4,
    );
  }
  woodedHill(ctx, rng, 468, 176, "#899b8b3b");
  woodedHill(ctx, rng, 502, 133, "#9aa38448");
  woodedHill(ctx, rng, 535, 89, "#9a9c7352");

  const reflections = [];
  for (let i = 0; i < 72; i++) {
    const x = 80 + i * 27 + (rng() - 0.5) * 16;
    const w = 28 + rng() * 67;
    const h = 43 + rng() * 184;
    const floor = y - 25 + rng() * 20;
    reflections.push([x, w, h, floor]);
    if (i % 3 === 1) house(ctx, rng, x, floor, w, h, -1, palette);
  }
  for (let i = 0; i < reflections.length; i++) {
    const [x, w, h, floor] = reflections[i];
    if (i % 3 !== 1) {
      if (x > 535 && x < 855 && i % 2 === 0) continue;
      house(ctx, rng, x, floor + 17, w, h * 0.82, 1, palette);
    }
    wash(
      ctx,
      rng,
      x + w * 0.4,
      y + 36 + rng() * 90,
      w * 0.8,
      32 + h * 0.53,
      i % 3 ? palette[3] + "19" : "#b8985920",
      3,
    );
  }
  for (let i = 0; i < 52; i++) {
    const x = 90 + rng() * 1960;
    path(
      ctx,
      [
        [x, y - 5 + (rng() - 0.5) * 9],
        [x + 6 + rng() * 27, y + 2 + rng() * 13],
      ],
      null,
      "#333c32ad",
      1.1 + rng() * 4,
    );
  }
  const bridgeX = [480, 1030, 710][index];
  bridge(ctx, rng, bridgeX, y + 17, 255 + index * 22, 70 + index * 5);
  willow(ctx, rng, index === 1 ? 298 : 1870, y - 5, 235);
  willow(ctx, rng, index === 1 ? 1760 : 241, y - 10, 155);

  for (let i = 0; i < 950; i++) {
    const x = 69 + rng() * 1980;
    const dy = rng() ** 1.58 * 190;
    const oy = y + 12 + dy;
    const l = 2 + rng() * 48;
    if (rng() > 0.33)
      path(
        ctx,
        [
          [x, oy],
          [x + l * 0.84, oy + (rng() - 0.5) * 2],
        ],
        null,
        i % 4 === 0 ? "#304353a5" : palette[3] + "5e",
        0.55 + rng() * 1.65,
      );
    else
      path(
        ctx,
        [
          [x, oy],
          [x + (rng() - 0.5) * 2, oy + 4 + rng() * 13],
        ],
        null,
        "#464b4a4f",
        0.65 + rng(),
      );
  }
  const boatX = [1190, 845, 1380][index],
    boatY = y + 114;
  path(
    ctx,
    [
      [boatX, boatY - 9],
      [boatX + 35, boatY + 1],
      [boatX + 121, boatY - 1],
      [boatX + 173, boatY - 12],
      [boatX + 150, boatY + 14],
      [boatX + 40, boatY + 17],
    ],
    "#514938",
    "#3d3c31",
    2,
  );
  path(
    ctx,
    [
      [boatX + 51, boatY],
      [boatX + 62, boatY - 22],
      [boatX + 113, boatY - 22],
      [boatX + 132, boatY + 2],
    ],
    "#b59566",
    "#3d3c31",
    2,
  );
  path(
    ctx,
    [
      [boatX + 121, boatY],
      [boatX + 168, boatY - 29],
    ],
    null,
    "#4b493e",
    1.6,
  );

  const fade = ctx.createLinearGradient(0, 675, 0, 849);
  fade.addColorStop(0, "#fff");
  fade.addColorStop(0.67, "#ffffffda");
  fade.addColorStop(1, "#ffffff00");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 2120, 940);
  ctx.globalCompositeOperation = "source-over";
  return art;
}
