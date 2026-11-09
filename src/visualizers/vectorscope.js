/**
 * Stereo Vectorscope / Stereometer // Iris High-Contrast Edition
 * Features:
 * - "Rhombus" (Diamond) and "Circle" boundary modes
 * - "Dots" (Phosphor particle cloud) and "Line" (Lissajous trace) modes
 * - Dynamic Auto-Gain boost for clear visibility even at whisper-quiet volumes
 * - Zero glow, crisp monochromatic high-contrast rendering
 * - Phase Correlation meter (-1.0 to +1.0)
 */

class VectorscopeVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.shapeMode = 'diamond'; // 'diamond' | 'circle'
    this.renderMode = 'dots';   // 'dots' | 'line'
    this.autoGain = true;
    this.manualGain = 1.0;

    this.currentAutoGain = 1.0;

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

    const correlationH = Math.min(32 * this.dpr, Math.floor(h * 0.22));
    const scopeH = h - correlationH;
    const centerX = w / 2;
    const centerY = scopeH / 2;

    // Calibrate radius with margin so labels 'M', 'S', '+L', '+R' never clip against canvas boundaries
    const maxRadiusX = centerX - (18 * this.dpr);
    const maxRadiusY = centerY - (12 * this.dpr);
    const radius = Math.max(15, Math.min(maxRadiusX, maxRadiusY) * 0.88);

    if (this.shapeMode === 'diamond') {
      this._drawDiamondGraticule(ctx, centerX, centerY, radius);
    } else {
      this._drawCircleGraticule(ctx, centerX, centerY, radius);
    }

    this._drawCorrelationBar(ctx, w, h, correlationH);

    if (!this.engine.isCapturing) {
      this._drawIdle(ctx, centerX, centerY);
      return;
    }

    const stereo = this.engine.getStereoWaveforms();
    if (!stereo || !stereo.left || !stereo.right) return;

    const left = stereo.left;
    const right = stereo.right;
    const len = Math.min(left.length, right.length);
    if (len < 10) return;

    // Calculate Peak and RMS for balanced dynamic auto-scaling
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < len; i += 2) {
      const absL = Math.abs(left[i]);
      const absR = Math.abs(right[i]);
      if (absL > peak) peak = absL;
      if (absR > peak) peak = absR;
      sumSq += absL * absL + absR * absR;
    }
    const rms = Math.sqrt(sumSq / len);

    let targetGain = this.manualGain;
    if (this.autoGain) {
      if (peak > 0.002) {
        // Target peak excursions around 68% of the boundary to provide generous headroom.
        // Even very quiet audio is cleanly lifted without slamming against the perimeter.
        const idealGain = 0.68 / Math.max(0.20, peak);
        targetGain = Math.max(0.75, Math.min(3.2, idealGain));
      } else {
        targetGain = 1.0;
      }
    }
    // Asymmetric smoothing: fast attack to prevent boundary overshoots, smooth musical decay
    const smoothFactor = targetGain < this.currentAutoGain ? 0.28 : 0.08;
    this.currentAutoGain += (targetGain - this.currentAutoGain) * smoothFactor;

    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };

    // Serene idle crosshair if signal is essentially silent
    if (rms < 0.0006) {
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.fillStyle = tint.rgba(0.4);
      ctx.beginPath();
      ctx.arc(0, 0, 2 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    const effectiveGain = this.currentAutoGain;
    const cos45 = 0.70710678;

    ctx.save();
    ctx.translate(centerX, centerY);

    // STRICT CLIPPING TO SELECTED SHAPE (GUARANTEES ZERO DATA BLEEDS OUTSIDE)
    ctx.beginPath();
    if (this.shapeMode === 'diamond') {
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius, 0);
      ctx.lineTo(0, radius);
      ctx.lineTo(-radius, 0);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
    ctx.clip();

    const numPoints = 500;
    const step = Math.max(1, Math.floor(len / numPoints));

    if (this.renderMode === 'dots') {
      // High contrast crisp white dots with subtle dynamic alpha
      const dotRadius = Math.max(1.2 * this.dpr, 1.5);

      for (let i = 0; i < len; i += step) {
        const l = left[i] * effectiveGain;
        const r = right[i] * effectiveGain;

        let px, py;
        if (this.shapeMode === 'circle') {
          // Conformal disc mapping: maps square audio domain to circular domain so it fills the circle naturally
          const cl = Math.max(-1.0, Math.min(1.0, l));
          const cr = Math.max(-1.0, Math.min(1.0, r));
          const u = cl * Math.sqrt(Math.max(0, 1 - (cr * cr) * 0.5));
          const v = cr * Math.sqrt(Math.max(0, 1 - (cl * cl) * 0.5));
          px = (v - u) * cos45 * radius;
          py = -(u + v) * cos45 * radius;

          const dist = Math.hypot(px, py);
          if (dist > radius) {
            const s = radius / dist;
            px *= s;
            py *= s;
          }
        } else {
          // Rhombus mode: traditional rotated matrix with Manhattan boundary clamp
          px = (r - l) * cos45 * radius;
          py = -(l + r) * cos45 * radius;

          const manhattan = Math.abs(px) + Math.abs(py);
          if (manhattan > radius) {
            const s = radius / manhattan;
            px *= s;
            py *= s;
          }
        }

        ctx.fillStyle = tint.rgba(0.85);
        ctx.beginPath();
        ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // LINE TRACE MODE: Smoothed organic Lissajous curves (Zero sharp spikes)
      const rawPoints = [];
      const linePointsCount = 200;
      const lineStep = Math.max(1, Math.floor(len / linePointsCount));

      for (let i = 0; i < len; i += lineStep) {
        const l = left[i] * effectiveGain;
        const r = right[i] * effectiveGain;

        let px, py;
        if (this.shapeMode === 'circle') {
          const cl = Math.max(-1.0, Math.min(1.0, l));
          const cr = Math.max(-1.0, Math.min(1.0, r));
          const u = cl * Math.sqrt(Math.max(0, 1 - (cr * cr) * 0.5));
          const v = cr * Math.sqrt(Math.max(0, 1 - (cl * cl) * 0.5));
          px = (v - u) * cos45 * radius;
          py = -(u + v) * cos45 * radius;

          const dist = Math.hypot(px, py);
          if (dist > radius) {
            const s = radius / dist;
            px *= s;
            py *= s;
          }
        } else {
          px = (r - l) * cos45 * radius;
          py = -(l + r) * cos45 * radius;

          const manhattan = Math.abs(px) + Math.abs(py);
          if (manhattan > radius) {
            const s = radius / manhattan;
            px *= s;
            py *= s;
          }
        }

        rawPoints.push({ x: px, y: py });
      }

      // 5-Point Gaussian Spatial Smoothing to eliminate harsh angular spikes
      const n = rawPoints.length;
      if (n > 3) {
        const smoothed = [];
        for (let i = 0; i < n; i++) {
          const p0 = rawPoints[Math.max(0, i - 2)];
          const p1 = rawPoints[Math.max(0, i - 1)];
          const p2 = rawPoints[i];
          const p3 = rawPoints[Math.min(n - 1, i + 1)];
          const p4 = rawPoints[Math.min(n - 1, i + 2)];

          const sx = p0.x * 0.06 + p1.x * 0.24 + p2.x * 0.40 + p3.x * 0.24 + p4.x * 0.06;
          const sy = p0.y * 0.06 + p1.y * 0.24 + p2.y * 0.40 + p3.y * 0.24 + p4.y * 0.06;
          smoothed.push({ x: sx, y: sy });
        }

        // Draw with Midpoint Quadratic Bezier Splines for silky smooth curves
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(smoothed[0].x, smoothed[0].y);

        for (let i = 1; i < smoothed.length - 1; i++) {
          const curr = smoothed[i];
          const next = smoothed[i + 1];
          const midX = (curr.x + next.x) * 0.5;
          const midY = (curr.y + next.y) * 0.5;
          ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
        }

        const last = smoothed[smoothed.length - 1];
        ctx.lineTo(last.x, last.y);

        ctx.strokeStyle = tint.rgb();
        ctx.lineWidth = 1.6 * this.dpr;
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawDiamondGraticule(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${Math.max(9, Math.floor(9 * this.dpr))}px 'Geist', sans-serif`;

    // Outer Diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();

    // Inner Diamond
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(cx, cy - (r * 0.5));
    ctx.lineTo(cx + (r * 0.5), cy);
    ctx.lineTo(cx, cy + (r * 0.5));
    ctx.lineTo(cx - (r * 0.5), cy);
    ctx.closePath();
    ctx.stroke();

    // Cross axes
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    // Diagonal channels (+L / +R)
    ctx.setLineDash([1, 4]);
    const diag = r * 0.7071;
    ctx.beginPath();
    ctx.moveTo(cx - diag, cy - diag);
    ctx.lineTo(cx + diag, cy + diag);
    ctx.moveTo(cx + diag, cy - diag);
    ctx.lineTo(cx - diag, cy + diag);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', cx, cy - r - (8 * this.dpr));
    ctx.fillText('S', cx + r + (8 * this.dpr), cy);
    ctx.fillText('+L', cx - diag - (8 * this.dpr), cy - diag - (6 * this.dpr));
    ctx.fillText('+R', cx + diag + (8 * this.dpr), cy - diag - (6 * this.dpr));

    ctx.restore();
  }

  _drawCircleGraticule(ctx, cx, cy, r) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = `${Math.max(9, Math.floor(9 * this.dpr))}px 'Geist', sans-serif`;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    ctx.setLineDash([1, 4]);
    const diag = r * 0.7071;
    ctx.beginPath();
    ctx.moveTo(cx - diag, cy - diag);
    ctx.lineTo(cx + diag, cy + diag);
    ctx.moveTo(cx + diag, cy - diag);
    ctx.lineTo(cx - diag, cy + diag);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', cx, cy - r - (8 * this.dpr));
    ctx.fillText('S', cx + r + (8 * this.dpr), cy);
    ctx.fillText('+L', cx - diag - (8 * this.dpr), cy - diag - (6 * this.dpr));
    ctx.fillText('+R', cx + diag + (8 * this.dpr), cy - diag - (6 * this.dpr));

    ctx.restore();
  }

  _drawCorrelationBar(ctx, w, h, barH) {
    const correlation = this.engine.getPhaseCorrelation();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    const usableW = Math.max(40, w - (36 * this.dpr));
    const startX = 18 * this.dpr;
    const barMidX = startX + usableW / 2;
    const height = 6 * this.dpr;
    const y = h - (16 * this.dpr);

    ctx.save();
    // Bar track
    ctx.fillStyle = tint.rgba(0.08);
    ctx.fillRect(startX, y, usableW, height);

    // Center divider
    ctx.fillStyle = tint.rgba(0.3);
    ctx.fillRect(barMidX - 0.5, y - 2, 1, height + 4);

    const normCorr = (correlation + 1) / 2;
    const indicatorX = startX + normCorr * usableW;

    if (correlation >= 0) {
      const fillW = indicatorX - barMidX;
      ctx.fillStyle = tint.rgb();
      ctx.fillRect(barMidX, y, fillW, height);
    } else {
      const fillW = barMidX - indicatorX;
      ctx.fillStyle = tint.rgba(0.4);
      ctx.fillRect(indicatorX, y, fillW, height);
    }

    // Indicator pip
    ctx.fillStyle = tint.rgb();
    ctx.fillRect(indicatorX - 1.5 * this.dpr, y - 2, 3 * this.dpr, height + 4);

    // Numeric readout centered above bar
    ctx.font = `${Math.max(7, Math.floor(8 * this.dpr))}px 'Geist', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = tint.rgb();
    ctx.fillText(correlation >= 0 ? `+${correlation.toFixed(2)}` : correlation.toFixed(2), barMidX, y - (4 * this.dpr));

    // Bottom scale labels (-1, PHASE, +1)
    ctx.font = `${Math.max(7, Math.floor(7.5 * this.dpr))}px 'Geist', sans-serif`;
    ctx.fillStyle = tint.rgba(0.45);
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillText('-1', startX, y + height + (2 * this.dpr));

    ctx.textAlign = 'center';
    ctx.fillText('PHASE', barMidX, y + height + (2 * this.dpr));

    ctx.textAlign = 'right';
    ctx.fillText('+1', startX + usableW, y + height + (2 * this.dpr));

    ctx.restore();
  }

  _drawIdle(ctx, cx, cy) {
    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };
    ctx.fillStyle = tint.rgba(0.4);
    ctx.textAlign = 'center';
    ctx.font = `${10 * this.dpr}px 'Geist', sans-serif`;
    ctx.fillText('STEREOMETER', cx, cy);
    ctx.restore();
  }
}

window.VectorscopeVisualizer = VectorscopeVisualizer;
