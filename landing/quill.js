import { handwriting } from "./handwriting.js";

const quill = document.querySelector("#quill");
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
