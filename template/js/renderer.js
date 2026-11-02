import {
  $, TAG_W, TAG_H, COMMITS, DIFF, FOLDERS, BOX, PLATE, FILES, TAGS,
} from "./model.js";
import { rgb } from "./colour.js";

// ---- Renderer ----------------------------------------------------------

export const canvas = $("gl");
export const gl = canvas.getContext("webgl2", { antialias: true });
if (!gl) $("fatal").style.display = "grid";

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iPos;
layout(location=3) in vec3 iSize;
layout(location=4) in vec3 iSlab;  // plain flag, commit, item
layout(location=5) in vec3 iMark;  // tag layer or -1, commit it goes gray at, shade
uniform mat4 uView, uProj;
uniform highp sampler2D uItems;
uniform float uTime;
uniform vec3 uGray;
out vec3 vNormal, vColor, vWorld, vLocal;
flat out float vPlain, vEmphasis, vTag, vSide;
void main() {
  int item = int(iSlab.z);
  int row = textureSize(uItems, 0).x;
  vec4 look = texelFetch(uItems, ivec2(item % row, item / row), 0);
  vec3 world = iPos + aPos * iSize;
  // A stretched shape's slopes tilt the opposite way to its stretch.
  vNormal = aNormal / iSize;
  vColor = uTime < iMark.y ? look.rgb : uGray * iMark.z;
  vEmphasis = look.a * 2.0;
  vPlain = iSlab.x;
  vWorld = world;
  vLocal = aPos * iSize;
  vTag = iMark.x;
  vSide = iSize.x;
  // A slab from a later commit than the one shown lands outside the clip box.
  gl_Position = iSlab.y > uTime ? vec4(2.0, 2.0, 2.0, 1.0)
                                : uProj * uView * vec4(world, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vNormal, vColor, vWorld, vLocal;
flat in float vPlain, vEmphasis, vTag, vSide;
uniform vec3 uBg, uEye;
uniform float uFogFar;
uniform highp sampler2DArray uTags;
out vec4 out_;

// How much of the tag's ink covers this point of a wall. Each wall is read
// from outside, left to right, with a whole number of repeats across it.
float tagInk(vec3 n) {
  if (vTag < 0.0 || length(n.xz) < 0.2) return 0.0;
  float across = abs(n.x) > abs(n.z) ? -sign(n.x) * vLocal.z
                                     : sign(n.z) * vLocal.x;
  float repeats = max(1.0, round(vSide / ${TAG_W.toFixed(2)}));
  vec2 uv = vec2((across / vSide + 0.5) * repeats,
                 -vWorld.y / ${TAG_H.toFixed(2)});
  return texture(uTags, vec3(uv, vTag)).a;
}

void main() {
  vec3 n = normalize(vNormal);
  float sun = max(dot(n, normalize(vec3(0.45, 0.8, 0.35))), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.6, 0.2, -0.5))), 0.0);
  vec3 c = vColor * (0.42 + 0.58 * sun + 0.18 * fill);
  vec3 ink = dot(vColor, vec3(0.3, 0.59, 0.11)) > 0.5 ? vec3(0.05) : vec3(0.97);
  c = mix(c, ink, tagInk(n) * 0.9);
  if (vPlain > 0.5) c = mix(c, vec3(0.5), 0.6);
  if (vEmphasis < 0.5) c = mix(vec3(0.16), c, 0.12);
  if (vEmphasis > 1.5) c = mix(c, vec3(1.0), 0.45);
  float fog = smoothstep(0.55, 1.0, distance(vWorld, uEye) / uFogFar);
  out_ = vec4(mix(c, uBg, fog * 0.75), 1.0);
}`;

function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, VS));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(program);
gl.useProgram(program);
export const U = {};
for (const n of ["uView", "uProj", "uBg", "uEye", "uFogFar", "uTime",
                 "uItems", "uTags", "uGray"]) {
  U[n] = gl.getUniformLocation(program, n);
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// Every shape fills the same unit box: x and z centred, y from 0 to 1.
const CENTRE = [0, 0.5, 0];
const FACES = [
  [[.5,0,.5],[.5,0,-.5],[.5,1,-.5],[.5,1,.5]],
  [[-.5,0,-.5],[-.5,0,.5],[-.5,1,.5],[-.5,1,-.5]],
  [[-.5,1,.5],[.5,1,.5],[.5,1,-.5],[-.5,1,-.5]],
  [[-.5,0,.5],[.5,0,.5],[.5,1,.5],[-.5,1,.5]],
  [[.5,0,-.5],[-.5,0,-.5],[-.5,1,-.5],[.5,1,-.5]],
  [[-.5,0,-.5],[.5,0,-.5],[.5,0,.5],[-.5,0,.5]],
];
const boxTriangles = FACES.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);

const square = (y) => [[-.5, y, -.5], [.5, y, -.5], [.5, y, .5], [-.5, y, .5]];
function cone(apexY, baseY) {
  const base = square(baseY);
  return base.map((p, i) => [[0, apexY, 0], p, base[(i + 1) % 4]]);
}
function cap(y) {
  const [a, b, c, d] = square(y);
  return [[a, b, c], [a, c, d]];
}

// An upright column with n sides: its walls, and its top and bottom.
function columnCorner(n, i, y) {
  const around = 2 * Math.PI * i / n;
  return [0.5 * Math.cos(around), y, 0.5 * Math.sin(around)];
}
function columnWalls(n) {
  const triangles = [];
  for (let i = 0; i < n; i++) {
    const a = columnCorner(n, i, 0), b = columnCorner(n, i + 1, 0);
    const c = columnCorner(n, i + 1, 1), d = columnCorner(n, i, 1);
    triangles.push([a, b, c], [a, c, d]);
  }
  return triangles;
}
function columnEnds(n) {
  const triangles = [];
  for (let i = 0; i < n; i++) {
    for (const y of [0, 1]) {
      triangles.push([[0, y, 0], columnCorner(n, i, y),
                      columnCorner(n, i + 1, y)]);
    }
  }
  return triangles;
}

function icosahedronTriangles() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const points = [];
  for (const one of [-1, 1]) {
    for (const big of [-phi, phi]) {
      points.push([0, one, big], [one, big, 0], [big, 0, one]);
    }
  }
  // Neighbouring corners are exactly one edge apart, which is 2 at this scale.
  const near = (a, b) => Math.abs(Math.hypot(...sub(a, b)) - 2) < 1e-6;
  const triangles = [];
  points.forEach((a, i) => points.forEach((b, j) => points.forEach((c, k) => {
    if (i < j && j < k && near(a, b) && near(b, c) && near(a, c)) {
      triangles.push([a, b, c].map(([x, y, z]) =>
        [x / phi / 2, y / phi / 2 + 0.5, z / phi / 2]));
    }
  })));
  return triangles;
}

// Each triangle is wound to face away from the centre, so culling keeps it.
// A round mesh takes its normals straight out from the upright axis.
function verticesOf(triangles, round) {
  const out = [];
  for (const [a, first, second] of triangles) {
    const facet = cross(sub(first, a), sub(second, a));
    const outward = dot(facet, sub(a, CENTRE)) > 0;
    const normal = unit(outward ? facet : facet.map((v) => -v));
    for (const p of outward ? [a, first, second] : [a, second, first]) {
      out.push(...p, ...(round ? unit([p[0], 0, p[2]]) : normal));
    }
  }
  return out;
}

// Indexed by shape.
const MESHES = [
  verticesOf(boxTriangles),
  verticesOf([...cone(1, 0), ...cap(0)]),
  verticesOf([...columnWalls(6), ...columnEnds(6)]),
  [...verticesOf(columnWalls(20), true), ...verticesOf(columnEnds(20))],
  verticesOf(icosahedronTriangles()),
];
gl.bindVertexArray(gl.createVertexArray());
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(MESHES.flat()), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

// Slabs never move: only the time uniform and the item look-up change, so a
// history step or a hover uploads one small texture, however many slabs exist.
// Twelve floats per slab: position, size, plain flag, first commit shown, item,
// tag layer, commit it goes gray at, shade.
// Slabs sit grouped by shape, and each group is one instanced draw.
export const STRIDE = 12;
// In a diff, a block keeps its colour only while it tops its building. Nothing
// is ever gray at or past this commit outside a diff, since t never reaches it.
const NEVER = COMMITS.length;
const grayAt = (file, slab) =>
  DIFF ? file.hits[slab.hit + 1] ?? NEVER : NEVER;
const rowsByShape = MESHES.map(() => []);
FOLDERS.forEach((dir, item) => {
  rowsByShape[BOX].push([dir.x, dir.y, dir.z, dir.w, PLATE, dir.d, 0,
                         dir.first, item, -1, NEVER, 1]);
});
FILES.forEach((file, i) => {
  for (const slab of file.slabs) {
    rowsByShape[slab.shape].push([file.x, file.y + slab.y0, file.z,
      slab.side, slab.y1 - slab.y0, slab.side,
      // A coloured top must read as coloured, even with no lines to show.
      DIFF && file.inDiff ? 0 : slab.plain, file.hits[slab.hit],
      FOLDERS.length + i, file.tag, grayAt(file, slab), file.shade]);
  }
});
export const SLAB_COUNT = rowsByShape.reduce((sum, rows) => sum + rows.length, 0);
const slabData = new Float32Array(rowsByShape.flat(2));
export const BATCHES = [];
{
  let vertex = 0, slab = 0;
  MESHES.forEach((mesh, shape) => {
    BATCHES.push({ first: vertex, vertices: mesh.length / 6,
                   offset: slab * STRIDE * 4, count: rowsByShape[shape].length });
    vertex += mesh.length / 6;
    slab += rowsByShape[shape].length;
  });
}
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
gl.bufferData(gl.ARRAY_BUFFER, slabData, gl.STATIC_DRAW);
[2, 3, 4, 5].forEach((loc) => {
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribDivisor(loc, 1);
});

// One texel per folder and file: its colour, and its emphasis in alpha.
export const ITEMS_W = 1024;
export const ITEMS_H = Math.ceil((FOLDERS.length + FILES.length) / ITEMS_W);
export const looks = new Uint8Array(ITEMS_W * ITEMS_H * 4);
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ITEMS_W, ITEMS_H, 0, gl.RGBA,
              gl.UNSIGNED_BYTE, looks);

// One layer per tag, drawn once. The item texture stays bound to unit 0.
{
  const TAG_PX_W = 256, TAG_PX_H = 128;
  const paper = document.createElement("canvas");
  paper.width = TAG_PX_W;
  paper.height = TAG_PX_H;
  const pen = paper.getContext("2d", { willReadFrequently: true });
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, gl.createTexture());
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY,
    1 + Math.floor(Math.log2(TAG_PX_W)), gl.RGBA8, TAG_PX_W, TAG_PX_H, TAGS.length);
  TAGS.forEach((word, layer) => {
    pen.clearRect(0, 0, TAG_PX_W, TAG_PX_H);
    pen.font = "700 92px ui-monospace, Menlo, Consolas, monospace";
    const fit = Math.min(1, TAG_PX_W * 0.88 / pen.measureText(word).width);
    pen.font = `700 ${Math.floor(92 * fit)}px ui-monospace, Menlo, Consolas, monospace`;
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillStyle = "#fff";
    pen.fillText(word, TAG_PX_W / 2, TAG_PX_H / 2);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TAG_PX_W, TAG_PX_H, 1,
                     gl.RGBA, gl.UNSIGNED_BYTE, paper);
  });
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER,
                   gl.LINEAR_MIPMAP_LINEAR);
  const sharp = gl.getExtension("EXT_texture_filter_anisotropic");
  if (sharp) gl.texParameterf(gl.TEXTURE_2D_ARRAY,
                              sharp.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  gl.uniform1i(U.uTags, 1);
  gl.activeTexture(gl.TEXTURE0);
}
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);
export const BG = rgb("#1a1a19");
gl.clearColor(...BG, 1);
