import type { DawProject, Track } from './daw-project';

export type TrackGraph = {
  input: GainNode;
  gain: GainNode;
  pan: StereoPannerNode;
  analyser?: AnalyserNode;
  eq: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  delay: DelayNode;
  delayFeedback: GainNode;
  delayWet: GainNode;
  reverb: ConvolverNode;
  reverbWet: GainNode;
};

export const midiToFrequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

const makeImpulse = (context: BaseAudioContext, seconds = 1.5) => {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.4;
    }
  }
  return impulse;
};

export const createTrackGraph = (
  context: BaseAudioContext,
  track: Track,
  destination: AudioNode,
  includeAnalyser = false,
): TrackGraph => {
  const input = context.createGain();
  const eq = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const dry = context.createGain();
  const delay = context.createDelay(2);
  const delayFeedback = context.createGain();
  const delayWet = context.createGain();
  const reverb = context.createConvolver();
  const reverbWet = context.createGain();
  const pan = context.createStereoPanner();
  const gain = context.createGain();
  const analyser = includeAnalyser ? context.createAnalyser() : undefined;

  eq.type = 'peaking';
  eq.frequency.value = track.effects.eq.frequency;
  eq.gain.value = track.effects.eq.enabled ? track.effects.eq.gain : 0;
  eq.Q.value = 0.85;
  compressor.threshold.value = track.effects.compressor.enabled ? track.effects.compressor.threshold : 0;
  compressor.ratio.value = track.effects.compressor.enabled ? track.effects.compressor.ratio : 1;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.18;
  delay.delayTime.value = track.effects.delay.time;
  delayFeedback.gain.value = track.effects.delay.enabled ? track.effects.delay.feedback : 0;
  delayWet.gain.value = track.effects.delay.enabled ? track.effects.delay.mix : 0;
  reverb.buffer = makeImpulse(context);
  reverbWet.gain.value = track.effects.reverb.enabled ? track.effects.reverb.mix : 0;
  pan.pan.value = track.pan;
  gain.gain.value = track.volume;
  if (analyser) {
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
  }

  input.connect(eq).connect(compressor);
  compressor.connect(dry).connect(pan);
  compressor.connect(delay).connect(delayWet).connect(pan);
  delay.connect(delayFeedback).connect(delay);
  compressor.connect(reverb).connect(reverbWet).connect(pan);
  pan.connect(gain);
  if (analyser) gain.connect(analyser).connect(destination);
  else gain.connect(destination);

  return { input, gain, pan, analyser, eq, compressor, delay, delayFeedback, delayWet, reverb, reverbWet };
};

export const applyTrackToGraph = (graph: TrackGraph, track: Track, audible: boolean) => {
  const now = graph.gain.context.currentTime;
  graph.gain.gain.setTargetAtTime(audible ? track.volume : 0, now, 0.012);
  graph.pan.pan.setTargetAtTime(track.pan, now, 0.012);
  graph.eq.frequency.setTargetAtTime(track.effects.eq.frequency, now, 0.02);
  graph.eq.gain.setTargetAtTime(track.effects.eq.enabled ? track.effects.eq.gain : 0, now, 0.02);
  graph.compressor.threshold.setTargetAtTime(track.effects.compressor.enabled ? track.effects.compressor.threshold : 0, now, 0.02);
  graph.compressor.ratio.setTargetAtTime(track.effects.compressor.enabled ? track.effects.compressor.ratio : 1, now, 0.02);
  graph.delay.delayTime.setTargetAtTime(track.effects.delay.time, now, 0.02);
  graph.delayFeedback.gain.setTargetAtTime(track.effects.delay.enabled ? track.effects.delay.feedback : 0, now, 0.02);
  graph.delayWet.gain.setTargetAtTime(track.effects.delay.enabled ? track.effects.delay.mix : 0, now, 0.02);
  graph.reverbWet.gain.setTargetAtTime(track.effects.reverb.enabled ? track.effects.reverb.mix : 0, now, 0.02);
};

const addNoise = (
  context: BaseAudioContext,
  destination: AudioNode,
  start: number,
  duration: number,
  frequency: number,
  gainValue: number,
) => {
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * duration)), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = frequency > 5000 ? 'highpass' : 'bandpass';
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(gainValue, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(filter).connect(gain).connect(destination);
  source.start(start);
  source.stop(start + duration);
  return source;
};

export const scheduleDrum = (
  context: BaseAudioContext,
  destination: AudioNode,
  drumIndex: number,
  start: number,
) => {
  const nodes: AudioScheduledSourceNode[] = [];
  if (drumIndex === 0) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(145, start);
    oscillator.frequency.exponentialRampToValueAtTime(46, start + 0.16);
    gain.gain.setValueAtTime(0.95, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.23);
    nodes.push(oscillator);
  } else if (drumIndex === 1) {
    nodes.push(addNoise(context, destination, start, 0.16, 1700, 0.5));
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 175;
    gain.gain.setValueAtTime(0.28, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.13);
    nodes.push(oscillator);
  } else if (drumIndex === 2) {
    nodes.push(addNoise(context, destination, start, 0.055, 7200, 0.22));
  } else {
    [0, 0.025, 0.055].forEach((offset, index) => {
      nodes.push(addNoise(context, destination, start + offset, 0.07, 1300, 0.22 - index * 0.035));
    });
  }
  return nodes;
};

export const scheduleSynth = (
  context: BaseAudioContext,
  destination: AudioNode,
  pitch: number,
  start: number,
  duration = 0.48,
  velocity = 0.75,
  instrument: 'synth' | 'bass' = 'synth',
) => {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = instrument === 'bass' ? 'square' : 'sawtooth';
  oscillator.frequency.setValueAtTime(midiToFrequency(pitch), start);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(instrument === 'bass' ? 650 : 1900, start);
  filter.Q.value = instrument === 'bass' ? 2.2 : 4;
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.linearRampToValueAtTime(Math.max(0.025, velocity * 0.24), start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.001, start + Math.max(0.04, duration));
  oscillator.connect(filter).connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(start + Math.max(0.05, duration) + 0.03);
  return oscillator;
};

export const dataUrlToArrayBuffer = async (dataUrl: string) => {
  const response = await fetch(dataUrl);
  return response.arrayBuffer();
};

export const audioBufferToWav = (buffer: AudioBuffer) => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2 + 44;
  const array = new ArrayBuffer(length);
  const view = new DataView(array);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF'); view.setUint32(4, length - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, length - 44, true);
  let offset = 44;
  for (let sample = 0; sample < buffer.length; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[sample]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }
  return array;
};

const floatToInt16 = (data: Float32Array) => {
  const result = new Int16Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    const value = Math.max(-1, Math.min(1, data[index]));
    result[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return result;
};

export const audioBufferToMp3 = async (buffer: AudioBuffer) => {
  // The encoder runs entirely in-browser; no audio leaves the device.
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(2, buffer.sampleRate, 192);
  const left = floatToInt16(buffer.getChannelData(0));
  const right = floatToInt16(buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0));
  const chunks: Int8Array[] = [];
  const block = 1152;
  for (let index = 0; index < left.length; index += block) {
    const encoded = encoder.encodeBuffer(left.subarray(index, index + block), right.subarray(index, index + block));
    if (encoded.length) chunks.push(new Int8Array(encoded));
  }
  const flushed = encoder.flush();
  if (flushed.length) chunks.push(new Int8Array(flushed));
  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
};

export const projectDurationBeats = (project: DawProject) =>
  project.bars * project.timeSignature[0];
