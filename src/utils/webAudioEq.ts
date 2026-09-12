/**
 * Web Audio API Equalizer Engine
 *
 * Implements genuine DSP frequency filtering using Web Audio API:
 * - LOW: Low-frequency shelving filter (lowshelf @ 100 Hz, -12dB to +12dB)
 * - MID: Peaking filter (peaking @ 1000 Hz, Q = 1.0, -12dB to +12dB)
 * - HI: High-frequency shelving filter (highshelf @ 2500 Hz, -12dB to +12dB)
 *
 * Connects directly to the audio output (AudioContext.destination).
 * Parameter changes are applied immediately in the audio rendering thread.
 */

export class WebAudioEqualizer {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private lowFilter: BiquadFilterNode | null = null;
  private midFilter: BiquadFilterNode | null = null;
  private highFilter: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private connectedElement: HTMLMediaElement | null = null;

  /**
   * Initializes or returns the current AudioContext.
   */
  public getContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
    }
    return this.audioCtx;
  }

  /**
   * Attaches an HTMLMediaElement to the 3-band Web Audio EQ filter chain.
   * If already attached to this element, avoids duplicate createMediaElementSource calls.
   */
  public attachMediaElement(
    element: HTMLMediaElement,
    initialEq: { low: number; mid: number; high: number } = { low: 0, mid: 0, high: 0 }
  ): void {
    if (this.connectedElement === element && this.sourceNode) {
      this.setEq(initialEq.low, initialEq.mid, initialEq.high);
      return;
    }

    const ctx = this.getContext();

    // Disconnect previous node chain if switching media element
    this.disconnect();

    try {
      // 1. Create MediaElementAudioSourceNode from local audio element
      this.sourceNode = ctx.createMediaElementSource(element);
      this.connectedElement = element;

      // 2. LOW: low-frequency shelving filter (100 Hz, gain in dB)
      this.lowFilter = ctx.createBiquadFilter();
      this.lowFilter.type = 'lowshelf';
      this.lowFilter.frequency.value = 100;
      this.lowFilter.gain.value = initialEq.low;

      // 3. MID: peaking filter (1000 Hz, Q = 1.0, gain in dB)
      this.midFilter = ctx.createBiquadFilter();
      this.midFilter.type = 'peaking';
      this.midFilter.frequency.value = 1000;
      this.midFilter.Q.value = 1.0;
      this.midFilter.gain.value = initialEq.mid;

      // 4. HI: high-frequency shelving filter (2500 Hz, gain in dB)
      this.highFilter = ctx.createBiquadFilter();
      this.highFilter.type = 'highshelf';
      this.highFilter.frequency.value = 2500;
      this.highFilter.gain.value = initialEq.high;

      // 5. Master Gain Node
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = 1.0;

      // 6. Connect filter chain: source -> low -> mid -> high -> gain -> destination
      this.sourceNode.connect(this.lowFilter);
      this.lowFilter.connect(this.midFilter);
      this.midFilter.connect(this.highFilter);
      this.highFilter.connect(this.gainNode);
      this.gainNode.connect(ctx.destination);
    } catch (err) {
      console.warn('Web Audio API EQ attach warning:', err);
    }
  }

  /**
   * Immediately updates LOW, MID, and HI bands in the audio rendering thread.
   * Uses setTargetAtTime for click-free instantaneous acoustic response.
   */
  public setEq(lowDb: number, midDb: number, highDb: number): void {
    if (!this.audioCtx) return;
    const now = this.audioCtx.currentTime;

    if (this.lowFilter) {
      this.lowFilter.gain.setTargetAtTime(lowDb, now, 0.015);
    }
    if (this.midFilter) {
      this.midFilter.gain.setTargetAtTime(midDb, now, 0.015);
    }
    if (this.highFilter) {
      this.highFilter.gain.setTargetAtTime(highDb, now, 0.015);
    }
  }

  /**
   * Resumes AudioContext on user interaction if suspended by browser autoplay policy.
   */
  public async resume(): Promise<void> {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (err) {
        console.warn('AudioContext resume warning:', err);
      }
    }
  }

  /**
   * Cleanly disconnects the node chain without closing the context.
   */
  public disconnect(): void {
    try {
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      if (this.lowFilter) {
        this.lowFilter.disconnect();
        this.lowFilter = null;
      }
      if (this.midFilter) {
        this.midFilter.disconnect();
        this.midFilter = null;
      }
      if (this.highFilter) {
        this.highFilter.disconnect();
        this.highFilter = null;
      }
      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }
    } catch {}
    this.connectedElement = null;
  }

  /**
   * Closes the AudioContext on complete teardown.
   */
  public close(): void {
    this.disconnect();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }
}
