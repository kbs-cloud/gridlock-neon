// Web Audio Synthwave Sequencer & Sound FX for Gridlock Neon

export class WebAudioSequencer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  
  // Audio state
  private isPlaying = false;
  private bpm = 120;
  private schedulerTimerId: any = null;
  private nextNoteTime = 0.0; // When the next 16th note is due
  private current16thNote = 0; // 0 to 15 (16th notes in a bar)
  private beatCounter = 0; // Total beat count since start
  
  // Noise buffer for percussion
  private noiseBuffer: AudioBuffer | null = null;
  
  // Visualizer data
  private dataArray: Uint8Array = new Uint8Array(0);
  
  // Callbacks
  private onBeatCallback: ((beatCount: number, time: number) => void) | null = null;
  
  constructor() {
    // Lazy initialize on first user interaction to satisfy browser security policies
  }
  
  private init() {
    if (this.audioCtx) return;
    
    // Support prefix for older browsers
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioCtx = new AudioContextClass();
    
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(0.25, this.audioCtx.currentTime); // Master volume limit
    
    // Connect nodes: Synth nodes -> masterGain -> analyser -> destination
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    
    // Create white noise buffer
    const sampleRate = this.audioCtx.sampleRate;
    const bufferSize = sampleRate * 2; // 2 seconds of noise
    const buffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
  }
  
  public start(onBeat: (beatCount: number, time: number) => void) {
    this.init();
    if (this.isPlaying) return;
    
    this.onBeatCallback = onBeat;
    
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    
    this.isPlaying = true;
    this.current16thNote = 0;
    this.beatCounter = 0;
    this.nextNoteTime = this.audioCtx!.currentTime + 0.1;
    
    // Start scheduler loop
    this.schedulerLoop();
  }
  
  public stop() {
    this.isPlaying = false;
    if (this.schedulerTimerId) {
      clearTimeout(this.schedulerTimerId);
      this.schedulerTimerId = null;
    }
    
    if (this.audioCtx && this.audioCtx.state === 'running') {
      // Don't close context, just suspend it
      this.audioCtx.suspend();
    }
  }
  
  public getAnalyserData(): Uint8Array {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.dataArray);
    }
    return this.dataArray;
  }
  
  public setVolume(volume: number) {
    this.init();
    if (this.masterGain && this.audioCtx) {
      const vol = Math.max(0, Math.min(1, volume)) * 0.4; // cap master gain at 40%
      this.masterGain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
    }
  }
  
  private schedulerLoop = () => {
    if (!this.isPlaying || !this.audioCtx) return;
    
    // Schedule notes up to 100ms in advance
    const scheduleAheadTime = 0.1; 
    while (this.nextNoteTime < this.audioCtx.currentTime + scheduleAheadTime) {
      this.scheduleNote(this.current16thNote, this.nextNoteTime);
      this.advanceNote();
    }
    
    // Poll every 25ms
    this.schedulerTimerId = setTimeout(this.schedulerLoop, 25);
  };
  
  private advanceNote() {
    // 16th note tempo calculations
    const secondsPerBeat = 60.0 / this.bpm;
    const secondsPerNote = secondsPerBeat / 4.0; // 16th notes
    
    this.nextNoteTime += secondsPerNote;
    this.current16thNote = (this.current16thNote + 1) % 16;
  }
  
  private scheduleNote(step: number, time: number) {
    if (!this.audioCtx || !this.masterGain) return;
    
    // BPM rhythm pattern beats: 
    // Kick on 0, 4, 8, 12 (Quarter notes)
    // Snare on 4, 12 (Backbeats)
    // Hi-hat on 2, 6, 10, 14 (Off-beats) or full 8th note rolls
    
    const isQuarterNote = step % 4 === 0;
    if (isQuarterNote) {
      this.beatCounter++;
      if (this.onBeatCallback) {
        // Run callback slightly before or exactly on beat time
        setTimeout(() => {
          if (this.isPlaying) {
            this.onBeatCallback!(this.beatCounter, time);
          }
        }, Math.max(0, (time - this.audioCtx!.currentTime) * 1000));
      }
    }
    
    // Play drums
    // Kick drum
    if (step % 4 === 0) {
      this.synthesizeKick(time);
    }
    
    // Snare drum
    if (step === 4 || step === 12) {
      this.synthesizeSnare(time);
    }
    
    // Hi-hats
    if (step % 2 === 0) {
      this.synthesizeHiHat(time, step % 4 !== 0);
    }
    
    // Synth Bass arpeggio (Sawtooth wave, Minor key progression)
    // Progression: I (Am) - VII (G) - VI (F) - VII (G) over 4 bars
    // Bass plays 16th note arpeggios
    this.synthesizeBass(step, time);
    
    // Synth Lead melody (simple retro chime on specific beats)
    this.synthesizeMelody(step, time);
  }
  
  // --- DRUM SYNTHESIS ---
  
  private synthesizeKick(time: number) {
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    // Pitch sweep (Kick drum thump)
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.12);
    
    // Gain envelope
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.linearRampToValueAtTime(0.01, time + 0.15);
    
    osc.start(time);
    osc.stop(time + 0.16);
  }
  
  private synthesizeSnare(time: number) {
    if (!this.audioCtx || !this.masterGain || !this.noiseBuffer) return;
    
    // Noise source
    const noiseSource = this.audioCtx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    
    // Filter to shape noise
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;
    
    // Snare shell oscillator (gives body)
    const osc = this.audioCtx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    
    const oscGain = this.audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.3, time);
    oscGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
    
    const noiseGain = this.audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.8, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 0.25);
    
    // Connect nodes
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    
    noiseSource.start(time);
    noiseSource.stop(time + 0.26);
    
    osc.start(time);
    osc.stop(time + 0.12);
  }
  
  private synthesizeHiHat(time: number, isOffBeat: boolean) {
    if (!this.audioCtx || !this.masterGain || !this.noiseBuffer) return;
    
    const source = this.audioCtx.createBufferSource();
    source.buffer = this.noiseBuffer;
    
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500;
    
    const gain = this.audioCtx.createGain();
    const vol = isOffBeat ? 0.35 : 0.18;
    const duration = isOffBeat ? 0.08 : 0.04;
    
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    source.start(time);
    source.stop(time + duration + 0.01);
  }
  
  // --- BASS LINE SYNTHESIS ---
  
  private getRootNote(bar: number): number {
    // Bar numbers in 4-bar loop: 0, 1, 2, 3
    const roots = [
      55.00, // A1 (Am)
      48.99, // G1 (G)
      43.65, // F1 (F)
      48.99  // G1 (G)
    ];
    return roots[bar % 4];
  }
  
  private synthesizeBass(step: number, time: number) {
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const filter = this.audioCtx.createBiquadFilter();
    
    osc.type = 'sawtooth';
    
    // Identify current chord bar
    const totalStepCount = this.beatCounter * 4 + step;
    const bar = Math.floor(totalStepCount / 16);
    const rootFreq = this.getRootNote(bar);
    
    // Arpeggio notes: octaves and 5ths
    // 16th note pattern: Root, Octave, Octave, Fifth, Root, Octave, Octave, Root ...
    const pattern = [1, 2, 2, 1.5, 1, 2, 2, 1];
    const freqMult = pattern[step % pattern.length];
    
    osc.frequency.setValueAtTime(rootFreq * freqMult, time);
    
    // Lowpass filter sweep for fat synth bass sound
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.exponentialRampToValueAtTime(80, time + 0.12);
    
    // Gain envelope
    gain.gain.setValueAtTime(0.45, time);
    gain.gain.linearRampToValueAtTime(0.01, time + 0.12);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.13);
  }
  
  // --- RETRO MELODY SYNTHESIS ---
  
  private synthesizeMelody(step: number, time: number) {
    if (!this.audioCtx || !this.masterGain) return;
    
    // Retro lead chime notes (only plays on certain steps of the 16 step bar)
    // Melody notes in A Minor Pentatonic: A4, C5, D5, E5, G5, A5
    const melodyPattern: { [key: number]: number } = {
      0: 440.00,  // A4
      3: 523.25,  // C5
      6: 587.33,  // D5
      8: 659.25,  // E5
      11: 783.99, // G5
      14: 880.00  // A5
    };
    
    const noteFreq = melodyPattern[step];
    
    // Only play melody notes in odd-numbered bars to make it less repetitive
    const totalStepCount = this.beatCounter * 4 + step;
    const bar = Math.floor(totalStepCount / 16);
    
    if (noteFreq && bar % 2 === 1) {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const filter = this.audioCtx.createBiquadFilter();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(noteFreq, time);
      
      // Retro chime filter
      filter.type = 'peaking';
      filter.frequency.setValueAtTime(2000, time);
      filter.Q.value = 1.0;
      
      // Delay effect simple simulation (gain envelop tail)
      gain.gain.setValueAtTime(0.25, time);
      gain.gain.exponentialRampToValueAtTime(0.005, time + 0.28);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      
      osc.start(time);
      osc.stop(time + 0.3);
    }
  }
  
  // --- SOUND EFFECTS ---
  
  public playJump() {
    this.init();
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;
    
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    // Rising sweep
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(550, now + 0.18);
    
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.18);
    
    osc.start(now);
    osc.stop(now + 0.19);
  }
  
  public playSlide() {
    this.init();
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;
    
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    // Falling sweep
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(130, now + 0.22);
    
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.001, now + 0.22);
    
    osc.start(now);
    osc.stop(now + 0.23);
  }
  
  public playCollect() {
    this.init();
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc1 = this.audioCtx.createOscillator();
    const osc2 = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;
    
    osc1.type = 'sine';
    osc2.type = 'sine';
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);
    
    // Play high harmonic major 3rd/5th chime chord (e.g. E5 + B5)
    osc1.frequency.setValueAtTime(987.77, now); // B5
    osc2.frequency.setValueAtTime(1318.51, now); // E6
    
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc1.start(now);
    osc2.start(now);
    
    osc1.stop(now + 0.16);
    osc2.stop(now + 0.16);
  }
  
  public playCollision() {
    this.init();
    if (!this.audioCtx || !this.masterGain || !this.noiseBuffer) return;
    
    const noise = this.audioCtx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    
    const osc = this.audioCtx.createOscillator();
    const filter = this.audioCtx.createBiquadFilter();
    
    const oscGain = this.audioCtx.createGain();
    const noiseGain = this.audioCtx.createGain();
    
    const now = this.audioCtx.currentTime;
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.linearRampToValueAtTime(20, now + 0.45);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, now);
    
    // Glitchy noise explosion
    noiseGain.gain.setValueAtTime(0.85, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    
    oscGain.gain.setValueAtTime(0.6, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    
    noise.start(now);
    noise.stop(now + 0.51);
    
    osc.start(now);
    osc.stop(now + 0.46);
  }
  
  public playSabotage() {
    this.init();
    if (!this.audioCtx || !this.masterGain) return;
    
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    const now = this.audioCtx.currentTime;
    
    osc.type = 'triangle';
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    // Retro alarm alert siren sweep
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.linearRampToValueAtTime(650, now + 0.12);
    osc.frequency.linearRampToValueAtTime(350, now + 0.24);
    osc.frequency.linearRampToValueAtTime(650, now + 0.36);
    
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    
    osc.start(now);
    osc.stop(now + 0.39);
  }
}
