/**
 * Iris Audio DSP Engine
 * Captures Windows Desktop Loopback or Microphone Input,
 * splits stereo channels, and computes real-time FFT, waveforms,
 * true peak, RMS, phase correlation, and musical pitch.
 */

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.stream = null;
    this.sourceNode = null;
    this.splitterNode = null;
    this.mainAnalyser = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;

    this.fftSize = 4096;
    this.oscilloscopeFftSize = 2048;

    this.mainFreqData = null;
    this.mainWaveData = null;
    this.leftWaveData = null;
    this.rightWaveData = null;

    this.isCapturing = false;
    this.currentSourceType = 'desktop'; // 'desktop' | 'mic' | 'test'
    this.currentDeviceId = 'default';

    // Test tone nodes
    this.testOscillator = null;
    this.testGain = null;

    // Peak hold trackers
    this.peakHoldL = 0;
    this.peakHoldR = 0;
    this.peakHoldTimeL = 0;
    this.peakHoldTimeR = 0;
    this.peakClipL = false;
    this.peakClipR = false;
    this.clipResetTimeoutL = null;
    this.clipResetTimeoutR = null;

    // Smoothed correlation
    this.smoothedCorrelation = 1.0;
  }

  async init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  async startDesktopCapture(screenSourceId = null) {
    await this.init();
    this.stopCapture();

    try {
      const sources = await window.electronAPI.getDesktopSources();
      if (!sources || sources.length === 0) {
        throw new Error('No screen sources found for audio capture.');
      }

      const targetSource = screenSourceId
        ? sources.find(s => s.id === screenSourceId) || sources[0]
        : sources[0];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: targetSource.id
          }
        },
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: targetSource.id,
            minWidth: 32,
            maxWidth: 32,
            minHeight: 32,
            maxHeight: 32,
            frameRate: { max: 1 }
          }
        }
      });

      // Stop video track immediately to save CPU/GPU overhead
      stream.getVideoTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('System audio track could not be captured.');
      }

      this.stream = stream;
      this.currentSourceType = 'desktop';
      this.currentDeviceId = targetSource.id;
      this._setupAudioGraph(stream);
      this.isCapturing = true;

      return { success: true, name: targetSource.name, type: 'desktop' };
    } catch (err) {
      console.error('Error starting desktop capture:', err);
      return { success: false, error: err.message };
    }
  }

  async startDeviceCapture(deviceId) {
    await this.init();
    this.stopCapture();

    try {
      const constraints = {
        audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
        video: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;
      this.currentSourceType = 'mic';
      this.currentDeviceId = deviceId;
      this._setupAudioGraph(stream);
      this.isCapturing = true;

      return { success: true, type: 'mic' };
    } catch (err) {
      console.error('Error starting device capture:', err);
      return { success: false, error: err.message };
    }
  }

  async startTestSignal() {
    await this.init();
    this.stopCapture();

    try {
      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (e) {}
      }

      const osc1 = this.audioCtx.createOscillator();
      const osc2 = this.audioCtx.createOscillator();
      const lfo = this.audioCtx.createOscillator();
      const lfoGain = this.audioCtx.createGain();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(110, this.audioCtx.currentTime); // A2

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(220, this.audioCtx.currentTime); // A3

      lfo.frequency.setValueAtTime(0.5, this.audioCtx.currentTime);
      lfoGain.gain.setValueAtTime(30, this.audioCtx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(osc1.frequency);

      const merger = this.audioCtx.createChannelMerger(2);
      const gainL = this.audioCtx.createGain();
      const gainR = this.audioCtx.createGain();
      gainL.gain.setValueAtTime(0.4, this.audioCtx.currentTime);
      gainR.gain.setValueAtTime(0.4, this.audioCtx.currentTime);

      osc1.connect(gainL);
      osc2.connect(gainR);
      gainL.connect(merger, 0, 0);
      gainR.connect(merger, 0, 1);

      this.testGain = this.audioCtx.createGain();
      this.testGain.gain.setValueAtTime(0.5, this.audioCtx.currentTime);
      merger.connect(this.testGain);

      this._setupAudioNodesDirect(this.testGain);

      osc1.start();
      osc2.start();
      lfo.start();
      this.testOscillator = [osc1, osc2, lfo];

      this.currentSourceType = 'test';
      this.isCapturing = true;
      return { success: true, type: 'test' };
    } catch (err) {
      console.error('Error starting test signal:', err);
      return { success: false, error: err.message };
    }
  }

  _setupAudioGraph(stream) {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
    }

    this.sourceNode = this.audioCtx.createMediaStreamSource(stream);

    this.mainAnalyser = this.audioCtx.createAnalyser();
    this.mainAnalyser.fftSize = this.fftSize;
    this.mainAnalyser.smoothingTimeConstant = 0.75;
    this.sourceNode.connect(this.mainAnalyser);

    this.splitterNode = this.audioCtx.createChannelSplitter(2);
    this.sourceNode.connect(this.splitterNode);

    this.leftAnalyser = this.audioCtx.createAnalyser();
    this.leftAnalyser.fftSize = this.oscilloscopeFftSize;
    this.leftAnalyser.smoothingTimeConstant = 0.0;
    this.splitterNode.connect(this.leftAnalyser, 0);

    this.rightAnalyser = this.audioCtx.createAnalyser();
    this.rightAnalyser.fftSize = this.oscilloscopeFftSize;
    this.rightAnalyser.smoothingTimeConstant = 0.0;

    try {
      this.splitterNode.connect(this.rightAnalyser, 1);
    } catch (e) {
      this.splitterNode.connect(this.rightAnalyser, 0);
    }

    this.mainFreqData = new Uint8Array(this.mainAnalyser.frequencyBinCount);
    this.mainWaveData = new Float32Array(this.mainAnalyser.fftSize);
    this.leftWaveData = new Float32Array(this.leftAnalyser.fftSize);
    this.rightWaveData = new Float32Array(this.rightAnalyser.fftSize);
  }

  _setupAudioNodesDirect(inputNode) {
    this.mainAnalyser = this.audioCtx.createAnalyser();
    this.mainAnalyser.fftSize = this.fftSize;
    this.mainAnalyser.smoothingTimeConstant = 0.75;
    inputNode.connect(this.mainAnalyser);

    this.splitterNode = this.audioCtx.createChannelSplitter(2);
    inputNode.connect(this.splitterNode);

    this.leftAnalyser = this.audioCtx.createAnalyser();
    this.leftAnalyser.fftSize = this.oscilloscopeFftSize;
    this.leftAnalyser.smoothingTimeConstant = 0.0;
    this.splitterNode.connect(this.leftAnalyser, 0);

    this.rightAnalyser = this.audioCtx.createAnalyser();
    this.rightAnalyser.fftSize = this.oscilloscopeFftSize;
    this.rightAnalyser.smoothingTimeConstant = 0.0;
    this.splitterNode.connect(this.rightAnalyser, 1);

    this.mainFreqData = new Uint8Array(this.mainAnalyser.frequencyBinCount);
    this.mainWaveData = new Float32Array(this.mainAnalyser.fftSize);
    this.leftWaveData = new Float32Array(this.leftAnalyser.fftSize);
    this.rightWaveData = new Float32Array(this.rightAnalyser.fftSize);
  }

  stopCapture() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.testOscillator) {
      this.testOscillator.forEach(osc => {
        try { osc.stop(); osc.disconnect(); } catch (e) {}
      });
      this.testOscillator = null;
    }
    this.isCapturing = false;
  }

  update() {
    if (!this.isCapturing) return;

    if (this.mainAnalyser) {
      this.mainAnalyser.getByteFrequencyData(this.mainFreqData);
      this.mainAnalyser.getFloatTimeDomainData(this.mainWaveData);
    }
    if (this.leftAnalyser) {
      this.leftAnalyser.getFloatTimeDomainData(this.leftWaveData);
    }
    if (this.rightAnalyser) {
      this.rightAnalyser.getFloatTimeDomainData(this.rightWaveData);
    }
  }

  getFrequencyData() {
    if (!this.isCapturing || !this.mainAnalyser) return null;
    return this.mainFreqData;
  }

  getTriggeredWaveform(zoom = 1, triggerSlope = 'rising') {
    if (!this.isCapturing || !this.mainAnalyser || !this.mainWaveData) return null;

    const length = this.mainWaveData.length;
    let triggerIndex = 0;
    const searchLimit = Math.floor(length * 0.4);

    // Compute peak amplitude across search region to adapt trigger threshold
    let peakAmp = 0.001;
    for (let i = 0; i < searchLimit; i++) {
      const a = Math.abs(this.mainWaveData[i]);
      if (a > peakAmp) peakAmp = a;
    }

    // Schmitt trigger hysteresis: signal must go below -hysteresis before crossing +hysteresis
    const hysteresis = Math.max(0.003, peakAmp * 0.12);
    let armed = false;

    if (peakAmp > 0.006) {
      for (let i = 1; i < searchLimit; i++) {
        const prev = this.mainWaveData[i - 1];
        const curr = this.mainWaveData[i];

        if (triggerSlope === 'rising') {
          if (!armed && curr < -hysteresis) {
            armed = true;
          } else if (armed && prev <= 0 && curr > 0) {
            triggerIndex = i;
            break;
          }
        } else {
          if (!armed && curr > hysteresis) {
            armed = true;
          } else if (armed && prev >= 0 && curr < 0) {
            triggerIndex = i;
            break;
          }
        }
      }
    }

    return {
      buffer: this.mainWaveData,
      startIndex: triggerIndex,
      length: length - triggerIndex,
      sampleRate: this.audioCtx ? this.audioCtx.sampleRate : 48000
    };
  }

  getStereoWaveforms() {
    if (!this.isCapturing || !this.leftWaveData || !this.rightWaveData) return null;
    return {
      left: this.leftWaveData,
      right: this.rightWaveData
    };
  }

  getLevels() {
    if (!this.isCapturing || !this.leftWaveData || !this.rightWaveData) {
      return {
        peakL: -100, peakR: -100,
        rmsL: -100, rmsR: -100,
        peakHoldL: -100, peakHoldR: -100,
        clipL: false, clipR: false
      };
    }

    const left = this.leftWaveData;
    const right = this.rightWaveData;
    const len = left.length;

    let maxL = 0;
    let maxR = 0;
    let sumSqL = 0;
    let sumSqR = 0;

    for (let i = 0; i < len; i++) {
      const valL = Math.abs(left[i]);
      const valR = Math.abs(right[i]);
      if (valL > maxL) maxL = valL;
      if (valR > maxR) maxR = valR;
      sumSqL += left[i] * left[i];
      sumSqR += right[i] * right[i];
    }

    const rmsValL = Math.sqrt(sumSqL / len);
    const rmsValR = Math.sqrt(sumSqR / len);

    const peakL = maxL > 0.000316 ? 20 * Math.log10(maxL) : -70;
    const peakR = maxR > 0.000316 ? 20 * Math.log10(maxR) : -70;
    const rmsL = rmsValL > 0.000316 ? 20 * Math.log10(rmsValL) : -70;
    const rmsR = rmsValR > 0.000316 ? 20 * Math.log10(rmsValR) : -70;

    const now = performance.now();

    if (peakL >= this.peakHoldL) {
      this.peakHoldL = peakL;
      this.peakHoldTimeL = now;
    } else if (now - this.peakHoldTimeL > 1200) {
      this.peakHoldL = Math.max(-70, this.peakHoldL - 0.5);
    }

    if (peakR >= this.peakHoldR) {
      this.peakHoldR = peakR;
      this.peakHoldTimeR = now;
    } else if (now - this.peakHoldTimeR > 1200) {
      this.peakHoldR = Math.max(-70, this.peakHoldR - 0.5);
    }

    if (peakL >= -0.15) {
      this.peakClipL = true;
      if (this.clipResetTimeoutL) clearTimeout(this.clipResetTimeoutL);
      this.clipResetTimeoutL = setTimeout(() => { this.peakClipL = false; }, 2500);
    }
    if (peakR >= -0.15) {
      this.peakClipR = true;
      if (this.clipResetTimeoutR) clearTimeout(this.clipResetTimeoutR);
      this.clipResetTimeoutR = setTimeout(() => { this.peakClipR = false; }, 2500);
    }

    return {
      peakL, peakR,
      rmsL, rmsR,
      peakHoldL: this.peakHoldL,
      peakHoldR: this.peakHoldR,
      clipL: this.peakClipL,
      clipR: this.peakClipR
    };
  }

  getPhaseCorrelation() {
    if (!this.isCapturing || !this.leftWaveData || !this.rightWaveData) return 1.0;
    const left = this.leftWaveData;
    const right = this.rightWaveData;
    const len = Math.min(left.length, right.length);

    let sumDot = 0;
    let sumL2 = 0;
    let sumR2 = 0;

    for (let i = 0; i < len; i++) {
      const l = left[i];
      const r = right[i];
      sumDot += l * r;
      sumL2 += l * l;
      sumR2 += r * r;
    }

    const denom = Math.sqrt(sumL2 * sumR2);
    let correlation = 1.0;
    if (denom > 0.0001) {
      correlation = sumDot / denom;
    }

    this.smoothedCorrelation += (correlation - this.smoothedCorrelation) * 0.15;
    return Math.max(-1.0, Math.min(1.0, this.smoothedCorrelation));
  }

  getDominantFrequency() {
    if (!this.isCapturing || !this.mainFreqData || !this.audioCtx) {
      return { freq: 0, note: '--', cents: 0, mag: 0 };
    }

    let maxVal = 0;
    let maxIndex = 0;
    const binCount = this.mainAnalyser.frequencyBinCount;
    const nyquist = this.audioCtx.sampleRate / 2;

    const minBin = Math.floor((25 / nyquist) * binCount);
    const maxBin = Math.floor((16000 / nyquist) * binCount);

    for (let i = minBin; i < maxBin; i++) {
      if (this.mainFreqData[i] > maxVal) {
        maxVal = this.mainFreqData[i];
        maxIndex = i;
      }
    }

    if (maxVal < 40) {
      return { freq: 0, note: '--', cents: 0, mag: 0 };
    }

    let peakBin = maxIndex;
    if (maxIndex > 0 && maxIndex < binCount - 1) {
      const alpha = this.mainFreqData[maxIndex - 1];
      const beta = this.mainFreqData[maxIndex];
      const gamma = this.mainFreqData[maxIndex + 1];
      const delta = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
      peakBin = maxIndex + delta;
    }

    const freq = (peakBin * nyquist) / binCount;
    const noteInfo = this._frequencyToNote(freq);

    return {
      freq: Math.round(freq * 10) / 10,
      note: noteInfo.name,
      cents: noteInfo.cents,
      mag: maxVal
    };
  }

  _frequencyToNote(freq) {
    if (freq <= 0) return { name: '--', cents: 0 };
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const a4 = 440;
    const midiNum = 12 * (Math.log(freq / a4) / Math.log(2)) + 69;
    const roundedMidi = Math.round(midiNum);
    const noteName = noteStrings[roundedMidi % 12];
    const octave = Math.floor(roundedMidi / 12) - 1;
    const cents = Math.round((midiNum - roundedMidi) * 100);

    return {
      name: `${noteName}${octave}`,
      cents
    };
  }

  async getAudioInputDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === 'audioinput').map(d => ({
        id: d.deviceId,
        label: d.label || `Audio Input (${d.deviceId.slice(0, 5)}...)`
      }));
    } catch (e) {
      console.error('Error enumerating devices:', e);
      return [];
    }
  }
}

window.AudioEngine = AudioEngine;
