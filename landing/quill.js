import { handwriting } from "./handwriting.js";

const quill = document.querySelector("#quill");
const pen = quill.getContext("2d");
pen.translate(59, 493);
pen.rotate(-0.65);
pen.lineCap = "round";
pen.lineJoin = "round";

function traceFeather() {
  pen.beginPath();
  pen.moveTo(105, 10);
  pen.bezierCurveTo(157, -26, 191, -83, 270, -94);
  pen.bezierCurveTo(360, -111, 471, -77, 568, -25);
  pen.bezierCurveTo(483, -7, 445, 12, 403, 27);
  pen.lineTo(424, 12);
  pen.bezierCurveTo(343, 42, 267, 74, 192, 59);
  pen.bezierCurveTo(145, 48, 119, 26, 105, 10);
  pen.closePath();
}

const vane = pen.createLinearGradient(232, -99, 280, 73);
vane.addColorStop(0, "#e3daca");
vane.addColorStop(0.22, "#b7b39d");
vane.addColorStop(0.51, "#777d6d");
vane.addColorStop(0.59, "#a8a794");
vane.addColorStop(0.81, "#868c7a");
vane.addColorStop(1, "#555e54");
traceFeather();
pen.fillStyle = vane;
pen.fill();
pen.strokeStyle = "#67726579";
pen.lineWidth = 1.05;
pen.stroke();

let seed = 7603;
function sample() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

pen.save();
traceFeather();
pen.clip();
for (let i = 0; i < 325; i++) {
  const t = i / 325;
  const start = 101 + t * 467;
  const spine = 14 - 38 * t + 9 * Math.sin(t * Math.PI);
  for (const side of [-1, 1]) {
    const length = Math.sin(t * Math.PI) ** 0.43;
    const endX = start + (25 + 48 * sample()) * length;
    const endY =
      spine +
      side * length * (side === 1 ? 79 : 116) * (1 - 0.37 * t) +
      (sample() - 0.5) * 12;
    pen.beginPath();
    pen.moveTo(start, spine);
    pen.bezierCurveTo(
      start + 25 * length,
      spine + side * length * 19,
      endX - 19 * length,
      endY - side * 13 * length,
      endX,
      endY,
    );
    pen.strokeStyle =
      i % 5 === 0 ? "#f7ecd386" : i % 2 ? "#e5e4d33b" : "#36453849";
    pen.lineWidth = 0.55 + sample() * 1.2;
    pen.stroke();
  }
}

for (let i = 0; i < 2900; i++) {
  pen.fillStyle = i % 2 ? "#e7e4d136" : "#3d4e3924";
  pen.fillRect(
    100 + sample() * 470,
    -107 + sample() * 181,
    0.7 + sample() * 2.1,
    0.5 + sample(),
  );
}
pen.restore();

pen.beginPath();
pen.moveTo(15, 38);
pen.bezierCurveTo(124, 8, 218, 25, 308, 5);
pen.bezierCurveTo(414, -15, 487, -19, 568, -25);
pen.bezierCurveTo(486, -21, 407, -21, 305, -3);
pen.bezierCurveTo(210, 14, 123, 13, 15, 41);
pen.closePath();
const spine = pen.createLinearGradient(65, 43, 77, 15);
spine.addColorStop(0, "#765c40");
spine.addColorStop(0.42, "#aa8f65");
spine.addColorStop(0.66, "#edd9b4");
spine.addColorStop(1, "#b5a287");
pen.fillStyle = spine;
pen.fill();

pen.beginPath();
pen.moveTo(0, 47);
pen.quadraticCurveTo(13, 35, 32, 33);
pen.lineTo(43, 34);
pen.quadraticCurveTo(32, 40, 10, 45);
pen.closePath();
const nib = pen.createLinearGradient(0, 47, 31, 34);
nib.addColorStop(0, "#333b35");
nib.addColorStop(0.56, "#635644");
nib.addColorStop(1, "#b39161");
pen.fillStyle = nib;
pen.fill();
pen.beginPath();
pen.moveTo(3, 46);
pen.lineTo(21, 39);
pen.strokeStyle = "#322d25a3";
pen.lineWidth = 1;
pen.stroke();

function pageWriting(page) {
  const { texture, note } = page;
  const context = texture.image.getContext("2d");
  const cleanX = Math.floor(note.x) - 4;
  const cleanY = note.y - note.size - 6;
  const clean = context.getImageData(
    cleanX,
    cleanY,
    Math.ceil(note.size * (note.text.length + 1) + 12),
    note.size + 25,
  );
  context.lineCap = "round";
  context.lineJoin = "round";
  return { texture, note, context, clean, cleanX, cleanY };
}

function makeTrack(pages, pageWidth) {
  const steps = [];
  let duration = 0;
  let previous;
  let previousSide;
  for (const [side, page] of pages.entries()) {
    const { text, x, y, size } = page.note;
    for (const stroke of handwriting(text, x + side * pageWidth, y, size)) {
      for (const [index, point] of stroke.entries()) {
        if (previous) {
          const ink = index !== 0;
          const across = side !== previousSide;
          const distance = Math.hypot(
            point[0] - previous[0],
            point[1] - previous[1],
          );
          const time = ink
            ? distance * 2.35
            : across
              ? 415
              : Math.max(12, distance * 0.58);
          if (time > 0) {
            steps.push({
              from: previous,
              to: point,
              start: duration,
              end: duration + time,
              ink,
              side,
              across,
            });
            duration += time;
          }
        }
        previous = point;
        previousSide = side;
      }
    }
  }
  const restingTip = [pageWidth + 912, 823];
  steps.push({
    from: previous,
    to: restingTip,
    start: duration,
    end: duration + 435,
    ink: false,
    side: 1,
    across: true,
  });
  return { steps, duration: duration + 435 };
}

function coordinate(step, time) {
  const phase = Math.max(
    0,
    Math.min(1, (time - step.start) / (step.end - step.start)),
  );
  const t = step.ink ? phase : phase * phase * (3 - 2 * phase);
  const x = step.from[0] + (step.to[0] - step.from[0]) * t;
  const y = step.from[1] + (step.to[1] - step.from[1]) * t;
  const lift = step.ink
    ? 0
    : Math.sin(phase * Math.PI) * (step.across ? 0.32 : 0.055);
  return { x, y, lift };
}

export function setupWriter(spreads, reducedMotion, pageWidth) {
  const writing = spreads.map((spread) => {
    const pages = spread.map(pageWriting);
    return { pages, ...makeTrack(pages, pageWidth) };
  });
  let current;
  let location;

  function inkTo(target) {
    const changed = new Set();
    const { steps, pages } = current.track;
    while (current.index < steps.length && current.time < target) {
      const step = steps[current.index];
      const end = Math.min(target, step.end);
      const start = coordinate(step, current.time);
      location = coordinate(step, end);
      if (step.ink) {
        const { context, texture } = pages[step.side];
        const offset = step.side * pageWidth;
        context.strokeStyle = "#445d51";
        context.lineWidth = current.index % 4 === 0 ? 2.5 : 2;
        context.beginPath();
        context.moveTo(start.x - offset, start.y);
        context.lineTo(location.x - offset, location.y);
        context.stroke();
        changed.add(texture);
      }
      current.time = end;
      if (end === step.end) current.index++;
    }
    for (const texture of changed) texture.needsUpdate = true;
  }

  function start(index) {
    const track = writing[index];
    for (const page of track.pages) {
      page.context.putImageData(page.clean, page.cleanX, page.cleanY);
      page.texture.needsUpdate = true;
    }
    current = {
      track,
      index: 0,
      time: 0,
      at: performance.now() + 220,
      last: -Infinity,
    };
    location = coordinate(track.steps[0], 0);
    if (reducedMotion.matches) inkTo(track.duration);
  }

  function update(now) {
    const duration = current.track.duration;
    if (
      current.time === duration ||
      now < current.at ||
      now - current.last < 33
    )
      return false;
    current.last = now;
    inkTo(
      reducedMotion.matches ? duration : Math.min(duration, now - current.at),
    );
    return true;
  }

  return {
    start,
    update,
    complete: () => inkTo(current.track.duration),
    location: () => location,
    element: quill,
  };
}
