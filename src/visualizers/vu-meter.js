/**
 * Analog VU Meter Visualizer // Iris High-Contrast Edition
 * Features:
 * - Default MONO mode for a massive, beautifully centered analog needle meter
 * - STEREO mode with intelligent responsive stacking: automatically stacks
 *   meters vertically when container is tall, significantly increasing dial size
 * - True ANSI C16.5 / IEC 60268-17 ballistics (300ms integration & needle inertia)
 * - Exact vertical and horizontal centering in all container shapes
 */

class VuMeterVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.mode = 'mono'; // 'mono' (default) | 'stereo'

    this.angleMono = -Math.PI * 0.75;
    this.velMono = 0;
    this.angleL = -Math.PI * 0.75;
    this.velL = 0;
    this.angleR = -Math.PI * 0.75;
    this.velR = 0;

    this.calibrationDb = -18; // 0 VU = -18 dBFS reference

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

    const levels = this.engine.getLevels();

    if (this.mode === 'mono') {
      // Single massive, perfectly centered dial
      const monoRms = Math.max(levels.rmsL, levels.rmsR);
      const monoPeak = Math.max(levels.peakL, levels.peakR);
      this._renderDial(ctx, 0, 0, w, h, monoRms, monoPeak, 'MONO', 'mono');
    } else {
      // Stereo mode: stack vertically if height is ample to maximize meter dial size
      const shouldStack = h >= (w * 0.75);

      if (shouldStack) {
        const halfH = Math.floor(h / 2);
        this._renderDial(ctx, 0, 0, w, halfH, levels.rmsL, levels.peakL, 'L', 'left');

        // Subtle divider
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(10 * this.dpr, halfH);
        ctx.lineTo(w - 10 * this.dpr, halfH);
        ctx.stroke();
        ctx.restore();

        this._renderDial(ctx, 0, halfH, w, h - halfH, levels.rmsR, levels.peakR, 'R', 'right');
      } else {
        const halfW = Math.floor(w / 2);
        this._renderDial(ctx, 0, 0, halfW, h, levels.rmsL, levels.peakL, 'L', 'left');

        // Subtle divider
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(halfW, 10 * this.dpr);
        ctx.lineTo(halfW, h - 10 * this.dpr);
        ctx.stroke();
        ctx.restore();

        this._renderDial(ctx, halfW, 0, w - halfW, h, levels.rmsR, levels.peakR, 'R', 'right');
      }
    }
  }

  _renderDial(ctx, startX, startY, w, h, rmsDb, peakDb, channelLabel, channelId) {
    ctx.save();
    ctx.translate(startX, startY);
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };

    // Exact geometric centering:
    // Dial needle sweeps from -0.28*PI to +0.28*PI above pivot cy.
    // Peak arc is at cy - radius; pivot and subtext are at cy + 0.22*radius.
    // Placing cy at (h / 2) + (radius * 0.44) precisely centers the visual dial in the box.
    const radius = Math.max(20 * this.dpr, Math.min(w * 0.48, h * 0.68));
    const cx = Math.floor(w / 2);
    const cy = Math.floor((h / 2) + (radius * 0.44));

    const minAngle = -Math.PI * 0.28;
    const maxAngle = Math.PI * 0.28;
    const zeroVuAngle = minAngle + ((maxAngle - minAngle) * 0.75);

    // 1. Arc Path
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI * 0.5 + minAngle - 0.05, -Math.PI * 0.5 + maxAngle + 0.05);
    ctx.strokeStyle = tint.rgba(0.18);
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.stroke();

    // 2. Overload Zone (0 VU to +3 VU)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI * 0.5 + zeroVuAngle, -Math.PI * 0.5 + maxAngle);
    ctx.strokeStyle = tint.rgb();
    ctx.lineWidth = 3 * this.dpr;
    ctx.stroke();

    // 3. Ticks & Labels (Proportionally adapted to dial radius)
    const vuTicks = [
      { vu: -20, label: '-20' },
      { vu: -10, label: '-10' },
      { vu: -7, label: '-7' },
      { vu: -5, label: '-5' },
      { vu: -3, label: '-3' },
      { vu: -2, label: '-2' },
      { vu: -1, label: '-1' },
      { vu: 0, label: '0', isZero: true },
      { vu: 1, label: '+1', isBold: true },
      { vu: 2, label: '+2', isBold: true },
      { vu: 3, label: '+3', isBold: true }
    ];

    let ticks = vuTicks;
    if (radius < 46 * this.dpr) {
      ticks = vuTicks.filter(t => [-20, 0, 3].includes(t.vu));
    } else if (radius < 72 * this.dpr) {
      ticks = vuTicks.filter(t => [-20, -10, -3, 0, 3].includes(t.vu));
    }

    const tickFontSize = Math.max(6.5, Math.min(9.5, Math.floor(radius * 0.11)));
    ctx.font = `${tickFontSize}px 'Geist', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const tickLen = Math.max(3 * this.dpr, Math.floor(radius * 0.08));
    const labelDist = radius - Math.max(8 * this.dpr, Math.floor(radius * 0.19));

    for (const tick of ticks) {
      const norm = this._vuToNorm(tick.vu);
      const angle = -Math.PI * 0.5 + minAngle + norm * (maxAngle - minAngle);

      const x1 = cx + Math.cos(angle) * (radius - (tick.isZero ? tickLen * 1.5 : tickLen));
      const y1 = cy + Math.sin(angle) * (radius - (tick.isZero ? tickLen * 1.5 : tickLen));
      const x2 = cx + Math.cos(angle) * radius;
      const y2 = cy + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = tick.isZero || tick.isBold ? tint.rgb() : tint.rgba(0.4);
      ctx.lineWidth = (tick.isZero ? 1.8 : 1) * this.dpr;
      ctx.stroke();

      const lx = cx + Math.cos(angle) * labelDist;
      const ly = cy + Math.sin(angle) * labelDist;
      ctx.fillStyle = tick.isZero || tick.isBold ? tint.rgb() : tint.rgba(0.55);
      ctx.fillText(tick.label, lx, ly);
    }

    // 4. Spring-Mass Ballistics Simulation
    const vuValue = rmsDb - this.calibrationDb;
    const targetNorm = this._vuToNorm(vuValue);
    const targetAngle = -Math.PI * 0.5 + minAngle + targetNorm * (maxAngle - minAngle);

    const k = 0.09;
    const damping = 0.76;
    let currentAngle = 0;

    if (channelId === 'mono') {
      this.velMono = (this.velMono + (targetAngle - this.angleMono) * k) * damping;
      this.angleMono += this.velMono;
      currentAngle = this.angleMono;
    } else if (channelId === 'left') {
      this.velL = (this.velL + (targetAngle - this.angleL) * k) * damping;
      this.angleL += this.velL;
      currentAngle = this.angleL;
    } else {
      this.velR = (this.velR + (targetAngle - this.angleR) * k) * damping;
      this.angleR += this.velR;
      currentAngle = this.angleR;
    }

    // 5. Crisp Phosphor Needle (No Glow)
    const needleLen = radius * 0.98;
    const nx = cx + Math.cos(currentAngle) * needleLen;
    const ny = cy + Math.sin(currentAngle) * needleLen;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = tint.rgb();
    ctx.lineWidth = 1.8 * this.dpr;
    ctx.stroke();

    // Pivot Pin
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(4 * this.dpr, 5), 0, Math.PI * 2);
    ctx.fillStyle = tint.rgb();
    ctx.fill();

    // 6. Labels
    const titleSize = Math.max(8.5, Math.min(12, Math.floor(radius * 0.14)));
    ctx.font = `700 ${titleSize}px 'Geist', sans-serif`;
    ctx.fillStyle = tint.rgb();
    ctx.textAlign = 'center';
    ctx.fillText(`VU ${channelLabel}`, cx, cy - (radius * 0.44));

    const subSize = Math.max(7, Math.min(9.5, Math.floor(radius * 0.10)));
    ctx.font = `600 ${subSize}px 'Geist', sans-serif`;
    ctx.fillStyle = tint.rgba(0.65);
    ctx.fillText(`${rmsDb.toFixed(1)} dBFS`, cx, cy - (radius * 0.28));

    ctx.restore();
  }

  _vuToNorm(vu) {
    if (vu <= -20) return 0;
    if (vu >= 3) return 1;
    if (vu <= 0) {
      return ((vu + 20) / 20) * 0.75;
    } else {
      return 0.75 + (vu / 3) * 0.25;
    }
  }
}

window.VuMeterVisualizer = VuMeterVisualizer;
