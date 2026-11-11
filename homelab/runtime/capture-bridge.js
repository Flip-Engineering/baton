// Resolve WebGL output explicitly before another canvas consumes it.
(() => {
  const contexts = new WeakMap();
  const cache = new WeakMap();
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(...args) {
    const context = get.apply(this, args);
    if (context && /^webgl/.test(args[0])) contexts.set(this, context);
    return context;
  };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
    const gl = contexts.get(source);
    if (!gl) return draw.call(this, source, ...args);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    let c = cache.get(source);
    if (!c || c.w !== w || c.h !== h) {
      const canvas = document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx = get.call(canvas, '2d', {willReadFrequently:true});
      c = {w,h,canvas,ctx,raw:new Uint8Array(w*h*4),image:ctx.createImageData(w,h)};
      cache.set(source,c);
    }
    const binding=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,c.raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER,binding);
    const error=gl.getError();
    if(error!==gl.NO_ERROR) throw new Error('WebGL canvas readback failed: '+error);
    const dst=c.image.data, stride=w*4;
    for(let y=0;y<h;y++) dst.set(c.raw.subarray((h-1-y)*stride,(h-y)*stride),y*stride);
    if(gl.getContextAttributes().premultipliedAlpha) {
      for(let i=0;i<dst.length;i+=4) {
        const a=dst[i+3];
        if(a>0 && a<255) {dst[i]=dst[i]*255/a;dst[i+1]=dst[i+1]*255/a;dst[i+2]=dst[i+2]*255/a;}
      }
    }
    c.ctx.putImageData(c.image,0,0);
    return draw.call(this,c.canvas,...args);
  };
})();
