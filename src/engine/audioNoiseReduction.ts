export type NoiseReductionStrength = 'balanced' | 'studio';

export interface VoiceActivityInput {
  rms: number;
  voiceBandRatio: number; // fraction of spectral energy inside 250Hz - 3.6kHz speech band (0..1)
  noiseFloor: number;
  strength: NoiseReductionStrength;
  currentlyOpen: boolean;
}

export interface VoiceActivityResult {
  targetGain: number;
  gateOpen: boolean;
  attenuationDb: number;
}

export interface AudioNoiseStats {
  enabled: boolean;
  strength: NoiseReductionStrength;
  speechActive: boolean;
  noiseFloorDb: number;
  reductionDb: number;
}

/**
 * Tracks ambient background noise floor adaptively over time:
 * - Drops rapidly when the room becomes quieter.
 * - Adapts upward slowly only when sustained stationary noise (fans, AC) is present,
 *   ignoring transient speech spikes.
 */
export class AdaptiveNoiseEstimator {
  private floor: number;
  private readonly minFloor = 0.0025;
  private readonly maxFloor = 0.14;

  constructor(initialFloor = 0.008) {
    this.floor = Math.max(this.minFloor, Math.min(this.maxFloor, initialFloor));
  }

  update(rms: number, voiceBandRatio: number): number {
    const safeRms = Math.max(0, Math.min(1, Number.isFinite(rms) ? rms : 0));

    if (safeRms < this.floor) {
      // Quiet room frame: track downward quickly
      this.floor = this.floor * 0.88 + safeRms * 0.12;
    } else if (safeRms < this.floor * 2.2 && voiceBandRatio < 0.62) {
      // Likely steady ambient hum/fan rather than speech: creep slowly upward
      this.floor = this.floor * 0.985 + safeRms * 0.015;
    }

    this.floor = Math.max(this.minFloor, Math.min(this.maxFloor, this.floor));
    return this.floor;
  }

  getFloor(): number {
    return this.floor;
  }

  reset(initialFloor = 0.008): void {
    this.floor = Math.max(this.minFloor, Math.min(this.maxFloor, initialFloor));
  }
}

/**
 * Computes smooth soft-knee voice-activity attenuation gain relative to the
 * estimated ambient noise floor and speech-band spectral concentration.
 */
export function computeVoiceActivityGain(input: VoiceActivityInput): VoiceActivityResult {
  const rms = Math.max(0, input.rms);
  const floor = Math.max(0.0025, input.noiseFloor);
  const voiceRatio = Math.max(0, Math.min(1, input.voiceBandRatio));

  const openMultiplier = input.strength === 'studio' ? 2.45 : 1.95;
  const closeMultiplier = input.strength === 'studio' ? 1.65 : 1.35;
  // Slightly lower threshold when spectral energy is clearly concentrated in vocal formants
  const spectralAssist = voiceRatio >= 0.48 ? 0.84 : 1.0;

  const openThreshold = floor * openMultiplier * spectralAssist;
  const closeThreshold = floor * closeMultiplier * spectralAssist;
  const floorAttenuation = input.strength === 'studio' ? 0.035 : 0.08; // ~ -29dB vs -22dB

  const gateOpen = input.currentlyOpen ? rms >= closeThreshold : rms >= openThreshold;

  let targetGain = 1.0;
  if (!gateOpen) {
    // Soft knee transition between noise floor and close threshold so tails never clip abruptly
    const ratio = closeThreshold > 0 ? Math.min(1, rms / closeThreshold) : 0;
    const knee = ratio * ratio;
    targetGain = floorAttenuation + (0.28 - floorAttenuation) * knee;
  } else if (rms < openThreshold * 1.35) {
    // Gentle transition zone just above threshold
    const span = Math.max(0.0001, openThreshold * 1.35 - closeThreshold);
    const t = Math.max(0, Math.min(1, (rms - closeThreshold) / span));
    targetGain = 0.55 + 0.45 * t;
  }

  targetGain = Math.max(floorAttenuation, Math.min(1.0, targetGain));
  const attenuationDb = targetGain >= 0.99 ? 0 : Math.round(-20 * Math.log10(targetGain));

  return { targetGain, gateOpen, attenuationDb };
}

/**
 * Real-time Web Audio API speech isolation & noise reduction pipeline.
 * Filters HVAC rumble, fan hum, and mic hiss while preserving crisp broadcast voice
 * into a processed MediaStreamAudioDestinationNode for MediaRecorder capture.
 */
export class StudioAudioProcessor {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private rawAnalyser: AnalyserNode | null = null;
  private postAnalyser: AnalyserNode | null = null;

  private highPass: BiquadFilterNode | null = null;
  private presenceFilter: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private gateGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private processedBranchGain: GainNode | null = null;
  private bypassBranchGain: GainNode | null = null;

  private rawStream: MediaStream | null = null;
  private estimator = new AdaptiveNoiseEstimator();
  private enabled = true;
  private strength: NoiseReductionStrength = 'balanced';
  private gateOpen = false;
  private lastStats: AudioNoiseStats = {
    enabled: true,
    strength: 'balanced',
    speechActive: false,
    noiseFloorDb: -48,
    reductionDb: 0,
  };
  private timerId: number | null = null;

  private timeData = new Float32Array(512);
  private freqData = new Uint8Array(256);
  private meterData = new Uint8Array(128);

  constructor(initialEnabled = true, initialStrength: NoiseReductionStrength = 'balanced') {
    this.enabled = initialEnabled;
    this.strength = initialStrength;
    this.lastStats.enabled = initialEnabled;
    this.lastStats.strength = initialStrength;
  }

  attachStream(stream: MediaStream): void {
    this.dispose();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0 || typeof AudioContext === 'undefined') {
      this.rawStream = stream;
      return;
    }

    this.rawStream = stream;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const source = ctx.createMediaStreamSource(stream);
    const rawAnalyser = ctx.createAnalyser();
    rawAnalyser.fftSize = 512;
    rawAnalyser.smoothingTimeConstant = 0.45;

    const postAnalyser = ctx.createAnalyser();
    postAnalyser.fftSize = 256;

    const destination = ctx.createMediaStreamDestination();

    // Broadcast DSP Chain: HighPass -> Presence -> De-Hiss HighShelf -> Adaptive Gate -> Compressor
    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = this.strength === 'studio' ? 105 : 85;
    highPass.Q.value = 0.72;

    const presenceFilter = ctx.createBiquadFilter();
    presenceFilter.type = 'peaking';
    presenceFilter.frequency.value = 2800;
    presenceFilter.Q.value = 1.05;
    presenceFilter.gain.value = this.strength === 'studio' ? 3.2 : 2.2;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = 7600;
    highShelf.gain.value = this.strength === 'studio' ? -5.5 : -3.5;

    const gateGain = ctx.createGain();
    gateGain.gain.value = 1.0;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.16;

    const processedBranchGain = ctx.createGain();
    processedBranchGain.gain.value = this.enabled ? 1 : 0;

    const bypassBranchGain = ctx.createGain();
    bypassBranchGain.gain.value = this.enabled ? 0 : 1;

    // Wire raw monitor + both branches without breaking audio continuity on toggle
    source.connect(rawAnalyser);
    source.connect(bypassBranchGain);
    bypassBranchGain.connect(postAnalyser);
    bypassBranchGain.connect(destination);

    source.connect(highPass);
    highPass.connect(presenceFilter);
    presenceFilter.connect(highShelf);
    highShelf.connect(gateGain);
    gateGain.connect(compressor);
    compressor.connect(processedBranchGain);
    processedBranchGain.connect(postAnalyser);
    processedBranchGain.connect(destination);

    this.ctx = ctx;
    this.source = source;
    this.destination = destination;
    this.rawAnalyser = rawAnalyser;
    this.postAnalyser = postAnalyser;
    this.highPass = highPass;
    this.presenceFilter = presenceFilter;
    this.highShelf = highShelf;
    this.gateGain = gateGain;
    this.compressor = compressor;
    this.processedBranchGain = processedBranchGain;
    this.bypassBranchGain = bypassBranchGain;

    this.timeData = new Float32Array(rawAnalyser.fftSize);
    this.freqData = new Uint8Array(rawAnalyser.frequencyBinCount);
    this.meterData = new Uint8Array(postAnalyser.frequencyBinCount);

    this.syncHardwareConstraints();

    this.timerId = window.setInterval(() => {
      this.processFrame();
    }, 25);
  }

  private syncHardwareConstraints(): void {
    if (!this.rawStream) return;
    for (const track of this.rawStream.getAudioTracks()) {
      if (typeof track.applyConstraints === 'function') {
        track
          .applyConstraints({
            noiseSuppression: this.enabled,
            echoCancellation: true,
            autoGainControl: this.enabled,
          })
          .catch(() => {});
      }
    }
  }

  private processFrame(): void {
    if (!this.ctx || !this.rawAnalyser || !this.gateGain) return;

    if (!this.enabled) {
      this.gateGain.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.02);
      this.lastStats = {
        enabled: false,
        strength: this.strength,
        speechActive: true,
        noiseFloorDb: -60,
        reductionDb: 0,
      };
      return;
    }

    this.rawAnalyser.getFloatTimeDomainData(this.timeData);
    this.rawAnalyser.getByteFrequencyData(this.freqData);

    let sumSq = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const s = this.timeData[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / this.timeData.length);

    // Estimate ratio of spectral energy in human vocal fundamental/formants (250Hz - 3.6kHz)
    const sampleRate = this.ctx.sampleRate || 48000;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / Math.max(1, this.freqData.length);
    const minVoiceBin = Math.max(1, Math.floor(250 / binHz));
    const maxVoiceBin = Math.min(this.freqData.length - 1, Math.ceil(3600 / binHz));

    let totalEnergy = 0;
    let voiceEnergy = 0;
    for (let i = 1; i < this.freqData.length; i++) {
      const e = this.freqData[i];
      totalEnergy += e;
      if (i >= minVoiceBin && i <= maxVoiceBin) {
        voiceEnergy += e;
      }
    }
    const voiceBandRatio = totalEnergy > 10 ? voiceEnergy / totalEnergy : 0;

    const noiseFloor = this.estimator.update(rms, voiceBandRatio);
    const decision = computeVoiceActivityGain({
      rms,
      voiceBandRatio,
      noiseFloor,
      strength: this.strength,
      currentlyOpen: this.gateOpen,
    });

    const timeConstant = decision.targetGain > this.gateGain.gain.value ? 0.008 : 0.095;
    this.gateGain.gain.setTargetAtTime(decision.targetGain, this.ctx.currentTime, timeConstant);
    this.gateOpen = decision.gateOpen;

    this.lastStats = {
      enabled: true,
      strength: this.strength,
      speechActive: decision.gateOpen,
      noiseFloorDb: Math.round(20 * Math.log10(Math.max(0.0005, noiseFloor))),
      reductionDb: decision.attenuationDb,
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.lastStats.enabled = enabled;
    if (this.ctx && this.processedBranchGain && this.bypassBranchGain) {
      const t = this.ctx.currentTime;
      this.processedBranchGain.gain.setTargetAtTime(enabled ? 1 : 0, t, 0.025);
      this.bypassBranchGain.gain.setTargetAtTime(enabled ? 0 : 1, t, 0.025);
    }
    this.syncHardwareConstraints();
  }

  setStrength(strength: NoiseReductionStrength): void {
    this.strength = strength;
    this.lastStats.strength = strength;
    if (this.ctx && this.highPass && this.presenceFilter && this.highShelf) {
      const t = this.ctx.currentTime;
      this.highPass.frequency.setTargetAtTime(strength === 'studio' ? 105 : 85, t, 0.02);
      this.presenceFilter.gain.setTargetAtTime(strength === 'studio' ? 3.2 : 2.2, t, 0.02);
      this.highShelf.gain.setTargetAtTime(strength === 'studio' ? -5.5 : -3.5, t, 0.02);
    }
  }

  getMeterLevel(): number {
    if (!this.postAnalyser) return 0;
    this.postAnalyser.getByteFrequencyData(this.meterData);
    let sum = 0;
    for (let i = 0; i < this.meterData.length; i++) {
      sum += this.meterData[i];
    }
    return Math.min(100, Math.round((sum / this.meterData.length / 128) * 100));
  }

  getStats(): AudioNoiseStats {
    return { ...this.lastStats };
  }

  getOutputAudioTracks(): MediaStreamTrack[] {
    if (this.destination) {
      const processed = this.destination.stream.getAudioTracks();
      if (processed.length > 0) return processed;
    }
    return this.rawStream ? this.rawStream.getAudioTracks() : [];
  }

  dispose(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.source = null;
    this.destination = null;
    this.rawAnalyser = null;
    this.postAnalyser = null;
    this.highPass = null;
    this.presenceFilter = null;
    this.highShelf = null;
    this.gateGain = null;
    this.compressor = null;
    this.processedBranchGain = null;
    this.bypassBranchGain = null;
    this.rawStream = null;
    this.estimator.reset();
    this.gateOpen = false;
  }
}
