// Imported by the external farm adapter; canonical scene files stay untouched.
export * from '/web/node_modules/three/build/three.module.js';
import { WebGLRenderer as Base } from '/web/node_modules/three/build/three.module.js';

export class WebGLRenderer extends Base {
  constructor(...args) {
    super(...args);
    const render = this.render;
    this.render = (scene, camera) => {
      // Prepare material programs before drawing, including new light variants.
      this.compile(scene, camera);
      return render.call(this, scene, camera);
    };
  }
}
