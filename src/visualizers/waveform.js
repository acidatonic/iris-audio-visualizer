/**
 * Waveform Visualizer // Iris Pure Audio Edition
 * Direct real-time visualization of raw PCM audio entering the PC.
 * - 100% Dynamic, instantaneous response to sound transients and vibrations.
 * - Zero outlines, zero static blocks.
 * - Two modes:
 *     1. 'bars': High-contrast vertical sample rays bursting from the center baseline.
 *     2. 'wave': Pure vibrating oscillogram waveform line through the center axis.
 */

class WaveformVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.mode = 'bars'; // 'bars' (default pure live rays) | 'wave' (pure vibrating wave line)

    this.resize();
  }

  resize() {
    if (!this.canvas || this.canvas.offsetParent === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(20, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(20, Math.floor(rect.height * dpr));
    this.dpr = dpr;
  }

  render(theme) {
    if (!this.canvas || this.canvas.offsetParent === null) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w < 20 || h < 20) return;

    ctx.clearRect(0, 0, w, h);

    const midY = Math.floor(h / 2);
    const dpr = this.dpr;

    // Center Reference Baseline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Subtle +/- 0.5 amplitude tick guides
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.setLineDash([2, 4]);
    const guideOffset = Math.floor(h * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, midY - guideOffset);
    ctx.lineTo(w, midY - guideOffset);
    ctx.moveTo(0, midY + guideOffset);
    ctx.lineTo(w, midY + guideOffset);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!this.engine.isCapturing || !this.engine.mainWaveData) {
      this._renderIdle(ctx, w, h, midY);
      return;
    }

    const buffer = this.engine.mainWaveData;
    const len = buffer.length;
    if (len < 10) {
      this._renderIdle(ctx, w, h, midY);
      return;
    }

    // Check if essentially silent
    let sumSq = 0;
    for (let i = 0; i < len; i += 8) {
      sumSq += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSq / (len / 8));
    if (rms < 0.0008) {
      this._renderIdle(ctx, w, h, midY);
      return;
    }

    const amp = h * 0.46;

    if (this.mode === 'bars') {
      this._renderLiveBars(ctx, w, h, midY, buffer, len, amp, dpr);
    } else {
      this._renderLiveWave(ctx, w, h, midY, buffer, len, amp, dpr);
    }
  }

  _renderLiveBars(ctx, w, h, midY, buffer, len, amp, dpr) {
    // Pure vertical sample rays originating from center baseline (NO OUTLINE)
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    const step = len / w;
    const rayWidth = Math.max(1.2 * dpr, 1.5);

    ctx.fillStyle = tint.rgb();
    for (let x = 0; x < w; x++) {
      const idx = Math.floor(x * step);
      const val = Math.max(-1.0, Math.min(1.0, buffer[idx] || 0));
      const hVal = Math.round(val * amp);

      if (hVal !== 0) {
        const topY = hVal > 0 ? midY - hVal : midY;
        const barHeight = Math.abs(hVal);
        ctx.fillRect(x, topY, rayWidth, barHeight);
      }
    }

    // Live telemetry badge
    ctx.font = `700 ${Math.max(7.5, Math.floor(8 * dpr))}px 'Geist', sans-serif`;
    ctx.fillStyle = tint.rgba(0.65);
    ctx.textAlign = 'left';
    ctx.fillText('LIVE PCM // RAW AUDIO RAYS', 8 * dpr, 12 * dpr);
  }

  _renderLiveWave(ctx, w, h, midY, buffer, len, amp, dpr) {
    // Pure vibrating audio signal polyline through the center axis (NO OUTLINE)
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    const step = len / w;

    ctx.save();

    // 1. Delicate sheer fill towards center baseline
    ctx.beginPath();
    ctx.moveTo(0, midY);
    for (let x = 0; x < w; x++) {
      const idx = Math.floor(x * step);
      const val = Math.max(-1.0, Math.min(1.0, buffer[idx] || 0));
      const y = midY - (val * amp);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, midY);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, tint.rgba(0.28));
    fillGrad.addColorStop(0.5, tint.rgba(0.02));
    fillGrad.addColorStop(1, tint.rgba(0.28));
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // 2. High-contrast vibrating audio wave trace in active tint
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = Math.floor(x * step);
      const val = Math.max(-1.0, Math.min(1.0, buffer[idx] || 0));
      const y = midY - (val * amp);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = tint.rgb();
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();

    // Live telemetry badge
    ctx.font = `700 ${Math.max(7.5, Math.floor(8 * dpr))}px 'Geist', sans-serif`;
    ctx.fillStyle = tint.rgba(0.65);
    ctx.textAlign = 'left';
    ctx.fillText('LIVE PCM // PURE WAVE', 8 * dpr, 12 * dpr);

    ctx.restore();
  }

  _renderIdle(ctx, w, h, midY) {
    const dpr = this.dpr;
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    ctx.fillStyle = tint.rgba(0.4);
    ctx.font = `600 ${Math.max(7.5, Math.floor(8 * dpr))}px 'Geist', sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText('LIVE PCM // IDLE', 8 * dpr, 12 * dpr);
  }
}

window.WaveformVisualizer = WaveformVisualizer;
