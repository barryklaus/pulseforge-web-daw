export type TrackType = 'drum' | 'midi' | 'audio';
export type InstrumentType = 'drums' | 'synth' | 'bass' | 'sampler' | 'none';
export type SnapValue = 0.25 | 0.5 | 1 | 2 | 4;

export type MidiNote = {
  id: string;
  pitch: number;
  start: number;
  length: number;
  velocity: number;
};

export type DrumPattern = {
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
  clap: boolean[];
};

export type Clip = {
  id: string;
  name: string;
  type: TrackType;
  start: number;
  length: number;
  loop: boolean;
  color: string;
  notes?: MidiNote[];
  pattern?: DrumPattern;
  audioData?: string;
  audioMime?: string;
  sourceDuration?: number;
  audioOffset?: number;
};

export type TrackEffects = {
  eq: { enabled: boolean; frequency: number; gain: number };
  compressor: { enabled: boolean; threshold: number; ratio: number };
  delay: { enabled: boolean; time: number; feedback: number; mix: number };
  reverb: { enabled: boolean; mix: number };
};

export type Track = {
  id: string;
  name: string;
  type: TrackType;
  instrument: InstrumentType;
  color: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  armed: boolean;
  monitoring: boolean;
  effects: TrackEffects;
  clips: Clip[];
  sampleData?: string;
  sampleMime?: string;
};

export type DawProject = {
  version: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bpm: number;
  timeSignature: [number, number];
  bars: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  snap: SnapValue;
  masterVolume: number;
  tracks: Track[];
};

export const PITCHES = [72, 71, 69, 67, 65, 64, 62, 60];
export const DRUM_ROWS = ['kick', 'snare', 'hat', 'clap'] as const;
export const DRUM_LABELS = ['KICK', 'SNARE', 'HAT', 'CLAP'];
export const DRUM_COLORS = ['#ff6b4a', '#ffd15c', '#65d7b0', '#72a7ff'];

export const makeId = (prefix = 'id') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const emptyPattern = (): DrumPattern => ({
  kick: Array(16).fill(false),
  snare: Array(16).fill(false),
  hat: Array(16).fill(false),
  clap: Array(16).fill(false),
});

export const starterPattern = (): DrumPattern => ({
  kick: Array.from({ length: 16 }, (_, step) => [0, 4, 8, 11, 12].includes(step)),
  snare: Array.from({ length: 16 }, (_, step) => [4, 12].includes(step)),
  hat: Array.from({ length: 16 }, (_, step) => step % 2 === 0),
  clap: Array.from({ length: 16 }, (_, step) => step === 12),
});

export const defaultEffects = (): TrackEffects => ({
  eq: { enabled: false, frequency: 1200, gain: 0 },
  compressor: { enabled: false, threshold: -18, ratio: 4 },
  delay: { enabled: false, time: 0.25, feedback: 0.28, mix: 0.2 },
  reverb: { enabled: false, mix: 0.18 },
});

const makeTrack = (
  name: string,
  type: TrackType,
  instrument: InstrumentType,
  color: string,
  clips: Clip[] = [],
): Track => ({
  id: makeId('track'),
  name,
  type,
  instrument,
  color,
  volume: 0.78,
  pan: 0,
  mute: false,
  solo: false,
  armed: false,
  monitoring: false,
  effects: defaultEffects(),
  clips,
});

export const makeDefaultProject = (): DawProject => {
  const now = new Date().toISOString();
  const drumClip: Clip = {
    id: makeId('clip'), name: 'Beat 01', type: 'drum', start: 0, length: 4,
    loop: true, color: '#ff6b4a', pattern: starterPattern(),
  };
  const synthClip: Clip = {
    id: makeId('clip'), name: 'Neon Chords', type: 'midi', start: 0, length: 8,
    loop: true, color: '#72a7ff', notes: [
      { id: makeId('note'), pitch: 60, start: 0, length: 1.5, velocity: 0.72 },
      { id: makeId('note'), pitch: 64, start: 0, length: 1.5, velocity: 0.66 },
      { id: makeId('note'), pitch: 67, start: 0, length: 1.5, velocity: 0.64 },
      { id: makeId('note'), pitch: 62, start: 2, length: 1.5, velocity: 0.72 },
      { id: makeId('note'), pitch: 65, start: 2, length: 1.5, velocity: 0.66 },
      { id: makeId('note'), pitch: 69, start: 2, length: 1.5, velocity: 0.64 },
    ],
  };
  const bassClip: Clip = {
    id: makeId('clip'), name: 'Sub Motion', type: 'midi', start: 0, length: 4,
    loop: true, color: '#65d7b0', notes: [0, 1, 2, 3].map((start, index) => ({
      id: makeId('note'), pitch: index < 2 ? 36 : 38, start, length: 0.7, velocity: 0.82,
    })),
  };
  return {
    version: 2,
    id: makeId('project'),
    name: 'Untitled Pulse',
    createdAt: now,
    updatedAt: now,
    bpm: 118,
    timeSignature: [4, 4],
    bars: 8,
    loopEnabled: true,
    loopStart: 0,
    loopEnd: 16,
    snap: 0.25,
    masterVolume: 0.82,
    tracks: [
      makeTrack('Drums', 'drum', 'drums', '#ff6b4a', [drumClip]),
      makeTrack('Poly Synth', 'midi', 'synth', '#72a7ff', [synthClip]),
      makeTrack('Bass', 'midi', 'bass', '#65d7b0', [bassClip]),
      makeTrack('Sampler', 'midi', 'sampler', '#d48cff'),
      makeTrack('Audio 1', 'audio', 'none', '#ffd15c'),
      makeTrack('Audio 2', 'audio', 'none', '#ff8ca8'),
    ],
  };
};

export const cloneProject = (project: DawProject): DawProject =>
  JSON.parse(JSON.stringify(project)) as DawProject;

export const snapBeat = (beat: number, snap: SnapValue) =>
  Math.max(0, Math.round(beat / snap) * snap);

export const noteName = (pitch: number) => {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
};
