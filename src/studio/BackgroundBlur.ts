import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

// "Depth of field" the way this studio wants it: the build is never blurred. Only pixels further from the
// camera than the model's far edge get a soft disc blur that grows with distance. Samples that land on the
// model are ignored, so sharp bricks never bleed into the background. One pass, reads scene depth directly.

const fragment = /* glsl */ `
uniform float focusEnd;   // world distance where the build ends (everything nearer is perfectly sharp)
uniform float range;      // distance over which blur ramps up to full
uniform float radius;     // max blur radius in pixels
uniform vec2 texel;

float distanceAt(const in float d) { return -getViewZ(d); }
float blurAt(const in float d) { return smoothstep(focusEnd, focusEnd + range, distanceAt(d)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float f = blurAt(depth);
  if (f < 0.002 || radius < 0.01) { outputColor = inputColor; return; }
  vec4 acc = inputColor;
  float w = 1.0;
  for (int i = 0; i < 24; i++) {
    float a = float(i) * 2.39996;                 // golden-angle spiral
    float r = sqrt(float(i) + 0.5) / 4.9;
    vec2 suv = uv + vec2(cos(a), sin(a)) * r * radius * f * texel;
    float sf = blurAt(readDepth(suv));            // only gather from background, never from the model
    acc += texture2D(inputBuffer, suv) * sf;
    w += sf;
  }
  outputColor = acc / w;
}
`;

export class BackgroundBlurEffect extends Effect {
  constructor() {
    super('BackgroundBlurEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['focusEnd', new THREE.Uniform(30)],
        ['range', new THREE.Uniform(10)],
        ['radius', new THREE.Uniform(8)],
        ['texel', new THREE.Uniform(new THREE.Vector2(1 / 1024, 1 / 1024))],
      ]),
    });
  }
  setSize(width: number, height: number) {
    (this.uniforms.get('texel')!.value as THREE.Vector2).set(1 / width, 1 / height);
  }
  set(focusEnd: number, range: number, radius: number) {
    this.uniforms.get('focusEnd')!.value = focusEnd;
    this.uniforms.get('range')!.value = range;
    this.uniforms.get('radius')!.value = radius;
  }
}
