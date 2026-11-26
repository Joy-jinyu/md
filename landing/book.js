import * as THREE from "./vendor/three.module.min.js";

import { makeArtwork } from "./art.js";

import { renderJournal, renderTranscript, spreads } from "./journal.js";
import { setupWriter } from "./quill.js";

const stage = document.querySelector("#stage");
const canvas = document.querySelector("#scene");
const transcript = document.querySelector("#transcript");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const pageWidth = 4.78;
const pageHeight = 4.29;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40);
const book = new THREE.Group();
const paperWidth = 1060;
const paperHeight = 940;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
} catch {
  canvas.hidden = true;
  stage.hidden = true;
  document.querySelector("#fallback").hidden = false;
  stage.parentElement.classList.add("fallback-mode");
  transcript.classList.remove("sr-only");
  renderTranscript(transcript, spreads);
  document.dispatchEvent(new Event("pairdown:ready"));
}

function randomGenerator(seed) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function pageTexture(content, index, right) {
  const page = document.createElement("canvas");
  page.width = paperWidth;
  page.height = paperHeight;
  const ctx = page.getContext("2d");
  const rng = randomGenerator(417 + index * 17 + Number(right) * 29);
  ctx.beginPath();
  ctx.roundRect(
    0,
    0,
    paperWidth,
    paperHeight,
    right ? [0, 39, 39, 0] : [39, 0, 0, 39],
  );
  ctx.clip();

  const color = ctx.createLinearGradient(0, 0, paperWidth, 0);
  if (right) {
    color.addColorStop(0, "#ded6c4");
    color.addColorStop(0.038, "#f7f2e6");
    color.addColorStop(0.59, "#f7f2e7");
    color.addColorStop(1, "#eae4d7");
  } else {
    color.addColorStop(0, "#ece7da");
    color.addColorStop(0.47, "#f6f0e4");
    color.addColorStop(0.94, "#f2ecdf");
    color.addColorStop(1, "#ded1bc");
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, paperWidth, paperHeight);
  for (let i = 0; i < 82000; i++) {
    const x = rng() * paperWidth,
      y = rng() * paperHeight,
      fiber = 1 + rng() * 3.5;
    ctx.strokeStyle = i % 3 === 0 ? "#77695119" : "#ffffff40";
    ctx.lineWidth = 0.55 + rng() * 0.48;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + fiber, y + (rng() - 0.45) * fiber * 0.72);
    ctx.stroke();
  }

  const artwork =
    content.sketch === undefined ? null : makeArtwork(content.sketch);
  const note = renderJournal(ctx, content, index, right, artwork);
  const texture = toTexture(page);
  if (!right) {
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return { texture, note };
}

function toTexture(source) {
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function paperMaterial(map, side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({
    map,
    side,
    alphaTest: 0.5,
    roughness: 0.93,
    metalness: 0,
  });
}

function makePaper() {
  const geometry = new THREE.PlaneGeometry(pageWidth, pageHeight, 40, 8);
  geometry.translate(pageWidth / 2, 0, 0);
  return geometry;
}

function curlPaper(geometry, angle, moving) {
  const points = geometry.attributes.position;
  for (let i = 0; i < points.count; i++) {
    const column = i % 41;
    const s = column / 40;
    const y = ((4 - Math.floor(i / 41)) / 8) * pageHeight;
    const curl = 0.58 * Math.sin(angle) * s ** 1.62;
    const bend = angle - curl;
    const extension = pageWidth * s;
    const x = extension * Math.cos(bend);
    const corner = (y / pageHeight + 0.5) * 0.09 * s ** 3 * Math.sin(angle);
    const z =
      extension * Math.sin(bend) + 0.091 * Math.sin(Math.PI * s) + corner;
    points.setXYZ(i, x, y, z + (moving ? 0.06 : 0));
  }
  points.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

if (renderer) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  scene.add(new THREE.HemisphereLight(0xfffdf8, 0xc5c1b5, 2.45));
  const sun = new THREE.DirectionalLight(0xfffcf4, 1.22);
  sun.position.set(-3, 6, 7);
  scene.add(sun, book);

  const shade = document.createElement("canvas");
  shade.width = 600;
  shade.height = 360;
  const ctx = shade.getContext("2d");
  ctx.filter = "blur(34px)";
  ctx.fillStyle = "#4845374b";
  ctx.beginPath();
  ctx.ellipse(312, 215, 222, 90, -0.014, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = "blur(11px)";
  ctx.fillStyle = "#514a3c4b";
  ctx.beginPath();
  ctx.roundRect(65, 87, 456, 192, 24);
  ctx.fill();
  ctx.filter = "none";
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(pageWidth * 2 + 2.9, pageHeight + 2.4),
    new THREE.MeshBasicMaterial({
      map: toTexture(shade),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0.14, -0.11, -0.27);
  book.add(shadow);

  function roundedEdges(width, height, depth, z, color) {
    const corners = new THREE.Shape();
    const x = -width / 2,
      y = -height / 2,
      r = 0.17;
    corners.moveTo(x + r, y);
    corners.lineTo(x + width - r, y);
    corners.quadraticCurveTo(x + width, y, x + width, y + r);
    corners.lineTo(x + width, y + height - r);
    corners.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    corners.lineTo(x + r, y + height);
    corners.quadraticCurveTo(x, y + height, x, y + height - r);
    corners.lineTo(x, y + r);
    corners.quadraticCurveTo(x, y, x + r, y);
    const geometry = new THREE.ExtrudeGeometry(corners, {
      depth,
      bevelEnabled: false,
      curveSegments: 8,
    });
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    );
    mesh.position.z = z;
    book.add(mesh);
  }
  roundedEdges(
    pageWidth * 2 + 0.11,
    pageHeight + 0.085,
    0.056,
    -0.143,
    0xb9af9c,
  );
  for (let i = 0; i < 7; i++) {
    roundedEdges(
      pageWidth * 2 + 0.052 - i * 0.004,
      pageHeight + 0.045 - i * 0.005,
      0.011,
      -0.096 + i * 0.011,
      i % 2 ? 0xeee7d9 : 0xd9ceb9,
    );
  }

  const pages = spreads.map((spread, index) => ({
    left: pageTexture(spread.left, index, false),
    right: pageTexture(spread.right, index, true),
  }));

  const leftGeometry = makePaper();
  const rightGeometry = makePaper();
  curlPaper(leftGeometry, Math.PI, false);
  curlPaper(rightGeometry, 0, false);
  const left = new THREE.Mesh(
    leftGeometry,
    paperMaterial(pages[0].left.texture, THREE.BackSide),
  );
  const right = new THREE.Mesh(
    rightGeometry,
    paperMaterial(pages[0].right.texture),
  );
  const turningGeometry = makePaper();
  const front = new THREE.Mesh(
    turningGeometry,
    paperMaterial(pages[0].right.texture),
  );
  const back = new THREE.Mesh(
    turningGeometry,
    paperMaterial(pages[0].left.texture, THREE.BackSide),
  );
  book.add(left, right, front, back);
  front.visible = back.visible = false;

  const state = { index: 0, turn: null, drag: null, x: 0, y: 0 };
  let cameraDistance = 14;
  let redraw = true;
  renderTranscript(transcript, [spreads[0]]);
  const writer = setupWriter(
    pages.map((page) => [page.left, page.right]),
    reducedMotion,
    paperWidth,
  );
  const projectedTip = new THREE.Vector3();

  function positionQuill() {
    if (state.turn) {
      writer.element.style.opacity = "0";
      return;
    }
    const { x, y, lift: penLift } = writer.location();
    const u = x / paperWidth - 1;
    const depth = 0.091 * Math.sin(Math.PI * Math.abs(u)) + 0.008 + penLift;
    projectedTip.set(
      u * pageWidth,
      (0.5 - y / paperHeight) * pageHeight,
      depth,
    );
    book.localToWorld(projectedTip);
    projectedTip.project(camera);
    const screenX = ((projectedTip.x + 1) * stage.clientWidth) / 2;
    const screenY = ((1 - projectedTip.y) * stage.clientHeight) / 2;
    const tipX = screenX - writer.element.offsetWidth * 0.1325;
    const tipY = screenY - writer.element.offsetHeight * 0.9609;
    writer.element.style.transform =
      "translate3d(" +
      tipX +
      "px," +
      tipY +
      "px,0) rotate(" +
      -penLift * 21 +
      "deg)";
    writer.element.style.opacity = "1";
  }

  let lift = 0;
  const wrap = (index) => (index + pages.length) % pages.length;

  function pose(progress) {
    const direction = state.turn.direction;
    const angle = Math.PI * (direction === 1 ? progress : 1 - progress);
    redraw = true;
    curlPaper(turningGeometry, angle, true);
    lift = Math.sin(angle);
  }

  function showIndex(index) {
    state.index = index;
    left.material.map = pages[index].left.texture;
    right.material.map = pages[index].right.texture;
    document.querySelector("#number").textContent =
      String(index + 1).padStart(2, "0") +
      " / " +
      String(pages.length).padStart(2, "0");
    document.querySelector("#label").textContent = spreads[index].label;
  }

  function begin(direction) {
    writer.complete();
    const target = wrap(state.index + direction);
    state.turn = { direction, target, progress: 0, animation: null };
    if (direction === 1) {
      right.material.map = pages[target].right.texture;
      front.material.map = pages[state.index].right.texture;
      back.material.map = pages[target].left.texture;
    } else {
      left.material.map = pages[target].left.texture;
      front.material.map = pages[target].right.texture;
      back.material.map = pages[state.index].left.texture;
    }
    front.visible = back.visible = true;
    pose(0);
  }

  function finish(go) {
    showIndex(go ? state.turn.target : state.index);
    if (go) {
      writer.start(state.index);
      renderTranscript(transcript, [spreads[state.index]]);
    }
    front.visible = back.visible = false;
    state.turn = null;
    lift = 0;
    redraw = true;
  }

  function settle(go) {
    if (reducedMotion.matches) {
      finish(go);
      return;
    }
    state.turn.animation = {
      from: state.turn.progress,
      to: Number(go),
      at: performance.now(),
      duration: go ? 755 : 340,
    };
  }

  function turn(direction) {
    if (state.turn) return;
    begin(direction);
    settle(true);
  }

  stage.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    turn(event.key === "ArrowLeft" ? -1 : 1);
  });

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pageMeshes = [left, right];

  function pageAt(event, bounds = stage.getBoundingClientRect()) {
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    );
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pageMeshes, false)[0];
    return hit ? (hit.object === left ? -1 : 1) : 0;
  }

  stage.addEventListener("pointerdown", (event) => {
    if (state.turn || event.button !== 0 || state.drag) return;
    const direction = pageAt(event);
    if (!direction) return;
    state.drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction,
    };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    state.x = (event.clientX - rect.left) / rect.width - 0.5;
    state.y = (event.clientY - rect.top) / rect.height - 0.5;
    if (state.drag?.id !== event.pointerId) {
      stage.classList.toggle("over-book", Boolean(pageAt(event, rect)));
      return;
    }
    const displacement = event.clientX - state.drag.startX;
    if (!state.turn && Math.abs(displacement) > 8) {
      begin(displacement < 0 ? 1 : -1);
      stage.classList.add("dragging");
    }
    if (!state.turn) return;
    state.turn.progress = Math.max(
      0,
      Math.min(
        0.96,
        (-displacement * state.turn.direction) / (rect.width * 0.47),
      ),
    );
    if (!reducedMotion.matches) pose(state.turn.progress);
  });
  const release = (event) => {
    if (state.drag?.id !== event.pointerId) return;
    const drag = state.drag;
    state.drag = null;
    stage.classList.remove("dragging");
    const released = event.type === "pointerup";
    if (state.turn) {
      settle(released && state.turn.progress > 0.22);
      return;
    }
    const moved = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (released && moved <= 8 && pageAt(event) === drag.direction)
      turn(drag.direction);
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("lostpointercapture", release);
  stage.addEventListener("pointerleave", () => {
    state.x = 0;
    state.y = 0;
    stage.classList.remove("over-book");
  });

  function resize() {
    const rect = stage.getBoundingClientRect();
    camera.aspect = rect.width / rect.height;
    cameraDistance = Math.max(12.7, 21.6 / camera.aspect);
    camera.position.z = cameraDistance;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
    redraw = true;
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  let firstFrame = true;
  renderer.setAnimationLoop((now) => {
    if (firstFrame) writer.start(0);
    if (state.turn?.animation) {
      const { from, to, at, duration } = state.turn.animation;
      const t = Math.min(1, (now - at) / duration);
      const smooth = t * t * (3 - 2 * t);
      pose(from + (to - from) * smooth);
      if (t === 1) finish(to === 1);
    }
    const tracking = reducedMotion.matches ? 0 : 1;
    const targetX = -0.045 + state.y * 0.12 * tracking;
    const targetY = 0.022 + state.x * 0.15 * tracking;
    const targetZ = -0.008;
    const moving =
      Math.max(
        Math.abs(targetX - book.rotation.x),
        Math.abs(targetY - book.rotation.y),
        Math.abs(targetZ - book.rotation.z),
      ) > 0.00065;
    const writing = !state.turn && writer.update(now);
    if (!moving && !redraw && !writing) return;
    redraw = false;
    book.rotation.x += (targetX - book.rotation.x) * 0.08;
    book.rotation.y += (targetY - book.rotation.y) * 0.08;
    book.rotation.z += (targetZ - book.rotation.z) * 0.08;
    camera.position.z = cameraDistance + lift * 2.15;
    renderer.render(scene, camera);
    positionQuill();
    if (firstFrame) {
      firstFrame = false;
      document.dispatchEvent(new Event("pairdown:ready"));
    }
  });
}
