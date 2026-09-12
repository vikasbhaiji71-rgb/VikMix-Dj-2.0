/**
 * Audio Synthesizer & WAV Encoder for Royalty-Free Reaction SFX
 *
 * Generates 100% royalty-free, public-domain procedural reaction sound effects
 * using the browser's native OfflineAudioContext and encodes to standard WAV Blobs.
 * Zero external downloads, zero copyright risk.
 */

// Converts an AudioBuffer into a standard PCM 16-bit WAV Blob
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  /* RIFF chunk descriptor */
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  /* FMT sub-chunk */
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  /* DATA sub-chunk */
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave and write 16-bit PCM samples
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelData[c][i];
      // Clamp between -1 and 1
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer (-32768 to 32767)
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Procedural Royalty-Free Sound Generator
 */
export async function generateProceduralMemeSound(type: 'airhorn' | 'boing' | 'rimshot' | 'buzzer' | 'sannata'): Promise<Blob> {
  const sampleRate = 44100;

  if (type === 'airhorn') {
    // Classic DJ Reggae Airhorn (Triple Stabs)
    const duration = 0.9;
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

    const stabs = [0.0, 0.28, 0.56];
    for (const t of stabs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      // Typical airhorn pitch drop from 520Hz down to 480Hz
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.exponentialRampToValueAtTime(470, t + 0.22);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.8, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.24);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.25);
    }

    const rendered = await ctx.startRendering();
    return audioBufferToWavBlob(rendered);
  }

  if (type === 'boing') {
    // Cartoon Boing sound
    const duration = 0.6;
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Frequency sweeps up with vibrato
    osc.frequency.setValueAtTime(140, 0);
    osc.frequency.exponentialRampToValueAtTime(750, 0.35);

    gain.gain.setValueAtTime(0.8, 0);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(0);
    osc.stop(duration);

    const rendered = await ctx.startRendering();
    return audioBufferToWavBlob(rendered);
  }

  if (type === 'rimshot') {
    // Punchline Rimshot / Ba-Dum-Tss
    const duration = 0.8;
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

    // Ba
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.frequency.setValueAtTime(220, 0);
    osc1.frequency.exponentialRampToValueAtTime(100, 0.12);
    gain1.gain.setValueAtTime(0.7, 0);
    gain1.gain.exponentialRampToValueAtTime(0.01, 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(0);
    osc1.stop(0.16);

    // Dum
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.frequency.setValueAtTime(180, 0.2);
    osc2.frequency.exponentialRampToValueAtTime(80, 0.35);
    gain2.gain.setValueAtTime(0.7, 0.2);
    gain2.gain.exponentialRampToValueAtTime(0.01, 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(0.2);
    osc2.stop(0.4);

    // Tss (filtered white noise)
    const noiseBuffer = ctx.createBuffer(1, sampleRate * 0.4, sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseBuffer.length; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, 0.42);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, 0.78);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(0.42);
    noise.stop(0.8);

    const rendered = await ctx.startRendering();
    return audioBufferToWavBlob(rendered);
  }

  if (type === 'buzzer') {
    // Wrong Answer / Game-Show Fail Buzzer
    const duration = 0.65;
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

    // Two detuned low sawtooth oscillators
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(110, 0); // A2
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(116, 0); // Detuned for discordant buzz

    gain.gain.setValueAtTime(0.7, 0);
    gain.gain.setValueAtTime(0.7, 0.5);
    gain.gain.exponentialRampToValueAtTime(0.01, duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(0);
    osc2.start(0);
    osc1.stop(duration);
    osc2.stop(duration);

    const rendered = await ctx.startRendering();
    return audioBufferToWavBlob(rendered);
  }

  // sannata / awkward cricket chirp
  const duration = 1.0;
  const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);

  const chirps = [0.0, 0.1, 0.45, 0.55];
  for (const t of chirps) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(4600, t);
    osc.frequency.linearRampToValueAtTime(4300, t + 0.06);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  const rendered = await ctx.startRendering();
  return audioBufferToWavBlob(rendered);
}
