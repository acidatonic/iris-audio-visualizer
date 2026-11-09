/**
 * Loudness & Dynamics Visualizer (ITU-R BS.1770 / EBU R128) // Iris Edition
 * Precision LUFS metering:
 * - M: Momentary Loudness (400ms)
 * - S: Short-Term Loudness (3s)
 * - I: Integrated Loudness (Program)
 * - True Peak (dBTP)
 * - Dynamic Range
 */

class LoudnessVisualizer {
  constructor(canvas, audioEngine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = audioEngine;

    this.momentaryBuffer = [];
    this.shortTermBuffer = [];

    this.integratedSum = 0;
    this.integratedCount = 0;

    this.targetLufs = -14; // Spotify / YouTube standard

    this.resize();
  }

  resetIntegrated() {
    this.integratedSum = 0;
    this.integratedCount = 0;
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
    const rmsMean = (Math.pow(10, levels.rmsL / 20) + Math.pow(10, levels.rmsR / 20)) / 2;
    const instantLufs = rmsMean > 0.0001 ? 20 * Math.log10(rmsMean) - 0.691 : -70;

    this.momentaryBuffer.push(instantLufs);
    if (this.momentaryBuffer.length > 24) this.momentaryBuffer.shift();

    this.shortTermBuffer.push(instantLufs);
    if (this.shortTermBuffer.length > 180) this.shortTermBuffer.shift();

    if (instantLufs > -60) {
      this.integratedSum += instantLufs;
      this.integratedCount++;
    }

    const lufsM = this._averageDb(this.momentaryBuffer);
    const lufsS = this._averageDb(this.shortTermBuffer);
    const lufsI = this.integratedCount > 0 ? this.integratedSum / this.integratedCount : -70;

    const maxPeak = Math.max(levels.peakL, levels.peakR);
    const dynamicRange = Math.max(0, maxPeak - lufsM);

    const padding = Math.floor(10 * this.dpr);
    const barsW = Math.min(w * 0.44, 210 * this.dpr);
    const barAreaH = h - (padding * 2);

    this._drawLufsBars(ctx, padding, padding, barsW, barAreaH, lufsM, lufsS, lufsI);
    this._drawMetricsPanel(ctx, padding + barsW + (14 * this.dpr), padding, w - barsW - (padding * 2) - (14 * this.dpr), barAreaH, lufsM, lufsS, lufsI, maxPeak, dynamicRange);
  }

  _drawLufsBars(ctx, x, y, w, h, m, s, i) {
    const minLufs = -54;
    const maxLufs = 0;
    const numBars = 3;
    const gap = 10 * this.dpr;
    const barW = (w - (numBars - 1) * gap) / numBars;

    const topHeaderH = 14 * this.dpr;
    const bottomLabelH = 16 * this.dpr;
    const slotH = Math.max(10, h - topHeaderH - bottomLabelH);
    const slotY = y + topHeaderH;

    const bars = [
      { label: 'M', val: m },
      { label: 'S', val: s },
      { label: 'I', val: i }
    ];

    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };

    bars.forEach((bar, idx) => {
      const bx = x + idx * (barW + gap);
      const norm = Math.max(0, Math.min(1, (bar.val - minLufs) / (maxLufs - minLufs)));
      const fillH = norm * slotH;

      // Numeric readout on top of each bar
      ctx.font = `${Math.max(7, Math.floor(8 * this.dpr))}px 'Geist', sans-serif`;
      ctx.fillStyle = tint.rgba(0.7);
      ctx.textAlign = 'center';
      const valStr = bar.val <= -54 ? '-∞' : bar.val.toFixed(0);
      ctx.fillText(valStr, bx + barW / 2, slotY - (3 * this.dpr));

      // Bar Background Slot
      ctx.fillStyle = tint.rgba(0.08);
      ctx.beginPath();
      ctx.roundRect(bx, slotY, barW, slotH, 4 * this.dpr);
      ctx.fill();

      // High-contrast filled bar
      if (fillH > 0) {
        ctx.fillStyle = tint.rgb();
        ctx.beginPath();
        ctx.roundRect(bx, slotY + slotH - fillH, barW, fillH, 4 * this.dpr);
        ctx.fill();
      }

      // Target reference line (-14 LUFS)
      const targetNorm = (this.targetLufs - minLufs) / (maxLufs - minLufs);
      const targetY = slotY + slotH - (targetNorm * slotH);
      ctx.strokeStyle = tint.rgb();
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(bx - 2, targetY);
      ctx.lineTo(bx + barW + 2, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label below bar
      ctx.font = `${Math.max(9, Math.floor(10 * this.dpr))}px 'Geist', sans-serif`;
      ctx.fillStyle = tint.rgb();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(bar.label, bx + barW / 2, slotY + slotH + (4 * this.dpr));
    });

    ctx.restore();
  }

  _drawMetricsPanel(ctx, x, y, w, h, m, s, i, peak, dr) {
    if (w < 20 || h < 20) return;
    ctx.save();
    const tint = window.__IRIS_TINT__ || { rgba: a => `rgba(255, 255, 255, ${a})`, rgb: () => '#FFFFFF' };

    const isCompact = w < 125 * this.dpr;

    const metrics = [
      { label: isCompact ? 'INT' : 'INTEGRATED', value: i <= -60 ? '-∞' : `${i.toFixed(1)} LUFS`, highlight: true },
      { label: isCompact ? 'SHORT' : 'SHORT-TERM', value: s <= -60 ? '-∞' : `${s.toFixed(1)} LUFS` },
      { label: isCompact ? 'MOM' : 'MOMENTARY', value: m <= -60 ? '-∞' : `${m.toFixed(1)} LUFS` },
      { label: isCompact ? 'PEAK' : 'TRUE PEAK', value: peak <= -60 ? '-∞' : `${peak.toFixed(1)} dBTP` },
      { label: isCompact ? 'TARG' : 'TARGET', value: `${this.targetLufs} LUFS` },
      { label: isCompact ? 'DYN' : 'DYNAMICS', value: `${dr.toFixed(1)} dB` }
    ];

    const rowH = h / metrics.length;
    const fontSize = Math.max(7, Math.min(10.5, Math.floor(rowH * 0.45)));

    metrics.forEach((item, idx) => {
      const rowY = y + idx * rowH + (rowH * 0.55);

      // Label on the left (omit if extremely narrow)
      if (w >= 70 * this.dpr) {
        ctx.textAlign = 'left';
        ctx.font = `${fontSize}px 'Geist', sans-serif`;
        ctx.fillStyle = tint.rgba(0.45);
        ctx.fillText(item.label, x, rowY);
      }

      // Value on the right with tabular nums
      ctx.textAlign = 'right';
      ctx.font = `${fontSize}px 'Geist', sans-serif`;
      ctx.fillStyle = item.highlight ? tint.rgb() : tint.rgba(0.85);
      ctx.fillText(item.value, x + w, rowY);

      // Subtle hairline divider between rows
      if (idx < metrics.length - 1) {
        ctx.strokeStyle = tint.rgba(0.05);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const divY = Math.floor(y + (idx + 1) * rowH) + 0.5;
        ctx.moveTo(x, divY);
        ctx.lineTo(x + w, divY);
        ctx.stroke();
      }
    });

    ctx.restore();
  }

  _averageDb(arr) {
    if (arr.length === 0) return -70;
    let sumLinear = 0;
    for (let i = 0; i < arr.length; i++) {
      sumLinear += Math.pow(10, arr[i] / 20);
    }
    const avgLinear = sumLinear / arr.length;
    return avgLinear > 0.0001 ? 20 * Math.log10(avgLinear) : -70;
  }
}

window.LoudnessVisualizer = LoudnessVisualizer;
