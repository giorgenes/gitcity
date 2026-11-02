import { SPAN } from "./layout.js";
import { camera, state } from "./state.js";
import { unit, sub, cross, dot, canvas, gl } from "./renderer.js";

// ---- Camera maths ------------------------------------------------------

function eye() {
  const { target: t, theta, phi, dist } = camera;
  return [t[0] + dist * Math.sin(phi) * Math.sin(theta),
          t[1] + dist * Math.cos(phi),
          t[2] + dist * Math.sin(phi) * Math.cos(theta)];
}

export function basis() {
  const e = eye();
  const f = unit(sub(camera.target, e));
  const r = unit(cross(f, [0, 1, 0]));
  return { e, f, r, u: cross(r, f) };
}

export const FOV = 45 * Math.PI / 180;
export function matrices() {
  const { e, f, r, u } = basis();
  const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
  const near = Math.max(0.5, camera.dist / 200);
  const far = camera.dist + SPAN * 4;
  const k = 1 / Math.tan(FOV / 2);
  const aspect = canvas.width / canvas.height;
  const proj = [k / aspect, 0, 0, 0, 0, k, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0];
  return { view, proj, e };
}

export function project(p, m) {
  const x = p[0], y = p[1], z = p[2], v = m.view, q = m.proj;
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
  if (vz > -0.1) return null;
  const w = -vz;
  return { x: (q[0] * vx / w + 1) / 2 * innerWidth,
           y: (1 - q[5] * vy / w) / 2 * innerHeight };
}

export function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * ratio);
  canvas.height = Math.round(innerHeight * ratio);
  gl.viewport(0, 0, canvas.width, canvas.height);
  state.dirty = true;
}
addEventListener("resize", resize);
