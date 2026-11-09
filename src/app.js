/**
 * Iris Application Coordinator // High-Contrast Monochrome Edition
 * Handles visualizer loops, modular layouts, audio routing, and UI interactions.
 */

class App {
  constructor() {
    this.soloModule = null;

    this.audioEngine = new AudioEngine();

    // 7 Visualizer Modules
    this.spectrum = null;
    this.oscilloscope = null;
    this.spectrogram = null;
    this.vectorscope = null;
    this.vuMeter = null;
    this.waveform = null;
    this.loudness = null;

    this.els = {};
    this.animationId = null;
    this.lastPitchUpdate = 0;
  }

  async init() {
    this._cacheElements();
    this._initVisualizers();
    this._setupEventListeners();
    this._initResizeHandles();
    this._initTintControls();
    await this._populateAudioSources();

    const ro = new ResizeObserver(() => {
      this._handleResize();
    });
    ro.observe(this.els.workspace);

    // Set default opacity on startup
    window.electronAPI.setOpacity(1.0);

    // Initialize or restore solid mode (toggle transparency)
    let isSolid = false;
    try {
      isSolid = localStorage.getItem('iris_mode_solid') === '1';
    } catch (e) {}
    this._toggleSolidMode(isSolid);

    // Restore saved tint color if present, else default to neutral
    try {
      const savedTint = localStorage.getItem('iris_tint_rgb');
      const savedIntensity = parseFloat(localStorage.getItem('iris_tint_intensity') || '0.70');
      this.currentIntensity = isNaN(savedIntensity) ? 0.70 : savedIntensity;

      if (this.els.tintIntensitySlider) {
        this.els.tintIntensitySlider.value = Math.round(this.currentIntensity * 100);
      }
      if (this.els.tintIntensityReadout) {
        this.els.tintIntensityReadout.textContent = `${Math.round(this.currentIntensity * 100)}%`;
      }

      if (savedTint) {
        const [r, g, b] = savedTint.split(',').map(Number);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          this._applyTintColor(r, g, b, this.currentIntensity, false);

          const hsl = this._rgbToHsl(r, g, b);
          this.currentHue = Math.round(hsl[0] * 360);
          if (this.els.tintHueSlider) this.els.tintHueSlider.value = this.currentHue;
          if (this.els.tintHueReadout) this.els.tintHueReadout.textContent = `${this.currentHue}°`;

          // Match preset if exists
          let matched = false;
          document.querySelectorAll('.tint-preset-card').forEach(c => {
            const hex = c.getAttribute('data-color');
            if (hex) {
              const [pr, pg, pb] = this._hexToRgb(hex);
              if (Math.abs(pr - r) < 2 && Math.abs(pg - g) < 2 && Math.abs(pb - b) < 2) {
                c.classList.add('active');
                matched = true;
              } else {
                c.classList.remove('active');
              }
            }
          });
          if (!matched) {
            document.querySelectorAll('.tint-preset-card').forEach(c => c.classList.remove('active'));
          }
        } else {
          this._applyTintColor(237, 237, 237, this.currentIntensity, true);
        }
      } else {
        this._applyTintColor(237, 237, 237, this.currentIntensity, true);
      }
    } catch (e) {
      this._applyTintColor(237, 237, 237, 0.70, true);
    }

    await this.startAudioCapture();
    this.startLoop();
  }

  _cacheElements() {
    this.els.workspace = document.getElementById('workspace');
    this.els.sourceSelect = document.getElementById('source-select');
    this.els.modeSolidBtn = document.getElementById('mode-solid-btn');
    this.els.modeSolidLabel = document.getElementById('mode-solid-label');
    this.els.pinBtn = document.getElementById('pin-btn');
    this.els.tintPickerBtn = document.getElementById('tint-picker-btn');
    this.els.tintPickerPopover = document.getElementById('tint-picker-popover');
    this.els.tintCloseBtn = document.getElementById('tint-close-btn');
    this.els.tintHueSlider = document.getElementById('tint-hue-slider');
    this.els.tintHueReadout = document.getElementById('tint-hue-readout');
    this.els.tintIntensitySlider = document.getElementById('tint-intensity-slider');
    this.els.tintIntensityReadout = document.getElementById('tint-intensity-readout');
    this.els.tintResetBtn = document.getElementById('tint-reset-btn');
    this.els.tintPreviewDot = document.getElementById('tint-preview-dot');
    this.els.statusBadge = document.getElementById('status-badge');
    this.els.pitchBadge = document.getElementById('pitch-badge');
    this.els.specModeBtn = document.getElementById('spec-mode-btn');
    this.els.oscTimebaseSelect = document.getElementById('osc-timebase-select');
    this.els.oscGainSelect = document.getElementById('osc-gain-select');
    this.els.stereoShapeBtn = document.getElementById('stereo-shape-btn');
    this.els.stereoRenderBtn = document.getElementById('stereo-render-btn');
    this.els.stereoGainBtn = document.getElementById('stereo-gain-btn');
    this.els.vuModeBtn = document.getElementById('vu-mode-btn');
    this.els.waveModeBtn = document.getElementById('wave-mode-btn');
    this.els.lufsResetBtn = document.getElementById('lufs-reset-btn');
  }

  _initVisualizers() {
    const canvasSpec = document.getElementById('canvas-spectrum');
    const canvasOsc = document.getElementById('canvas-oscilloscope');
    const canvasWaterfall = document.getElementById('canvas-spectrogram');
    const canvasVec = document.getElementById('canvas-vectorscope');
    const canvasVu = document.getElementById('canvas-vu-meter');
    const canvasWave = document.getElementById('canvas-waveform');
    const canvasLoud = document.getElementById('canvas-loudness');

    this.spectrum = new SpectrumVisualizer(canvasSpec, this.audioEngine);
    this.oscilloscope = new OscilloscopeVisualizer(canvasOsc, this.audioEngine);
    this.spectrogram = new SpectrogramVisualizer(canvasWaterfall, this.audioEngine);
    this.vectorscope = new VectorscopeVisualizer(canvasVec, this.audioEngine);
    this.vuMeter = new VuMeterVisualizer(canvasVu, this.audioEngine);
    this.waveform = new WaveformVisualizer(canvasWave, this.audioEngine);
    this.loudness = new LoudnessVisualizer(canvasLoud, this.audioEngine);
  }

  _handleResize() {
    if (this.spectrum && this.spectrum.canvas.offsetParent !== null) this.spectrum.resize();
    if (this.oscilloscope && this.oscilloscope.canvas.offsetParent !== null) this.oscilloscope.resize();
    if (this.spectrogram && this.spectrogram.canvas.offsetParent !== null) this.spectrogram.resize();
    if (this.vectorscope && this.vectorscope.canvas.offsetParent !== null) this.vectorscope.resize();
    if (this.vuMeter && this.vuMeter.canvas.offsetParent !== null) this.vuMeter.resize();
    if (this.waveform && this.waveform.canvas.offsetParent !== null) this.waveform.resize();
    if (this.loudness && this.loudness.canvas.offsetParent !== null) this.loudness.resize();
  }

  _initResizeHandles() {
    document.querySelectorAll('.panel-card').forEach(card => {
      const handleE = card.querySelector('.handle-e');
      const handleS = card.querySelector('.handle-s');
      const handleSE = card.querySelector('.handle-se');

      const makeDraggable = (handle, allowX, allowY, cursorType) => {
        if (!handle) return;
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const startX = e.clientX;
          const startY = e.clientY;
          const startRect = card.getBoundingClientRect();

          // Immediately fix width before adding is-custom-sized so it does NOT collapse or shrink on click
          card.style.width = `${Math.round(startRect.width)}px`;
          card.style.flex = `0 0 ${Math.round(startRect.width)}px`;
          card.classList.add('is-custom-sized');
          card.classList.add('is-resizing');
          document.body.classList.add('is-resizing');
          document.body.style.cursor = cursorType;

          const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;

            if (allowX || allowY) {
              const newW = Math.max(170, Math.round(startRect.width + dx));
              card.style.width = `${newW}px`;
              card.style.flex = `0 0 ${newW}px`;
            }

            const currentW = Math.round(card.getBoundingClientRect().width);
            card.setAttribute('data-size', `${currentW}px`);
            this._handleResize();
          };

          const onMouseUp = () => {
            card.classList.remove('is-resizing');
            document.body.classList.remove('is-resizing');
            document.body.style.cursor = '';
            card.removeAttribute('data-size');
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            this._handleResize();
          };

          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        });
      };

      makeDraggable(handleE, true, false, 'ew-resize');
      makeDraggable(handleS, false, true, 'ns-resize');
      makeDraggable(handleSE, true, true, 'nwse-resize');
    });
  }

  async _populateAudioSources() {
    const select = this.els.sourceSelect;
    select.innerHTML = '';

    let sources = [];
    try {
      if (window.electronAPI && window.electronAPI.getDesktopSources) {
        sources = await window.electronAPI.getDesktopSources();
      }
    } catch (e) {
      console.warn('Could not query desktop sources:', e);
    }
    const groupDesktop = document.createElement('optgroup');
    groupDesktop.label = 'SYSTEM LOOPBACK (PC AUDIO)';

    if (sources && sources.length > 0) {
      sources.forEach((src, idx) => {
        const opt = document.createElement('option');
        opt.value = `desktop:${src.id}`;
        opt.textContent = `${src.name} (Loopback)`;
        if (idx === 0) opt.selected = true;
        groupDesktop.appendChild(opt);
      });
    } else {
      const opt = document.createElement('option');
      opt.value = 'desktop:default';
      opt.textContent = 'Primary Display (Loopback)';
      opt.selected = true;
      groupDesktop.appendChild(opt);
    }
    select.appendChild(groupDesktop);

    const inputs = await this.audioEngine.getAudioInputDevices();
    if (inputs && inputs.length > 0) {
      const groupInputs = document.createElement('optgroup');
      groupInputs.label = 'HARDWARE INPUT DEVICES';
      inputs.forEach(input => {
        const opt = document.createElement('option');
        opt.value = `mic:${input.id}`;
        opt.textContent = input.label;
        groupInputs.appendChild(opt);
      });
      select.appendChild(groupInputs);
    }

    const groupTest = document.createElement('optgroup');
    groupTest.label = 'DIAGNOSTIC TEST SIGNAL';
    const optTest = document.createElement('option');
    optTest.value = 'test:synth';
    optTest.textContent = 'Dual Tone Synth (A2/A3 Stereo)';
    groupTest.appendChild(optTest);
    select.appendChild(groupTest);
  }

  async startAudioCapture() {
    this.els.statusBadge.textContent = 'Connecting';
    this.els.statusBadge.classList.remove('live');

    const selectedValue = this.els.sourceSelect.value || 'desktop:default';
    const [type, id] = selectedValue.split(':');

    let result;
    if (type === 'desktop') {
      result = await this.audioEngine.startDesktopCapture(id === 'default' ? null : id);
    } else if (type === 'mic') {
      result = await this.audioEngine.startDeviceCapture(id);
    } else if (type === 'test') {
      result = await this.audioEngine.startTestSignal();
    }

    if (result && result.success) {
      if (type === 'desktop') {
        this.els.statusBadge.textContent = 'Live (Loopback)';
      } else if (type === 'mic') {
        this.els.statusBadge.textContent = 'Live (Input)';
      } else {
        this.els.statusBadge.textContent = 'Test signal';
      }
      this.els.statusBadge.classList.add('live');
    } else {
      this.els.statusBadge.textContent = 'Capture error';
      this.els.statusBadge.classList.remove('live');
      console.error('Audio capture failed:', result?.error);
    }
  }

  _setupEventListeners() {
    document.getElementById('btn-minimize').addEventListener('click', () => {
      window.electronAPI.minimize();
    });
    document.getElementById('btn-maximize').addEventListener('click', () => {
      window.electronAPI.maximize();
    });
    document.getElementById('btn-close').addEventListener('click', () => {
      window.electronAPI.close();
    });

    if (this.els.modeSolidBtn) {
      this.els.modeSolidBtn.addEventListener('click', () => {
        this._toggleSolidMode();
      });
    }

    this.els.pinBtn.addEventListener('click', async () => {
      const isPinned = await window.electronAPI.toggleAlwaysOnTop();
      this.els.pinBtn.classList.toggle('active', isPinned);
      this.els.pinBtn.title = isPinned ? 'Always On Top: ENABLED' : 'Always On Top: DISABLED';
    });

    this.els.sourceSelect.addEventListener('change', async () => {
      await this.startAudioCapture();
    });

    this.els.specModeBtn.addEventListener('click', () => {
      if (this.spectrum.mode === 'curve') {
        this.spectrum.mode = 'led';
        this.els.specModeBtn.textContent = 'LED bars';
        this.els.specModeBtn.classList.add('active');
      } else {
        this.spectrum.mode = 'curve';
        this.els.specModeBtn.textContent = 'Smooth curve';
        this.els.specModeBtn.classList.remove('active');
      }
    });

    this.els.oscTimebaseSelect.addEventListener('change', (e) => {
      this.oscilloscope.timebaseMs = parseFloat(e.target.value);
    });

    this.els.oscGainSelect.addEventListener('change', (e) => {
      if (e.target.value === 'auto') {
        this.oscilloscope.autoGain = true;
      } else {
        this.oscilloscope.autoGain = false;
        this.oscilloscope.gain = parseFloat(e.target.value);
      }
    });

    this.els.stereoShapeBtn.addEventListener('click', () => {
      if (this.vectorscope.shapeMode === 'diamond') {
        this.vectorscope.shapeMode = 'circle';
        this.els.stereoShapeBtn.textContent = 'Circle';
        this.els.stereoShapeBtn.classList.remove('active');
      } else {
        this.vectorscope.shapeMode = 'diamond';
        this.els.stereoShapeBtn.textContent = 'Rhombus';
        this.els.stereoShapeBtn.classList.add('active');
      }
    });

    this.els.stereoRenderBtn.addEventListener('click', () => {
      if (this.vectorscope.renderMode === 'dots') {
        this.vectorscope.renderMode = 'line';
        this.els.stereoRenderBtn.textContent = 'Line';
        this.els.stereoRenderBtn.classList.remove('active');
      } else {
        this.vectorscope.renderMode = 'dots';
        this.els.stereoRenderBtn.textContent = 'Dots';
        this.els.stereoRenderBtn.classList.add('active');
      }
    });

    this.els.stereoGainBtn.addEventListener('click', () => {
      this.vectorscope.autoGain = !this.vectorscope.autoGain;
      this.els.stereoGainBtn.classList.toggle('active', this.vectorscope.autoGain);
      this.els.stereoGainBtn.textContent = this.vectorscope.autoGain ? 'Auto boost' : 'Boost off';
    });

    if (this.els.vuModeBtn) {
      this.els.vuModeBtn.addEventListener('click', () => {
        if (this.vuMeter.mode === 'mono') {
          this.vuMeter.mode = 'stereo';
          this.els.vuModeBtn.textContent = 'Stereo';
          this.els.vuModeBtn.classList.remove('active');
        } else {
          this.vuMeter.mode = 'mono';
          this.els.vuModeBtn.textContent = 'Mono';
          this.els.vuModeBtn.classList.add('active');
        }
      });
    }

    if (this.els.waveModeBtn) {
      this.els.waveModeBtn.addEventListener('click', () => {
        if (this.waveform.mode === 'bars') {
          this.waveform.mode = 'wave';
          this.els.waveModeBtn.textContent = 'Live wave';
          this.els.waveModeBtn.classList.remove('active');
        } else {
          this.waveform.mode = 'bars';
          this.els.waveModeBtn.textContent = 'Live rays';
          this.els.waveModeBtn.classList.add('active');
        }
      });
    }

    if (this.els.lufsResetBtn) {
      this.els.lufsResetBtn.addEventListener('click', () => {
        this.loudness.resetIntegrated();
      });
    }

    // 3-Dots Module Dropdown Menus for Compact Cards
    document.querySelectorAll('.panel-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const actions = btn.closest('.panel-actions');
        const card = btn.closest('.panel-card');
        const dropdown = actions.querySelector('.panel-controls-dropdown');
        if (!dropdown) return;

        const isOpen = dropdown.classList.contains('is-open');
        document.querySelectorAll('.panel-controls-dropdown.is-open').forEach(d => {
          d.classList.remove('is-open');
        });
        document.querySelectorAll('.panel-menu-btn.active').forEach(b => {
          b.classList.remove('active');
        });
        document.querySelectorAll('.panel-card.has-open-dropdown').forEach(c => {
          c.classList.remove('has-open-dropdown');
        });

        if (!isOpen) {
          dropdown.classList.add('is-open');
          btn.classList.add('active');
          if (card) card.classList.add('has-open-dropdown');
        }
      });
    });

    // Close any open module dropdown when clicking outside
    window.addEventListener('click', (e) => {
      if (!e.target.closest('.panel-actions')) {
        document.querySelectorAll('.panel-controls-dropdown.is-open').forEach(d => {
          d.classList.remove('is-open');
        });
        document.querySelectorAll('.panel-menu-btn.active').forEach(b => {
          b.classList.remove('active');
        });
        document.querySelectorAll('.panel-card.has-open-dropdown').forEach(c => {
          c.classList.remove('has-open-dropdown');
        });
      }
    });

    document.querySelectorAll('.module-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const mod = chip.dataset.mod;
        const card = document.querySelector(`.panel-card[data-module="${mod}"]`);
        if (!card) return;

        const isCurrentlyActive = chip.classList.contains('active');
        chip.classList.toggle('active', !isCurrentlyActive);
        card.classList.toggle('is-hidden', isCurrentlyActive);

        setTimeout(() => {
          this._handleResize();
        }, 50);
      });
    });

    document.querySelectorAll('.btn-solo').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.panel-card');
        const moduleId = card.dataset.module;
        this.toggleSolo(moduleId);
      });
    });

    document.querySelectorAll('.panel-card-header').forEach(header => {
      header.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        const card = header.closest('.panel-card');
        const moduleId = card.dataset.module;
        this.toggleSolo(moduleId);
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'p' || e.key === 'P') {
        this.els.pinBtn.click();
      } else if (e.key === 'm' || e.key === 'M') {
        this.els.specModeBtn.click();
      } else if (e.key === 'w' || e.key === 'W') {
        if (this.els.waveModeBtn) this.els.waveModeBtn.click();
      } else if (['1','2','3','4','5','6','7'].includes(e.key)) {
        const mods = ['spectrum', 'oscilloscope', 'spectrogram', 'vectorscope', 'vu-meter', 'waveform', 'loudness'];
        const targetMod = mods[parseInt(e.key) - 1];
        if (targetMod) this.toggleSolo(targetMod);
      } else if (e.key === 'Escape') {
        if (this.soloModule) this.toggleSolo(this.soloModule);
      }
    });
  }

  toggleSolo(moduleId) {
    const ws = this.els.workspace;

    if (this.soloModule === moduleId) {
      this.soloModule = null;
      ws.classList.remove('is-solo');
      document.querySelectorAll('.panel-card').forEach(c => {
        c.classList.remove('solo-active');
        const soloBtn = c.querySelector('.btn-solo');
        if (soloBtn) soloBtn.textContent = 'Solo';
      });
    } else {
      this.soloModule = moduleId;
      ws.classList.add('is-solo');
      document.querySelectorAll('.panel-card').forEach(c => {
        const soloBtn = c.querySelector('.btn-solo');
        if (c.dataset.module === moduleId) {
          c.classList.add('solo-active');
          if (soloBtn) soloBtn.textContent = 'Exit solo';
        } else {
          c.classList.remove('solo-active');
          if (soloBtn) soloBtn.textContent = 'Solo';
        }
      });
    }

    setTimeout(() => {
      this._handleResize();
    }, 60);
  }

  startLoop() {
    const loop = (timestamp) => {
      this.render();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  render() {
    // 1. Refresh all central DSP buffers once per frame so all meters run 100% autonomously
    try {
      this.audioEngine.update();
    } catch (e) {
      console.error('Audio engine update error', e);
    }

    try {
      if (this.spectrum && this.spectrum.canvas.offsetParent !== null) {
        this.spectrum.render();
      }
    } catch (e) { console.error('Spectrum error', e); }

    try {
      if (this.oscilloscope && this.oscilloscope.canvas.offsetParent !== null) {
        this.oscilloscope.render();
      }
    } catch (e) { console.error('Oscilloscope error', e); }

    try {
      if (this.spectrogram && this.spectrogram.canvas.offsetParent !== null) {
        this.spectrogram.render();
      }
    } catch (e) { console.error('Spectrogram error', e); }

    try {
      if (this.vectorscope && this.vectorscope.canvas.offsetParent !== null) {
        this.vectorscope.render();
      }
    } catch (e) { console.error('Vectorscope error', e); }

    try {
      if (this.vuMeter && this.vuMeter.canvas.offsetParent !== null) {
        this.vuMeter.render();
      }
    } catch (e) { console.error('VuMeter error', e); }

    try {
      if (this.waveform && this.waveform.canvas.offsetParent !== null) {
        this.waveform.render();
      }
    } catch (e) { console.error('Waveform error', e); }

    try {
      if (this.loudness && this.loudness.canvas.offsetParent !== null) {
        this.loudness.render();
      }
    } catch (e) { console.error('Loudness error', e); }

    // Update real-time pitch / peak frequency badge
    const now = performance.now();
    if (now - this.lastPitchUpdate > 100) {
      this.lastPitchUpdate = now;
      const pitch = this.audioEngine.getDominantFrequency();
      if (pitch && pitch.freq > 0) {
        this.els.pitchBadge.innerHTML = `<span class="note">${pitch.note}</span><span class="freq">${pitch.freq.toFixed(1)} Hz</span>`;
      } else {
        this.els.pitchBadge.innerHTML = `<span class="note">--</span><span class="freq">0.0 Hz</span>`;
      }
    }
  }

  _initTintControls() {
    this.currentHue = 0;
    this.currentIntensity = 0.70;
    this.tintPos = null;

    const popover = this.els.tintPickerPopover;
    const btn = this.els.tintPickerBtn;

    // Draggable header logic
    const header = document.getElementById('tint-popover-header');
    if (header && popover) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 0;
      let initialTop = 0;

      const onMouseDown = (e) => {
        if (e.target.closest('#tint-reset-btn') || e.target.closest('#tint-close-btn')) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        popover.classList.add('is-dragging');
        startX = e.clientX;
        startY = e.clientY;

        const rect = popover.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        const onMouseMove = (moveEvent) => {
          if (!isDragging) return;
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          const popW = popover.offsetWidth || 268;
          const popH = popover.offsetHeight || 300;
          const maxLeft = Math.max(8, window.innerWidth - popW - 8);
          const maxTop = Math.max(8, window.innerHeight - popH - 8);

          const newLeft = Math.max(8, Math.min(maxLeft, initialLeft + dx));
          const newTop = Math.max(8, Math.min(maxTop, initialTop + dy));

          popover.style.left = `${newLeft}px`;
          popover.style.top = `${newTop}px`;
          popover.style.right = 'auto';

          this.tintPos = { x: newLeft, y: newTop };
        };

        const onMouseUp = () => {
          if (!isDragging) return;
          isDragging = false;
          popover.classList.remove('is-dragging');
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      };

      header.addEventListener('mousedown', onMouseDown);
    }

    const positionPopover = () => {
      if (!popover || !btn) return;
      const popW = popover.offsetWidth || 268;
      const popH = popover.offsetHeight || 300;
      const maxLeft = Math.max(8, window.innerWidth - popW - 8);
      const maxTop = Math.max(8, window.innerHeight - popH - 8);

      if (this.tintPos) {
        const clampedX = Math.max(8, Math.min(maxLeft, this.tintPos.x));
        const clampedY = Math.max(8, Math.min(maxTop, this.tintPos.y));
        popover.style.left = `${clampedX}px`;
        popover.style.top = `${clampedY}px`;
        popover.style.right = 'auto';
      } else {
        const btnRect = btn.getBoundingClientRect();
        let targetLeft = btnRect.right - popW;
        let targetTop = btnRect.bottom + 6;

        targetLeft = Math.max(8, Math.min(maxLeft, targetLeft));
        targetTop = Math.max(8, Math.min(maxTop, targetTop));

        popover.style.left = `${targetLeft}px`;
        popover.style.top = `${targetTop}px`;
        popover.style.right = 'auto';
      }
    };

    // Studio Phosphor Presets
    document.querySelectorAll('.tint-preset-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tint-preset-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        const hex = card.getAttribute('data-color') || '#EDEDED';
        const [r, g, b] = this._hexToRgb(hex);

        if (hex.toUpperCase() === '#EDEDED' || hex.toUpperCase() === '#FFFFFF') {
          if (this.els.tintHueReadout) this.els.tintHueReadout.textContent = 'Neutral';
          if (this.els.tintHueSlider) this.els.tintHueSlider.value = 0;
          this._applyTintColor(237, 237, 237, this.currentIntensity, true);
        } else {
          const hsl = this._rgbToHsl(r, g, b);
          this.currentHue = Math.round(hsl[0] * 360);
          if (this.els.tintHueSlider) this.els.tintHueSlider.value = this.currentHue;
          if (this.els.tintHueReadout) this.els.tintHueReadout.textContent = `${this.currentHue}°`;
          this._applyTintColor(r, g, b, this.currentIntensity, false);
        }
      });
    });

    // Custom Hue Range Slider
    if (this.els.tintHueSlider) {
      this.els.tintHueSlider.addEventListener('input', (e) => {
        const hue = parseInt(e.target.value, 10);
        this.currentHue = hue;
        document.querySelectorAll('.tint-preset-card').forEach(c => c.classList.remove('active'));
        if (this.els.tintHueReadout) this.els.tintHueReadout.textContent = `${hue}°`;

        const [r, g, b] = this._hslToRgb(hue / 360, 0.85, 0.58);
        this._applyTintColor(r, g, b, this.currentIntensity, false);
      });
    }

    // Atmosphere Intensity Slider
    if (this.els.tintIntensitySlider) {
      this.els.tintIntensitySlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.currentIntensity = val / 100;
        if (this.els.tintIntensityReadout) this.els.tintIntensityReadout.textContent = `${val}%`;

        const cur = window.__IRIS_TINT__ || { r: 237, g: 237, b: 237, isNeutral: true };
        this._applyTintColor(cur.r, cur.g, cur.b, this.currentIntensity, cur.isNeutral);
      });
    }

    // Reset button
    if (this.els.tintResetBtn) {
      this.els.tintResetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.tint-preset-card').forEach(c => c.classList.remove('active'));
        const monoPreset = document.querySelector('.tint-preset-card[data-color="#EDEDED"]');
        if (monoPreset) monoPreset.classList.add('active');

        if (this.els.tintHueSlider) this.els.tintHueSlider.value = 0;
        if (this.els.tintHueReadout) this.els.tintHueReadout.textContent = 'Neutral';
        this._applyTintColor(237, 237, 237, this.currentIntensity, true);
      });
    }

    // Toggle popover
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popover.classList.contains('is-open');
        if (isOpen) {
          popover.classList.remove('is-open');
        } else {
          popover.classList.add('is-open');
          positionPopover();
        }
      });
    }

    // Dedicated Close button
    if (this.els.tintCloseBtn) {
      this.els.tintCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popover) popover.classList.remove('is-open');
      });
    }

    // Close popover when clicking outside
    window.addEventListener('click', (e) => {
      if (!e.target.closest('#tint-picker-popover') && !e.target.closest('#tint-picker-btn')) {
        if (popover && popover.classList.contains('is-open')) {
          popover.classList.remove('is-open');
        }
      }
    });

    // Window resize: re-clamp popover so it never gets clipped or lost
    window.addEventListener('resize', () => {
      if (popover && popover.classList.contains('is-open')) {
        positionPopover();
      }
    });
  }

  _toggleSolidMode(forceState) {
    const nextState = typeof forceState === 'boolean' ? forceState : !document.body.classList.contains('mode-solid');
    document.body.classList.toggle('mode-solid', nextState);
    this.isSolidMode = nextState;

    if (this.els.modeSolidBtn) {
      this.els.modeSolidBtn.classList.toggle('active', nextState);
      this.els.modeSolidBtn.title = nextState ? 'Transparency: OFF (Click for Glass Mode)' : 'Transparency: ON (Click for Solid Pure Black)';
    }
    if (this.els.modeSolidLabel) {
      this.els.modeSolidLabel.textContent = nextState ? 'Solid' : 'Glass';
    }

    try {
      localStorage.setItem('iris_mode_solid', nextState ? '1' : '0');
    } catch (e) {}
  }

  _applyTintColor(r, g, b, intensity = 0.70, isNeutral = undefined) {
    if (isNeutral === undefined) {
      isNeutral = (r === 237 && g === 237 && b === 237) || (r === 255 && g === 255 && b === 255);
    }

    window.__IRIS_TINT__ = {
      r,
      g,
      b,
      intensity,
      isNeutral,
      rgba(alpha = 1.0) {
        return `rgba(${this.r}, ${this.g}, ${this.b}, ${alpha})`;
      },
      rgb() {
        return `rgb(${this.r}, ${this.g}, ${this.b})`;
      }
    };

    const root = document.documentElement.style;
    root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.setProperty('--accent-color', `rgb(${r}, ${g}, ${b})`);

    if (this.els.tintPreviewDot) {
      this.els.tintPreviewDot.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    }

    if (isNeutral) {
      root.setProperty('--hairline', 'rgba(237, 237, 237, 0.08)');
      root.setProperty('--hairline-hover', 'rgba(237, 237, 237, 0.18)');
      root.setProperty('--hairline-active', 'rgba(237, 237, 237, 0.28)');
      root.setProperty('--bg-window', 'transparent');
      root.setProperty('--bg-solid', '#0F0F10');
      root.setProperty('--tint-surface', 'rgba(15, 15, 16, 0.85)');
      root.setProperty('--tint-surface-card', 'rgba(25, 25, 27, 0.70)');
      root.setProperty('--tint-surface-header', 'rgba(15, 15, 16, 0.94)');
      root.setProperty('--dot-color', 'rgba(237, 237, 237, 0.07)');

      try {
        localStorage.removeItem('iris_tint_rgb');
        localStorage.removeItem('iris_tint_intensity');
      } catch (e) {}
    } else {
      // Atmospheric dark glass surfaces tinted gently
      const sr = Math.round(15 + (r * 0.08 * intensity));
      const sg = Math.round(15 + (g * 0.08 * intensity));
      const sb = Math.round(16 + (b * 0.08 * intensity));

      const cr = Math.round(25 + (r * 0.07 * intensity));
      const cg = Math.round(25 + (g * 0.07 * intensity));
      const cb = Math.round(27 + (b * 0.07 * intensity));

      const hAlpha = (0.10 + 0.08 * intensity).toFixed(3);
      const hHoverAlpha = (0.22 + 0.12 * intensity).toFixed(3);
      const hActiveAlpha = (0.35 + 0.15 * intensity).toFixed(3);

      root.setProperty('--hairline', `rgba(${r}, ${g}, ${b}, ${hAlpha})`);
      root.setProperty('--hairline-hover', `rgba(${r}, ${g}, ${b}, ${hHoverAlpha})`);
      root.setProperty('--hairline-active', `rgba(${r}, ${g}, ${b}, ${hActiveAlpha})`);

      // TRANSPARENCY (GLASS) MODE:
      // A gentle, photographic tinted glass wash across the whole window (STILL transparent so desktop shows through!)
      const glassWashAlpha = (0.04 + 0.06 * intensity).toFixed(3);
      root.setProperty('--bg-window', `rgba(${r}, ${g}, ${b}, ${glassWashAlpha})`);

      // SOLID MODE:
      const solidR = Math.round(r * 0.08 * intensity);
      const solidG = Math.round(g * 0.08 * intensity);
      const solidB = Math.round(b * 0.08 * intensity);
      root.setProperty('--bg-solid', `rgb(${solidR}, ${solidG}, ${solidB})`);

      // Glass surfaces:
      root.setProperty('--tint-surface', `rgba(${sr}, ${sg}, ${sb}, 0.85)`);
      root.setProperty('--tint-surface-card', `rgba(${cr}, ${cg}, ${cb}, 0.72)`);
      root.setProperty('--tint-surface-header', `rgba(${sr}, ${sg}, ${sb}, 0.94)`);

      // Dot matrix texture shines in the tint color!
      const dotAlpha = (0.12 + 0.14 * intensity).toFixed(3);
      root.setProperty('--dot-color', `rgba(${r}, ${g}, ${b}, ${dotAlpha})`);

      try {
        localStorage.setItem('iris_tint_rgb', `${r},${g},${b}`);
        localStorage.setItem('iris_tint_intensity', `${intensity}`);
      } catch (e) {}
    }

    // Refresh spectrogram palette LUT dynamically
    if (this.spectrogram && typeof this.spectrogram._initMonochromeLut === 'function') {
      this.spectrogram._initMonochromeLut();
    }
  }

  _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return [h, s, l];
  }

  _hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  _hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
