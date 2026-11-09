/**
 * Spectrum Analyzer (RTA) // Iris High-Contrast Edition
 * Features:
 * - Acoustic tilt slope compensation (+3.5 dB/oct) preventing bass from clipping
 * - Dynamic adaptive headroom normalization so peaks stay within musical range
 * - Sub-bin fractional interpolation with continuous Catmull-Rom cubic curve
 * - Zero glow, crisp monochromatic high-contrast rendering
 */

class SpectrumVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.mode = 'curve'; // 'curve' | 'led'
    this.minFreq = 20;
    this.maxFreq = 20000;

    // Smoothed values & peak hold
    this.smoothPoints = null;
    this.peakHoldValues = null;

    // Dynamic running peak tracker for adaptive headroom normalization
    this.runningMax = 200;

    // Standard ISO frequency grid ticks
    this.gridTicks = [
      { freq: 30, label: '30' },
      { freq: 60, label: '60' },
      { freq: 120, label: '120' },
      { freq: 250, label: '250' },
      { freq: 500, label: '500' },
      { freq: 1000, label: '1k' },
      { freq: 2000, label: '2k' },
      { freq: 4000, label: '4k' },
      { freq: 8000, label: '8k' },
      { freq: 16000, label: '16k' }
    ];

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

    const freqData = this.engine.getFrequencyData();
    const sampleRate = this.engine.audioCtx ? this.engine.audioCtx.sampleRate : 48000;
    const binCount = freqData ? freqData.length : 2048;
    const nyquist = sampleRate / 2;

    this._drawGrid(ctx, w, h);

    if (!freqData || !this.engine.isCapturing) {
      this._drawIdle(ctx, w, h);
      return;
    }

    if (this.mode === 'led') {
      this._drawLEDMode(ctx, w, h, freqData, binCount, nyquist);
    } else {
      this._drawCurveMode(ctx, w, h, freqData, binCount, nyquist);
    }
  }

  _drawGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    const fontSize = Math.max(7.5, Math.min(9.5, Math.floor(h * 0.08)));
    ctx.font = `${fontSize}px 'Geist', sans-serif`;

    // Horizontal dB lines
    const dbSteps = h < 90 * this.dpr ? [0.35, 0.70] : [0.25, 0.5, 0.75];
    const dbLabels = h < 90 * this.dpr ? ['-12 dB', '-24 dB'] : ['-12 dB', '-24 dB', '-36 dB'];
    for (let i = 0; i < dbSteps.length; i++) {
      const y = Math.floor(h * dbSteps[i]) + 0.5;
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(dbLabels[i], 8 * this.dpr, y - 4);
    }
    ctx.setLineDash([]);

    // Vertical Frequency lines (Dynamically adapted to avoid text collision at any width)
    let ticksToDraw = this.gridTicks;
    if (w < 200 * this.dpr) {
      ticksToDraw = this.gridTicks.filter(t => [60, 1000, 16000].includes(t.freq));
    } else if (w < 320 * this.dpr) {
      ticksToDraw = this.gridTicks.filter(t => [60, 250, 1000, 4000, 16000].includes(t.freq));
    }

    const labelBottomMargin = Math.max(14 * this.dpr, Math.floor(h * 0.12));

    for (const tick of ticksToDraw) {
      const x = Math.floor(this._freqToX(tick.freq, w)) + 0.5;
      if (x >= 0 && x <= w) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h - labelBottomMargin);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillText(tick.label, x, h - (3 * this.dpr));
      }
    }

    ctx.restore();
  }

  _drawCurveMode(ctx, w, h, freqData, binCount, nyquist) {
    const bottomY = h - (18 * this.dpr);
    const usableH = bottomY - 10;
    const numPoints = Math.min(320, Math.max(64, Math.floor(w / 2.5)));

    if (!this.smoothPoints || this.smoothPoints.length !== numPoints) {
      this.smoothPoints = new Float32Array(numPoints).fill(0);
      this.peakHoldValues = new Float32Array(numPoints).fill(0);
    }

    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);
    const rawInterpolated = new Float32Array(numPoints);
    let frameMax = 40;

    // First pass: Calculate fractional bin values and apply acoustic tilt slope
    for (let i = 0; i < numPoints; i++) {
      const norm = i / (numPoints - 1);
      const freq = Math.pow(10, minLog + norm * (maxLog - minLog));

      const floatBin = (freq / nyquist) * binCount;
      const b0 = Math.max(0, Math.min(binCount - 1, Math.floor(floatBin)));
      const b1 = Math.max(0, Math.min(binCount - 1, b0 + 1));
      const frac = floatBin - b0;

      // Cosine smoothing between bins
      const smoothFrac = (1 - Math.cos(frac * Math.PI)) / 2;
      const val0 = freqData[b0] || 0;
      const val1 = freqData[b1] || 0;
      const val = (1 - smoothFrac) * val0 + smoothFrac * val1;

      // Acoustic Tilt Compensation (Normalizes bass vs treble)
      // +3.5 dB/octave slope relative to 1kHz, with low-end shelf so sub-bass doesn't hit ceiling
      let tiltWeight = 1.0;
      if (freq < 80) {
        // Tame sub-bass bump
        tiltWeight = 0.55 + (freq / 80) * 0.25;
      } else {
        // Linear slope across audible mids and highs
        tiltWeight = 0.8 + Math.pow(freq / 1000, 0.22) * 0.35;
      }

      const tiltedVal = val * tiltWeight;
      rawInterpolated[i] = tiltedVal;
      if (tiltedVal > frameMax) frameMax = tiltedVal;
    }

    // Adaptive peak tracking to keep peaks around 82% of height
    this.runningMax += (Math.max(160, frameMax) - this.runningMax) * 0.08;
    const normalizer = this.runningMax;

    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const norm = i / (numPoints - 1);
      const normalizedNorm = Math.min(0.96, (rawInterpolated[i] / normalizer) * 0.84);

      // Smooth attack & release
      const current = this.smoothPoints[i];
      const factor = normalizedNorm > current ? 0.6 : 0.25;
      this.smoothPoints[i] += (normalizedNorm - current) * factor;

      const normVal = this.smoothPoints[i];
      const px = norm * w;
      const py = bottomY - (normVal * usableH);

      points.push({ x: px, y: py, val: normVal });

      if (normVal >= this.peakHoldValues[i]) {
        this.peakHoldValues[i] = normVal;
      } else {
        this.peakHoldValues[i] = Math.max(0, this.peakHoldValues[i] - 0.005);
      }
    }

    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };

    // 1. Monochromatic / Phosphor Gradient Area
    const grad = ctx.createLinearGradient(0, 0, 0, bottomY);
    grad.addColorStop(0, tint.rgba(0.32));
    grad.addColorStop(0.5, tint.rgba(0.12));
    grad.addColorStop(1, tint.rgba(0.0));

    ctx.beginPath();
    ctx.moveTo(points[0].x, bottomY);
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    const lastPt = points[points.length - 1];
    ctx.lineTo(lastPt.x, lastPt.y);
    ctx.lineTo(w, bottomY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 2. Crisp Vector Trace Line (No Glow)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    ctx.lineTo(lastPt.x, lastPt.y);

    ctx.strokeStyle = tint.rgb();
    ctx.lineWidth = 2 * this.dpr;
    ctx.stroke();

    // 3. Peak Hold Line
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x;
      const py = bottomY - (this.peakHoldValues[i] * usableH);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = tint.rgba(0.65);
    ctx.lineWidth = 1 * this.dpr;
    ctx.stroke();

    ctx.restore();
  }

  _drawLEDMode(ctx, w, h, freqData, binCount, nyquist) {
    const bottomY = h - (18 * this.dpr);
    const usableH = bottomY - 10;
    const numBars = Math.min(54, Math.floor(w / 12));
    const gap = 2.5 * this.dpr;
    const barWidth = (w - (numBars - 1) * gap) / numBars;
    const ledSegments = 24;
    const segH = Math.max(2, (usableH / ledSegments) - (2 * this.dpr));

    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    for (let i = 0; i < numBars; i++) {
      const norm = i / (numBars - 1);
      const freq = this._xToFreq(norm * w, w);

      const floatBin = (freq / nyquist) * binCount;
      const b0 = Math.max(0, Math.min(binCount - 1, Math.floor(floatBin)));
      const b1 = Math.max(0, Math.min(binCount - 1, b0 + 1));
      const frac = floatBin - b0;
      const val = (1 - frac) * (freqData[b0] || 0) + frac * (freqData[b1] || 0);

      let tiltWeight = freq < 80 ? 0.6 + (freq / 80) * 0.25 : 0.8 + Math.pow(freq / 1000, 0.22) * 0.35;
      const normVal = Math.min(1.0, (val * tiltWeight) / 240);
      const activeSegs = Math.floor(normVal * ledSegments);
      const x = i * (barWidth + gap);

      for (let s = 0; s < ledSegments; s++) {
        const segY = bottomY - (s + 1) * (segH + (2 * this.dpr));
        const isActive = s < activeSegs;

        if (isActive) {
          const segRatio = s / ledSegments;
          ctx.fillStyle = segRatio > 0.85 ? tint.rgb() : tint.rgba(0.85);
        } else {
          ctx.fillStyle = tint.rgba(0.05);
        }

        ctx.fillRect(x, segY, barWidth, segH);
      }
    }
    ctx.restore();
  }

  _drawIdle(ctx, w, h) {
    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    const bottomY = h - (18 * this.dpr);
    ctx.strokeStyle = tint.rgba(0.15);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    ctx.lineTo(w, bottomY);
    ctx.stroke();

    ctx.fillStyle = tint.rgba(0.4);
    ctx.textAlign = 'center';
    ctx.font = `${11 * this.dpr}px 'Geist', sans-serif`;
    ctx.fillText('AWAITING AUDIO SIGNAL...', w / 2, h / 2);
    ctx.restore();
  }

  _freqToX(freq, w) {
    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);
    const freqLog = Math.log10(Math.max(this.minFreq, Math.min(this.maxFreq, freq)));
    return ((freqLog - minLog) / (maxLog - minLog)) * w;
  }

  _xToFreq(x, w) {
    const minLog = Math.log10(this.minFreq);
    const maxLog = Math.log10(this.maxFreq);
    const norm = Math.max(0, Math.min(1, x / w));
    return Math.pow(10, minLog + norm * (maxLog - minLog));
  }
}

window.SpectrumVisualizer = SpectrumVisualizer;
