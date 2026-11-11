const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const sourcePath = path.join(__dirname, '../scenes/machines_e1_plant.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function figuresClass() {
  const start = source.indexOf('export class Figures {');
  assert.notEqual(start, -1, 'Figures class exists');
  const declaration = source.slice(start).replace('export class Figures {', 'class Figures {');
  const THREE = {
    Box3: class Box3 {},
    PerspectiveCamera: class PerspectiveCamera {},
    MathUtils: { degToRad: value => value * Math.PI / 180 }
  };
  class Stage {
    constructor() { this.scene = {}; this.renderer = { setClearColor() {} }; }
    fit() {}
  }
  class People {
    constructor() {}
    add() { return 1; }
    static varied() { return {}; }
  }
  const document = { createElement: () => ({}) };
  const SKIES = { night: {} };
  const rng = () => () => 0.5;
  const V3 = () => ({});
  return new Function('THREE', 'Stage', 'SKIES', 'People', 'rng', 'V3', 'document',
    `${declaration}\nreturn Figures;`)(THREE, Stage, SKIES, People, rng, V3, document);
}

test('Figures exposes the walkers renderer method on constructed instances', () => {
  const Figures = figuresClass();
  const figures = new Figures(1920, 1080);
  assert.equal(typeof figures.walkers, 'function');
  assert.ok(Array.isArray(figures.walkerActors));
});
