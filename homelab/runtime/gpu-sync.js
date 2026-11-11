// Complete WebGL writes before Canvas2D consumes a GPU-backed source canvas.
(() => {
  const contexts = new WeakMap(), list = [];
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(...args) {
    const context = get.apply(this, args);
    if (context && /^webgl/.test(args[0]) && !contexts.has(this)) {
      contexts.set(this, context);
      list.push(context);
    }
    return context;
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(...args) {
    contexts.get(args[0])?.finish();
    return draw.apply(this, args);
  };
  window.__farmSync = () => { for (const gl of list) gl.finish(); };
})();
