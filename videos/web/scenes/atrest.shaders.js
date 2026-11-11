// AT REST: the scene's own passes (the polariscope's shader is lib/fx/objective/polariscope.js). GLSL ES 3.00 programs, as data, so
// web/labs/objective/glsl_check.mjs compiles them offline. The one display transform is light/display.js's (DISPLAY_GLSL).
//   composite  the instrument's image (the drop, band radiance x the band's colour + the blob's glow), the world through the window where
//              the window panel has lifted (its own colour, through the analyser at half), the bench's props over both (LitRenderer's
//              scene-linear accumulation with its own coverage), then the display transform and a sensor's grain
//   blur       a disc gather (the lens's out-of-focus disc) for the world layer and the props' coverage
//   copy       a float copy (LitRenderer's accumulator into a layer)
import { DISPLAY_GLSL } from '../lib/fx/light/display.js';
import { SWITCH_GLSL } from '../lib/fx/objective/switch.js';

const VERT = /* glsl */`in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMPOSITE = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D tDrop, tProps, tCov, tWorld;
uniform vec2 uRes;
uniform float uDropGain, uPropsGain, uWorldGain, uPropsOn, uWorldOn, uGrain, uFrame;
uniform vec4 uPanel; uniform float uPanelR, uPanelOn;
uniform vec4 uFlash; uniform vec3 uFlashCol;   // c22: the break's flash: centre (px, from the bottom), amount, radius (px)
${DISPLAY_GLSL}
${SWITCH_GLSL}
float h12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main(){
  vec2 px = vUv * uRes;
  vec3 c = texture(tDrop, vUv).rgb * uDropGain;
  if (uPanelOn > 0.5) {
    // the window panel (polariser + sodium filter) lifts: where it has gone the world shows in its own colour, through the analyser at half
    float m = slideAmount(uPanel, uPanelR, vec2(px.x, uRes.y - px.y));
    c = mix(texture(tWorld, vUv).rgb * uWorldGain, c, m);
  } else if (uWorldOn > 0.5) c += texture(tWorld, vUv).rgb * uWorldGain;
  if (uPropsOn > 0.5) { float cov = clamp(texture(tCov, vUv).r, 0.0, 1.0); c = c * (1.0 - cov) + texture(tProps, vUv).rgb * uPropsGain; }
  if (uFlash.z > 0.0) { float r = length(px - uFlash.xy); c += uFlashCol * uFlash.z * (exp(-r / uFlash.w) + 0.3 * exp(-r / (4.0 * uFlash.w)) + 0.05); }
  vec3 d = acpDisplay(max(c, vec3(0.0)));
  // the sensor's grain: luminance-weighted, small (the instrument is clean; this keeps flat black from banding on a phone)
  float g = (h12(px + fract(uFrame * 0.618) * 913.0) - 0.5) * uGrain * (0.35 + 0.65 * sqrt(max(dot(d, vec3(0.333)), 0.0)));
  outColor = vec4(clamp(d + g, 0.0, 1.0), 1.0);
}`;

const BLUR = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uR;   // radius in source texels
void main(){
  if (uR < 0.5) { outColor = texture(tIn, vUv); return; }
  vec4 acc = vec4(0.0); float w = 0.0;
  const int N = 64;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + 0.5) / float(N), a = float(i) * 2.39996323, r = sqrt(f) * uR;
    acc += texture(tIn, vUv + vec2(cos(a), sin(a)) * r * uTexel); w += 1.0;
  }
  outColor = acc / w;
}`;

const COPY = /* glsl */`
precision highp float;
in vec2 vUv; out vec4 outColor; uniform sampler2D tIn; uniform float uK;
void main(){ outColor = texture(tIn, vUv) * uK; }`;

export const PROGRAMS = { composite: { vert: VERT, frag: COMPOSITE }, blur: { vert: VERT, frag: BLUR }, copy: { vert: VERT, frag: COPY } };
