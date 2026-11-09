/**
 * Spectrogram (Waterfall) Visualizer // Iris Monochrome Edition
 * Continuous scrolling 2D frequency-time waterfall with fractional
 * bin interpolation, temporal smoothing, and high-contrast monochrome gradient.
 */

class SpectrogramVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.speed = 1.5;
    this.minFreq = 25;
    this.maxFreq = 18000;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

    this.backCanvas = document.createElement('canvas');
    this.backCtx = this.backCanvas.getContext('2d', { willReadFrequently: true });

    this.colorLut = new Uint32Array(256);
    this._initMonochromeLut();

    this.smoothValues = null;

    this.resize();
  }

  _initMonochromeLut() {
    const tint = window.__IRIS_TINT__ || {
      rgba: a => `rgba(237, 237, 237, ${a})`,
      rgb: () => '#EDEDED'
    };

    // Phosphor tinted waterfall LUT
    const gradCanvas = document.createElement('canvas');
    gradCanvas.width = 256;
    gradCanvas.height = 1;
    const gradCtx = gradCanvas.getContext('2d');

    const grad = gradCtx.createLinearGradient(0, 0, 255, 0);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.95)');
    grad.addColorStop(0.2, tint.rgba(0.20));
    grad.addColorStop(0.5, tint.rgba(0.52));
    grad.addColorStop(0.8, tint.rgba(0.82));
    grad.addColorStop(1.0, tint.rgba(1.0));

    gradCtx.fillStyle = grad;
    gradCtx.fillRect(0, 0, 256, 1);
    const imgData = gradCtx.getImageData(0, 0, 256, 1);
    const buf32 = new Uint32Array(imgData.data.buffer);

    for (let i = 0; i < 256; i++) {
      this.colorLut[i] = buf32[i];
    }
  }

  resize() {
    if (!this.canvas || this.canvas.offsetParent === null) return;

    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(30, Math.floor(rect.width * dpr));
    const h = Math.max(30, Math.floor(rect.height * dpr));

    this.canvas.width = w;
    this.canvas.height = h;
    this.dpr = dpr;

    this.smoothValues = new Float32Array(w).fill(0);

    let oldImg = null;
    if (this.offscreenCanvas.width > 0 && this.offscreenCanvas.height > 0) {
      try {
        oldImg = this.offscreenCtx.getImageData(0, 0, this.offscreenCanvas.width, this.offscreenCanvas.height);
      } catch (e) {}
    }

    this.offscreenCanvas.width = w;
    this.offscreenCanvas.height = h;
    this.backCanvas.width = w;
    this.backCanvas.height = h;

    this.offscreenCtx.imageSmoothingEnabled = true;
    this.offscreenCtx.imageSmoothingQuality = 'high';
    this.backCtx.imageSmoothingEnabled = true;
    this.backCtx.imageSmoothingQuality = 'high';

    if (oldImg && oldImg.width > 0 && oldImg.height > 0) {
      try {
        this.offscreenCtx.putImageData(oldImg, 0, 0);
      } catch (e) {}
    } else {
      this.offscreenCtx.fillStyle = '#000000';
      this.offscreenCtx.fillRect(0, 0, w, h);
    }
  }

  render(theme) {
    if (!this.canvas || this.canvas.offsetParent === null) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 30 || h < 30) return;

    const freqData = this.engine.getFrequencyData();
    const sampleRate = this.engine.audioCtx ? this.engine.audioCtx.sampleRate : 48000;
    const binCount = freqData ? freqData.length : 2048;
    const nyquist = sampleRate / 2;

    const shiftY = Math.max(1, Math.floor(this.speed * this.dpr));
    if (h <= shiftY) return;

    // Shift previous contents using secondary buffer to prevent same-canvas blit artifacts
    this.backCtx.drawImage(this.offscreenCanvas, 0, 0, w, h - shiftY, 0, shiftY, w, h - shiftY);

    const rowImg = this.backCtx.createImageData(w, shiftY);
    const rowBuf = new Uint32Array(rowImg.data.buffer);

    if (!this.smoothValues || this.smoothValues.length !== w) {
      this.smoothValues = new Float32Array(w).fill(0);
    }

    if (freqData && this.engine.isCapturing) {
      const minLog = Math.log10(this.minFreq);
      const maxLog = Math.log10(this.maxFreq);

      for (let x = 0; x < w; x++) {
        const norm = x / w;
        const freq = Math.pow(10, minLog + norm * (maxLog - minLog));

        const floatBin = (freq / nyquist) * binCount;
        const b0 = Math.max(0, Math.min(binCount - 1, Math.floor(floatBin)));
        const b1 = Math.max(0, Math.min(binCount - 1, b0 + 1));
        const frac = floatBin - b0;

        const rawVal0 = freqData[b0] || 0;
        const rawVal1 = freqData[b1] || 0;
        const interpolatedVal = (1 - frac) * rawVal0 + frac * rawVal1;

        this.smoothValues[x] += (interpolatedVal - this.smoothValues[x]) * 0.45;
        const finalVal = Math.max(0, Math.min(255, Math.floor(this.smoothValues[x])));

        const color = this.colorLut[finalVal];

        for (let row = 0; row < shiftY; row++) {
          rowBuf[row * w + x] = color;
        }
      }
    } else {
      const idleColor = this.colorLut[0];
      rowBuf.fill(idleColor);
    }

    this.backCtx.putImageData(rowImg, 0, 0);

    // Swap back into main offscreen canvas
    this.offscreenCtx.drawImage(this.backCanvas, 0, 0);

    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.offscreenCanvas, 0, 0);

    this._drawOverlayLabels(this.ctx, w, h);
  }

  _drawOverlayLabels(ctx, w, h) {
    ctx.save();
    const fontSize = Math.max(7, Math.min(9, Math.floor(h * 0.075)));
    ctx.font = `${fontSize}px 'Geist', sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.textAlign = 'center';

    const isCompact = w < 240 * this.dpr;
    const ticks = isCompact ? [100, 1000, 10000] : [50, 200, 1000, 5000, 15000];
    const labels = isCompact ? ['100Hz', '1kHz', '10kHz'] : ['50Hz', '200Hz', '1kHz', '5kHz', '15kHz'];
    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);

    for (let i = 0; i < ticks.length; i++) {
      const freqLog = Math.log10(ticks[i]);
      const x = ((freqLog - minLog) / (maxLog - minLog)) * w;
      ctx.fillText(labels[i], x, h - (4 * this.dpr));
    }
    ctx.restore();
  }
}

window.SpectrogramVisualizer = SpectrogramVisualizer;
