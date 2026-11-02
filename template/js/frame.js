import { UNCHANGED } from "./model.js";
import { SPAN } from "./layout.js";
import { state, camera } from "./state.js";
import { rgb } from "./colour.js";
import { gl, U, BG, BATCHES, STRIDE } from "./renderer.js";
import { matrices } from "./camera.js";
import { drawLabels } from "./labels.js";
import { stepPlayback } from "./time.js";

// ---- Frame loop --------------------------------------------------------

export function frame(now) {
  requestAnimationFrame(frame);
  if (state.playing) stepPlayback(now);
  if (state.fly) {
    const u = Math.min(1, (now - (state.fly.start ??= now)) / 650);
    const k = u * u * (3 - 2 * u);
    camera.dist = state.fly.dist0 + (state.fly.dist1 - state.fly.dist0) * k;
    camera.target = state.fly.t0.map((v, i) => v + (state.fly.t1[i] - v) * k);
    state.dirty = true;
    if (u === 1) state.fly = null;
  }
  if (!state.dirty) return;
  state.dirty = false;
  const m = matrices();
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uView, false, m.view);
  gl.uniformMatrix4fv(U.uProj, false, m.proj);
  gl.uniform3fv(U.uBg, BG);
  gl.uniform3fv(U.uEye, m.e);
  gl.uniform1f(U.uFogFar, camera.dist + SPAN * 2);
  gl.uniform1f(U.uTime, state.t);
  gl.uniform3fv(U.uGray, rgb(UNCHANGED));
  for (const batch of BATCHES) {
    [2, 3, 4, 5].forEach((loc, at) => {
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, STRIDE * 4,
                             batch.offset + at * 12);
    });
    gl.drawArraysInstanced(gl.TRIANGLES, batch.first, batch.vertices,
                           batch.count);
  }
  drawLabels(m);
}
