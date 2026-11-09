/**
 * Oscilloscope Visualizer // Iris High-Contrast Edition
 * Real-time waveform display with hardware-style zero-crossing edge trigger,
 * variable timebase, voltage graticule, and crisp monochromatic beam.
 */

class OscilloscopeVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.timebaseMs = 10;
    this.gain = 1.0;
    this.autoGain = false;
    this.triggerSlope = 'rising';

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

    this._drawGraticule(ctx, w, h);

    if (!this.engine.isCapturing) {
      this._drawIdle(ctx, w, h);
      return;
    }

    const triggered = this.engine.getTriggeredWaveform(this.gain, this.triggerSlope);
    if (!triggered || !triggered.buffer) {
      this._drawIdle(ctx, w, h);
      return;
    }

    const { buffer, startIndex, length, sampleRate } = triggered;
    const midY = h / 2;

    const samplesPerMs = sampleRate / 1000;
    const targetSamples = Math.floor(this.timebaseMs * samplesPerMs);
    const visibleSamples = Math.min(targetSamples, length);

    if (visibleSamples < 2) return;

    let currentGain = this.gain;
    if (this.autoGain) {
      let maxAmp = 0.001;
      for (let i = 0; i < visibleSamples; i++) {
        const amp = Math.abs(buffer[startIndex + i]);
        if (amp > maxAmp) maxAmp = amp;
      }
      currentGain = Math.min(10.0, 0.75 / maxAmp);
    }

    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    ctx.beginPath();
    for (let i = 0; i < visibleSamples; i++) {
      const x = (i / (visibleSamples - 1)) * w;
      const sampleVal = buffer[startIndex + i] * currentGain;
      const clamped = Math.max(-1.0, Math.min(1.0, sampleVal));
      const y = midY - (clamped * (h * 0.44));

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    // High Contrast Beam in Active Tint (No Glow)
    ctx.strokeStyle = tint.rgb();
    ctx.lineWidth = 1.8 * this.dpr;
    ctx.stroke();

    ctx.restore();
  }

  _drawGraticule(ctx, w, h) {
    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    const midY = h / 2;
    ctx.strokeStyle = tint.rgba(0.07);
    ctx.lineWidth = 1;
    ctx.fillStyle = tint.rgba(0.45);
    const fontSize = Math.max(7, Math.min(9, Math.floor(h * 0.075)));
    ctx.font = `${fontSize}px 'Geist', sans-serif`;

    const voltSteps = h < 110 * this.dpr
      ? [
          { ratio: 0.10, label: '+1.0' },
          { ratio: 0.50, label: ' 0.0', isZero: true },
          { ratio: 0.90, label: '-1.0' }
        ]
      : [
          { ratio: 0.08, label: '+1.0' },
          { ratio: 0.29, label: '+0.5' },
          { ratio: 0.50, label: ' 0.0', isZero: true },
          { ratio: 0.71, label: '-0.5' },
          { ratio: 0.92, label: '-1.0' }
        ];

    for (const step of voltSteps) {
      const y = Math.floor(h * step.ratio) + 0.5;
      ctx.beginPath();
      if (step.isZero) {
        ctx.strokeStyle = tint.rgba(0.28);
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = tint.rgba(0.07);
        ctx.setLineDash([3, 4]);
      }
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      const labelY = Math.max(8 * this.dpr, Math.min(h - 4, y - 3));
      ctx.fillText(step.label, 6 * this.dpr, labelY);
    }

    ctx.strokeStyle = tint.rgba(0.05);
    ctx.setLineDash([2, 4]);
    const divisions = 10;
    for (let i = 1; i < divisions; i++) {
      const x = Math.floor((i / divisions) * w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Trigger Point Indicator
    ctx.setLineDash([]);
    ctx.fillStyle = tint.rgb();
    ctx.beginPath();
    ctx.moveTo(2 * this.dpr, midY - (4 * this.dpr));
    ctx.lineTo(8 * this.dpr, midY);
    ctx.lineTo(2 * this.dpr, midY + (4 * this.dpr));
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawIdle(ctx, w, h) {
    const midY = h / 2;
    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    ctx.strokeStyle = tint.rgba(0.15);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    ctx.fillStyle = tint.rgba(0.4);
    ctx.textAlign = 'center';
    ctx.font = `${11 * this.dpr}px 'Geist', sans-serif`;
    ctx.fillText('OSCILLOSCOPE READY', w / 2, midY - (14 * this.dpr));
    ctx.restore();
  }
}

window.OscilloscopeVisualizer = OscilloscopeVisualizer;
