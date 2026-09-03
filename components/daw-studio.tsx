'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AudioLines,
  Circle,
  Clipboard,
  Copy,
  Download,
  FileAudio,
  FolderOpen,
  Gauge,
  KeyboardMusic,
  Magnet,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat2,
  Save,
  Scissors,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  applyTrackToGraph,
  audioBufferToMp3,
  audioBufferToWav,
  createTrackGraph,
  dataUrlToArrayBuffer,
  projectDurationBeats,
  scheduleDrum,
  scheduleSynth,
  type TrackGraph,
} from '@/lib/daw-audio';
import {
  cloneProject,
  defaultEffects,
  DRUM_COLORS,
  DRUM_LABELS,
  DRUM_ROWS,
  emptyPattern,
  makeDefaultProject,
  makeId,
  noteName,
  PITCHES,
  snapBeat,
  type Clip,
  type DawProject,
  type InstrumentType,
  type MidiNote,
  type SnapValue,
  type Track,
  type TrackType,
} from '@/lib/daw-project';

const AUTOSAVE_KEY = 'pulseforge-v1-autosave';
const KEYBOARD_NOTES: Record<string, number> = {
  KeyA: 60, KeyW: 61, KeyS: 62, KeyE: 63, KeyD: 64, KeyF: 65,
  KeyT: 66, KeyG: 67, KeyY: 68, KeyH: 69, KeyU: 70, KeyJ: 71, KeyK: 72,
};
const EDITOR_TABS = ['drums', 'piano', 'mixer', 'effects', 'instruments'] as const;
type EditorTab = (typeof EDITOR_TABS)[number];
type TransportState = 'stopped' | 'playing' | 'paused';
type RecordingMode = 'audio' | 'midi' | null;

const fileToDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not encode file'));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const isProject = (value: unknown): value is DawProject => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DawProject>;
  return candidate.version === 2 && Array.isArray(candidate.tracks) && typeof candidate.bpm === 'number';
};

const getClip = (project: DawProject, clipId: string | null) => {
  if (!clipId) return null;
  for (const track of project.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
};

const getTrack = (project: DawProject, trackId: string | null) =>
  project.tracks.find((track) => track.id === trackId) ?? project.tracks[0];

const makeTrack = (type: TrackType, number: number): Track => {
  const color = type === 'audio' ? '#ffd15c' : type === 'drum' ? '#ff6b4a' : '#72a7ff';
  return {
    id: makeId('track'), name: `${type === 'midi' ? 'Instrument' : type === 'drum' ? 'Drums' : 'Audio'} ${number}`,
    type, instrument: type === 'midi' ? 'synth' : type === 'drum' ? 'drums' : 'none', color,
    volume: 0.78, pan: 0, mute: false, solo: false, armed: false, monitoring: false,
    effects: defaultEffects(), clips: [],
  };
};

export default function DawStudio() {
  const [project, setProject] = useState<DawProject>(makeDefaultProject);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>('drums');
  const [position, setPositionState] = useState(0);
  const [transport, setTransport] = useState<TransportState>('stopped');
  const [recordingMode, setRecordingMode] = useState<RecordingMode>(null);
  const [message, setMessage] = useState('READY');
  const [autosaveState, setAutosaveState] = useState('AUTOSAVE ON');
  const [midiState, setMidiState] = useState('MIDI OFF');
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [masterMeter, setMasterMeter] = useState(0);
  const [beatWidth, setBeatWidth] = useState(54);
  const [noteLength, setNoteLength] = useState(0.5);
  const [noteVelocity, setNoteVelocity] = useState(0.76);
  const [dragPreview, setDragPreview] = useState<{ clipId: string; start: number } | null>(null);

  const projectRef = useRef(project);
  const positionRef = useRef(position);
  const transportRef = useRef(transport);
  const recordingModeRef = useRef<RecordingMode>(recordingMode);
  const historyRef = useRef<DawProject[]>([]);
  const redoRef = useRef<DawProject[]>([]);
  const clipboardRef = useRef<Clip | null>(null);
  const openProjectRef = useRef<HTMLInputElement | null>(null);
  const importAudioRef = useRef<HTMLInputElement | null>(null);
  const sampleFileRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const masterAnalyserRef = useRef<AnalyserNode | null>(null);
  const graphsRef = useRef<Map<string, TrackGraph>>(new Map());
  const activeSourcesRef = useRef<Set<AudioScheduledSourceNode>>(new Set());
  const decodedAudioRef = useRef<Map<string, AudioBuffer>>(new Map());
  const playbackRef = useRef({ contextStart: 0, beatStart: 0, beatEnd: 0 });
  const animationRef = useRef<number | null>(null);
  const startPlaybackRef = useRef<(startAt?: number) => Promise<void>>(async () => {});
  const playbackTickRef = useRef<FrameRequestCallback>(() => {});
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const monitorNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef({ beat: 0, time: 0, trackId: '' });
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const midiPendingRef = useRef<Map<number, { start: number; velocity: number; trackId: string }>>(new Map());
  const keyboardDownRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ clipId: string; trackId: string; startX: number; origin: number } | null>(null);
  const dragPreviewRef = useRef<{ clipId: string; start: number } | null>(null);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { transportRef.current = transport; }, [transport]);
  useEffect(() => { recordingModeRef.current = recordingMode; }, [recordingMode]);

  const flash = useCallback((copy: string) => {
    setMessage(copy);
    window.setTimeout(() => setMessage(transportRef.current === 'playing' ? 'PLAYING' : 'READY'), 1800);
  }, []);

  const setPosition = useCallback((beat: number) => {
    const bounded = Math.max(0, Math.min(projectDurationBeats(projectRef.current), beat));
    positionRef.current = bounded;
    setPositionState(bounded);
  }, []);

  const commit = useCallback((mutate: (draft: DawProject) => void, status?: string) => {
    setProject((current) => {
      historyRef.current = [...historyRef.current.slice(-79), cloneProject(current)];
      redoRef.current = [];
      const next = cloneProject(current);
      mutate(next);
      next.updatedAt = new Date().toISOString();
      projectRef.current = next;
      return next;
    });
    if (status) flash(status);
  }, [flash]);

  const replaceProject = useCallback((next: DawProject, status: string) => {
    historyRef.current = [];
    redoRef.current = [];
    decodedAudioRef.current.clear();
    projectRef.current = next;
    setProject(next);
    setSelectedTrackId(next.tracks[0]?.id ?? null);
    setSelectedClipId(next.tracks[0]?.clips[0]?.id ?? null);
    setPosition(0);
    flash(status);
  }, [flash, setPosition]);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return flash('NOTHING TO UNDO');
    redoRef.current.push(cloneProject(projectRef.current));
    projectRef.current = previous;
    setProject(previous);
    flash('UNDO');
  }, [flash]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return flash('NOTHING TO REDO');
    historyRef.current.push(cloneProject(projectRef.current));
    projectRef.current = next;
    setProject(next);
    flash('REDO');
  }, [flash]);

  useEffect(() => {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (!saved) {
      setSelectedTrackId(projectRef.current.tracks[0]?.id ?? null);
      setSelectedClipId(projectRef.current.tracks[0]?.clips[0]?.id ?? null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(saved);
      if (isProject(parsed)) replaceProject(parsed, 'AUTOSAVE RECOVERED');
    } catch {
      setAutosaveState('AUTOSAVE RESET');
    }
  }, [replaceProject]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project)); setAutosaveState('AUTOSAVED'); }
      catch { setAutosaveState('AUTOSAVE FULL'); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [project]);

  const selected = useMemo(() => getClip(project, selectedClipId), [project, selectedClipId]);
  const selectedTrack = useMemo(() => getTrack(project, selectedTrackId), [project, selectedTrackId]);
  const drumClip = useMemo(() => selected?.clip.type === 'drum' ? selected.clip : project.tracks.find((track) => track.type === 'drum')?.clips[0] ?? null, [project, selected]);
  const midiClip = useMemo(() => selected?.clip.type === 'midi' ? selected.clip : project.tracks.find((track) => track.type === 'midi')?.clips[0] ?? null, [project, selected]);

  const syncGraphs = useCallback((context: AudioContext, currentProject = projectRef.current) => {
    if (!masterRef.current) return;
    const anySolo = currentProject.tracks.some((track) => track.solo);
    currentProject.tracks.forEach((track) => {
      let graph = graphsRef.current.get(track.id);
      if (!graph) { graph = createTrackGraph(context, track, masterRef.current!, true); graphsRef.current.set(track.id, graph); }
      applyTrackToGraph(graph, track, !track.mute && (!anySolo || track.solo));
    });
    masterRef.current.gain.setTargetAtTime(currentProject.masterVolume, context.currentTime, 0.015);
  }, []);

  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      const context = new AudioContext();
      const master = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.74;
      master.connect(analyser).connect(context.destination);
      audioRef.current = context;
      masterRef.current = master;
      masterAnalyserRef.current = analyser;
      syncGraphs(context);
    }
    if (audioRef.current.state === 'suspended') await audioRef.current.resume();
    syncGraphs(audioRef.current);
    return audioRef.current;
  }, [syncGraphs]);

  useEffect(() => { if (audioRef.current) syncGraphs(audioRef.current, project); }, [project, syncGraphs]);

  const decodeData = useCallback(async (context: BaseAudioContext, key: string, data: string) => {
    if (context instanceof AudioContext) {
      const cached = decodedAudioRef.current.get(key);
      if (cached) return cached;
    }
    const decoded = await context.decodeAudioData(await dataUrlToArrayBuffer(data));
    if (context instanceof AudioContext) decodedAudioRef.current.set(key, decoded);
    return decoded;
  }, []);

  const registerSource = useCallback((source: AudioScheduledSourceNode) => {
    activeSourcesRef.current.add(source);
    source.addEventListener('ended', () => activeSourcesRef.current.delete(source), { once: true });
  }, []);

  const stopScheduled = useCallback(() => {
    activeSourcesRef.current.forEach((source) => { try { source.stop(); } catch { /* already stopped */ } });
    activeSourcesRef.current.clear();
  }, []);

  const scheduleArrangement = useCallback(async (
    context: BaseAudioContext, currentProject: DawProject, graphs: Map<string, TrackGraph>,
    fromBeat: number, toBeat: number, contextStart: number, register?: (source: AudioScheduledSourceNode) => void,
  ) => {
    const secondsPerBeat = 60 / currentProject.bpm;
    const atTime = (beat: number) => contextStart + (beat - fromBeat) * secondsPerBeat;
    const anySolo = currentProject.tracks.some((track) => track.solo);
    for (const track of currentProject.tracks) {
      if (track.mute || (anySolo && !track.solo)) continue;
      const graph = graphs.get(track.id);
      if (!graph) continue;
      for (const clip of track.clips) {
        const clipEnd = clip.start + clip.length;
        if (clipEnd <= fromBeat || clip.start >= toBeat) continue;
        if (clip.type === 'drum' && clip.pattern) {
          for (let repetition = clip.start; repetition < clipEnd; repetition += clip.loop ? 4 : clip.length) {
            DRUM_ROWS.forEach((row, drumIndex) => clip.pattern?.[row].forEach((active, step) => {
              const beat = repetition + step * 0.25;
              if (!active || beat < fromBeat || beat >= toBeat || beat >= clipEnd) return;
              scheduleDrum(context, graph.input, drumIndex, atTime(beat)).forEach((source) => register?.(source));
            }));
            if (!clip.loop) break;
          }
        } else if (clip.type === 'midi' && clip.notes) {
          const extent = Math.max(4, ...clip.notes.map((note) => note.start + note.length));
          const repeatSpan = Math.max(4, Math.ceil(extent / 4) * 4);
          for (let repetition = clip.start; repetition < clipEnd; repetition += clip.loop ? repeatSpan : clip.length) {
            for (const note of clip.notes) {
              const beat = repetition + note.start;
              if (beat < fromBeat || beat >= toBeat || beat >= clipEnd) continue;
              if (track.instrument === 'sampler' && track.sampleData) {
                const buffer = await decodeData(context, `${track.id}-sample`, track.sampleData);
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = 2 ** ((note.pitch - 60) / 12);
                const gain = context.createGain(); gain.gain.value = note.velocity;
                source.connect(gain).connect(graph.input);
                source.start(atTime(beat)); source.stop(atTime(beat) + Math.min(buffer.duration, note.length * secondsPerBeat));
                register?.(source);
              } else {
                register?.(scheduleSynth(context, graph.input, note.pitch, atTime(beat), note.length * secondsPerBeat, note.velocity, track.instrument === 'bass' ? 'bass' : 'synth'));
              }
            }
            if (!clip.loop) break;
          }
        } else if (clip.type === 'audio' && clip.audioData) {
          const buffer = await decodeData(context, clip.id, clip.audioData);
          const effectiveStart = Math.max(fromBeat, clip.start);
          const source = context.createBufferSource();
          source.buffer = buffer; source.loop = clip.loop;
          if (clip.loop) source.loopEnd = buffer.duration;
          source.connect(graph.input);
          const offset = (clip.audioOffset ?? 0) + (effectiveStart - clip.start) * secondsPerBeat;
          const duration = (Math.min(toBeat, clipEnd) - effectiveStart) * secondsPerBeat;
          source.start(atTime(effectiveStart), Math.max(0, offset % buffer.duration), Math.max(0.03, duration));
          register?.(source);
        }
      }
    }
  }, [decodeData]);

  const pause = useCallback(() => {
    if (transportRef.current !== 'playing') return;
    const context = audioRef.current;
    if (context) setPosition(playbackRef.current.beatStart + (context.currentTime - playbackRef.current.contextStart) / (60 / projectRef.current.bpm));
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopScheduled();
    transportRef.current = 'paused'; setTransport('paused'); setMessage('PAUSED');
  }, [setPosition, stopScheduled]);

  const stop = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopScheduled(); setPosition(0);
    transportRef.current = 'stopped'; setTransport('stopped'); setMessage('READY');
  }, [setPosition, stopScheduled]);

  const startPlayback = useCallback(async (startAt = positionRef.current) => {
    if (transportRef.current === 'playing') return;
    const context = await ensureAudio();
    const currentProject = projectRef.current;
    const total = projectDurationBeats(currentProject);
    const start = Math.min(startAt, total - 0.01);
    const end = currentProject.loopEnabled ? currentProject.loopEnd : total;
    stopScheduled();
    const contextStart = context.currentTime + 0.07;
    playbackRef.current = { contextStart, beatStart: start, beatEnd: end };
    await scheduleArrangement(context, currentProject, graphsRef.current, start, end, contextStart, registerSource);
    transportRef.current = 'playing'; setTransport('playing'); setMessage('PLAYING');
    playbackTickRef.current = () => {
      if (transportRef.current !== 'playing') return;
      const nextBeat = playbackRef.current.beatStart + Math.max(0, context.currentTime - playbackRef.current.contextStart) / (60 / projectRef.current.bpm);
      if (nextBeat >= playbackRef.current.beatEnd) {
        if (projectRef.current.loopEnabled) {
          stopScheduled(); transportRef.current = 'paused'; setTransport('paused'); setPosition(projectRef.current.loopStart);
          void startPlaybackRef.current(projectRef.current.loopStart);
        } else stop();
        return;
      }
      setPosition(nextBeat); animationRef.current = requestAnimationFrame(playbackTickRef.current);
    };
    animationRef.current = requestAnimationFrame(playbackTickRef.current);
  }, [ensureAudio, registerSource, scheduleArrangement, setPosition, stop, stopScheduled]);
  useEffect(() => { startPlaybackRef.current = startPlayback; }, [startPlayback]);

  const seek = useCallback((beat: number) => {
    const next = snapBeat(beat, projectRef.current.snap);
    if (transportRef.current === 'playing') {
      pause();
      setPosition(next);
      window.setTimeout(() => void startPlayback(next), 0);
    } else setPosition(next);
  }, [pause, setPosition, startPlayback]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const levels: Record<string, number> = {};
      graphsRef.current.forEach((graph, trackId) => {
        if (!graph.analyser) return;
        const data = new Uint8Array(graph.analyser.fftSize); graph.analyser.getByteTimeDomainData(data);
        let sum = 0; data.forEach((value) => { const normalized = (value - 128) / 128; sum += normalized * normalized; });
        levels[trackId] = Math.min(1, Math.sqrt(sum / data.length) * 2.8);
      });
      setMeters(levels);
      if (masterAnalyserRef.current) {
        const data = new Uint8Array(masterAnalyserRef.current.fftSize); masterAnalyserRef.current.getByteTimeDomainData(data);
        let sum = 0; data.forEach((value) => { const normalized = (value - 128) / 128; sum += normalized * normalized; });
        setMasterMeter(Math.min(1, Math.sqrt(sum / data.length) * 2.6));
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, []);

  const triggerNote = useCallback(async (pitch: number, velocity = 0.78, trackId?: string) => {
    const context = await ensureAudio();
    const track = getTrack(projectRef.current, trackId ?? selectedTrackId);
    if (!track || track.type !== 'midi') return;
    const graph = graphsRef.current.get(track.id);
    if (!graph) return;
    if (track.instrument === 'sampler' && track.sampleData) {
      const buffer = await decodeData(context, `${track.id}-sample`, track.sampleData);
      const source = context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = 2 ** ((pitch - 60) / 12);
      source.connect(graph.input); source.start(); registerSource(source);
    } else registerSource(scheduleSynth(context, graph.input, pitch, context.currentTime, 0.42, velocity, track.instrument === 'bass' ? 'bass' : 'synth'));
  }, [decodeData, ensureAudio, registerSource, selectedTrackId]);

  const addRecordedMidiNote = useCallback((pitch: number, pending: { start: number; velocity: number; trackId: string }) => {
    const length = Math.max(projectRef.current.snap, snapBeat(positionRef.current - pending.start, projectRef.current.snap));
    commit((draft) => {
      const track = draft.tracks.find((candidate) => candidate.id === pending.trackId);
      if (!track) return;
      let clip = track.clips.find((candidate) => candidate.type === 'midi' && pending.start >= candidate.start && pending.start < candidate.start + candidate.length);
      if (!clip) {
        const clipStart = Math.floor(pending.start / 4) * 4;
        clip = { id: makeId('clip'), name: 'MIDI Take', type: 'midi', start: clipStart, length: 4, loop: false, color: track.color, notes: [] };
        track.clips.push(clip);
      }
      clip.notes ??= [];
      clip.notes.push({ id: makeId('note'), pitch, start: pending.start - clip.start, length, velocity: pending.velocity });
    }, 'MIDI NOTE RECORDED');
  }, [commit]);

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    if (!event.data) return;
    const [status, pitch, velocity] = Array.from(event.data);
    const command = status & 0xf0;
    if (command === 0x90 && velocity > 0) {
      void triggerNote(pitch, velocity / 127);
      if (recordingModeRef.current === 'midi') {
        const track = projectRef.current.tracks.find((candidate) => candidate.armed && candidate.type === 'midi') ?? projectRef.current.tracks.find((candidate) => candidate.type === 'midi');
        if (track) midiPendingRef.current.set(pitch, { start: positionRef.current, velocity: velocity / 127, trackId: track.id });
      }
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      const pending = midiPendingRef.current.get(pitch);
      if (pending) { midiPendingRef.current.delete(pitch); addRecordedMidiNote(pitch, pending); }
    }
  }, [addRecordedMidiNote, triggerNote]);

  const enableMidi = useCallback(async () => {
    if (!navigator.requestMIDIAccess) return flash('WEB MIDI NOT AVAILABLE');
    try {
      const access = await navigator.requestMIDIAccess(); midiAccessRef.current = access;
      const connectInputs = () => {
        let count = 0; access.inputs.forEach((input) => { input.onmidimessage = handleMidiMessage; count += 1; });
        setMidiState(count ? `MIDI ${count} CONNECTED` : 'MIDI READY');
      };
      connectInputs(); access.onstatechange = connectInputs; flash('MIDI ENABLED');
    } catch { flash('MIDI PERMISSION DENIED'); }
  }, [flash, handleMidiMessage]);

  const stopRecording = useCallback(() => {
    if (recordingModeRef.current === 'audio' && mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
    if (recordingModeRef.current === 'midi') {
      midiPendingRef.current.forEach((pending, pitch) => addRecordedMidiNote(pitch, pending));
      midiPendingRef.current.clear(); recordingModeRef.current = null; setRecordingMode(null); flash('MIDI TAKE CAPTURED');
    }
  }, [addRecordedMidiNote, flash]);

  const startMidiRecording = useCallback(async () => {
    if (recordingModeRef.current) return stopRecording();
    await enableMidi();
    const track = projectRef.current.tracks.find((candidate) => candidate.armed && candidate.type === 'midi') ?? projectRef.current.tracks.find((candidate) => candidate.type === 'midi');
    if (!track) return flash('ADD A MIDI TRACK FIRST');
    setSelectedTrackId(track.id); recordingModeRef.current = 'midi'; setRecordingMode('midi');
    if (transportRef.current !== 'playing') await startPlayback(positionRef.current);
    flash('RECORDING MIDI');
  }, [enableMidi, flash, startPlayback, stopRecording]);

  const startAudioRecording = useCallback(async () => {
    if (recordingModeRef.current) return stopRecording();
    const track = projectRef.current.tracks.find((candidate) => candidate.armed && candidate.type === 'audio') ?? projectRef.current.tracks.find((candidate) => candidate.type === 'audio');
    if (!track) return flash('ADD AN AUDIO TRACK FIRST');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return flash('AUDIO RECORDING UNAVAILABLE');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const context = await ensureAudio(); const recorder = new MediaRecorder(stream);
      mediaStreamRef.current = stream; mediaRecorderRef.current = recorder; recordChunksRef.current = [];
      recordStartRef.current = { beat: positionRef.current, time: performance.now(), trackId: track.id };
      recorder.ondataavailable = (event) => { if (event.data.size) recordChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const audioData = await fileToDataUrl(blob);
        const elapsed = Math.max(0.1, (performance.now() - recordStartRef.current.time) / 1000);
        const beats = Math.max(projectRef.current.snap, snapBeat(elapsed / (60 / projectRef.current.bpm), projectRef.current.snap));
        const targetTrackId = recordStartRef.current.trackId;
        commit((draft) => {
          const destination = draft.tracks.find((candidate) => candidate.id === targetTrackId);
          destination?.clips.push({ id: makeId('clip'), name: `Audio Take ${(destination?.clips.length ?? 0) + 1}`, type: 'audio', start: recordStartRef.current.beat, length: beats, loop: false, color: destination.color, audioData, audioMime: blob.type, sourceDuration: elapsed, audioOffset: 0 });
        }, 'AUDIO TAKE ADDED');
        monitorNodeRef.current?.disconnect(); monitorNodeRef.current = null;
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop()); mediaStreamRef.current = null;
        recordingModeRef.current = null; setRecordingMode(null);
      };
      if (track.monitoring) {
        const graph = graphsRef.current.get(track.id);
        if (graph) { monitorNodeRef.current = context.createMediaStreamSource(stream); monitorNodeRef.current.connect(graph.input); }
      }
      recorder.start(120); recordingModeRef.current = 'audio'; setRecordingMode('audio'); setSelectedTrackId(track.id);
      if (transportRef.current !== 'playing') await startPlayback(positionRef.current);
      flash('RECORDING AUDIO');
    } catch { flash('MIC / INPUT PERMISSION NEEDED'); }
  }, [commit, ensureAudio, flash, startPlayback, stopRecording]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyZ') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (event.code === 'Space') { event.preventDefault(); if (transportRef.current === 'playing') pause(); else void startPlayback(positionRef.current); return; }
      const pitch = KEYBOARD_NOTES[event.code];
      if (pitch === undefined || keyboardDownRef.current.has(event.code)) return;
      keyboardDownRef.current.add(event.code); void triggerNote(pitch);
      if (recordingModeRef.current === 'midi') {
        const track = projectRef.current.tracks.find((candidate) => candidate.armed && candidate.type === 'midi') ?? projectRef.current.tracks.find((candidate) => candidate.type === 'midi');
        if (track) midiPendingRef.current.set(pitch, { start: positionRef.current, velocity: 0.78, trackId: track.id });
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      keyboardDownRef.current.delete(event.code);
      const pitch = KEYBOARD_NOTES[event.code]; const pending = pitch === undefined ? undefined : midiPendingRef.current.get(pitch);
      if (pending) { midiPendingRef.current.delete(pitch); addRecordedMidiNote(pitch, pending); }
    };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); };
  }, [addRecordedMidiNote, pause, redo, startPlayback, triggerNote, undo]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    stopScheduled(); mediaStreamRef.current?.getTracks().forEach((track) => track.stop()); void audioRef.current?.close();
  }, [stopScheduled]);

  const saveProject = () => {
    const next = { ...projectRef.current, updatedAt: new Date().toISOString() };
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(next)); } catch { setAutosaveState('LOCAL STORAGE FULL'); }
    downloadBlob(new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' }), `${next.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pulseforge.json`);
    flash('PROJECT SAVED');
  };

  const openProject = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try { const parsed: unknown = JSON.parse(await file.text()); if (!isProject(parsed)) throw new Error('Invalid project'); replaceProject(parsed, 'PROJECT OPENED'); }
    catch { flash('NOT A PULSEFORGE PROJECT'); }
  };

  const newProject = () => {
    if (!window.confirm('Start a new project? The current project is already autosaved.')) return;
    replaceProject(makeDefaultProject(), 'NEW PROJECT');
  };

  const addTrack = (type: TrackType) => commit((draft) => {
    const track = makeTrack(type, draft.tracks.filter((candidate) => candidate.type === type).length + 1);
    draft.tracks.push(track); setSelectedTrackId(track.id);
  }, `${type.toUpperCase()} TRACK ADDED`);

  const addClip = (trackId = selectedTrack?.id) => {
    if (!trackId) return;
    commit((draft) => {
      const track = draft.tracks.find((candidate) => candidate.id === trackId); if (!track) return;
      const clip: Clip = { id: makeId('clip'), name: track.type === 'drum' ? 'New Beat' : track.type === 'midi' ? 'MIDI Clip' : 'Empty Audio', type: track.type, start: snapBeat(positionRef.current, draft.snap), length: 4, loop: false, color: track.color, pattern: track.type === 'drum' ? emptyPattern() : undefined, notes: track.type === 'midi' ? [] : undefined };
      track.clips.push(clip); setSelectedClipId(clip.id);
    }, 'CLIP ADDED');
  };

  const deleteSelected = () => {
    if (!selectedClipId) return;
    commit((draft) => draft.tracks.forEach((track) => { track.clips = track.clips.filter((clip) => clip.id !== selectedClipId); }), 'CLIP DELETED');
    setSelectedClipId(null);
  };

  const copySelected = () => {
    if (!selected) return flash('SELECT A CLIP');
    clipboardRef.current = JSON.parse(JSON.stringify(selected.clip)) as Clip; flash('CLIP COPIED');
  };
  const cutSelected = () => { if (selected) { clipboardRef.current = JSON.parse(JSON.stringify(selected.clip)) as Clip; deleteSelected(); } else flash('SELECT A CLIP'); };
  const pasteClip = () => {
    const copied = clipboardRef.current; if (!copied) return flash('CLIPBOARD EMPTY');
    const track = selectedTrack ?? project.tracks.find((candidate) => candidate.type === copied.type);
    if (!track || track.type !== copied.type) return flash('SELECT A MATCHING TRACK');
    commit((draft) => {
      const destination = draft.tracks.find((candidate) => candidate.id === track.id); if (!destination) return;
      const pasted = { ...JSON.parse(JSON.stringify(copied)) as Clip, id: makeId('clip'), start: snapBeat(positionRef.current, draft.snap), name: `${copied.name} Copy` };
      destination.clips.push(pasted); setSelectedClipId(pasted.id);
    }, 'CLIP PASTED');
  };

  const splitSelected = () => {
    if (!selected) return flash('SELECT A CLIP');
    const splitAt = snapBeat(positionRef.current, project.snap);
    if (splitAt <= selected.clip.start || splitAt >= selected.clip.start + selected.clip.length) return flash('MOVE PLAYHEAD INSIDE CLIP');
    commit((draft) => {
      const track = draft.tracks.find((candidate) => candidate.id === selected.track.id);
      const clip = track?.clips.find((candidate) => candidate.id === selected.clip.id); if (!track || !clip) return;
      const relative = splitAt - clip.start;
      const second: Clip = { ...JSON.parse(JSON.stringify(clip)) as Clip, id: makeId('clip'), name: `${clip.name} B`, start: splitAt, length: clip.length - relative };
      clip.name = `${clip.name} A`; clip.length = relative;
      if (clip.type === 'midi' && clip.notes) {
        const original = clip.notes;
        clip.notes = original.filter((note) => note.start < relative).map((note) => ({ ...note, length: Math.min(note.length, relative - note.start) }));
        second.notes = original.filter((note) => note.start + note.length > relative).map((note) => ({ ...note, id: makeId('note'), start: Math.max(0, note.start - relative), length: Math.min(note.length, note.start + note.length - relative) }));
      }
      if (clip.type === 'audio') second.audioOffset = (clip.audioOffset ?? 0) + relative * (60 / draft.bpm);
      track.clips.push(second); setSelectedClipId(second.id);
    }, 'CLIP SPLIT');
  };

  const toggleClipLoop = () => {
    if (!selected) return flash('SELECT A CLIP');
    commit((draft) => { const clip = getClip(draft, selected.clip.id)?.clip; if (clip) clip.loop = !clip.loop; }, selected.clip.loop ? 'CLIP LOOP OFF' : 'CLIP LOOP ON');
  };

  const importAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const track = selectedTrack?.type === 'audio' ? selectedTrack : project.tracks.find((candidate) => candidate.type === 'audio');
    if (!track) return flash('ADD AN AUDIO TRACK');
    try {
      const data = await fileToDataUrl(file); const context = await ensureAudio(); const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const beats = Math.max(project.snap, snapBeat(buffer.duration / (60 / project.bpm), project.snap));
      commit((draft) => { const destination = draft.tracks.find((candidate) => candidate.id === track.id); destination?.clips.push({ id: makeId('clip'), name: file.name.replace(/\.[^.]+$/, ''), type: 'audio', start: snapBeat(positionRef.current, draft.snap), length: beats, loop: false, color: destination.color, audioData: data, audioMime: file.type, sourceDuration: buffer.duration, audioOffset: 0 }); }, 'AUDIO IMPORTED');
    } catch { flash('AUDIO IMPORT FAILED'); }
  };

  const loadSampler = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const track = selectedTrack?.instrument === 'sampler' ? selectedTrack : project.tracks.find((candidate) => candidate.instrument === 'sampler');
    if (!track) return flash('SELECT THE SAMPLER TRACK');
    const data = await fileToDataUrl(file);
    commit((draft) => { const destination = draft.tracks.find((candidate) => candidate.id === track.id); if (destination) { destination.sampleData = data; destination.sampleMime = file.type; destination.name = file.name.replace(/\.[^.]+$/, ''); } }, 'SAMPLE LOADED');
  };

  const renderProject = useCallback(async (format: 'wav' | 'mp3') => {
    flash(`RENDERING ${format.toUpperCase()}`);
    try {
      const current = projectRef.current; const durationBeats = projectDurationBeats(current); const seconds = durationBeats * (60 / current.bpm) + 2;
      const offline = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100); const master = offline.createGain();
      master.gain.value = current.masterVolume; master.connect(offline.destination);
      const graphs = new Map<string, TrackGraph>(); const anySolo = current.tracks.some((track) => track.solo);
      current.tracks.forEach((track) => { const graph = createTrackGraph(offline, track, master, false); applyTrackToGraph(graph, track, !track.mute && (!anySolo || track.solo)); graphs.set(track.id, graph); });
      await scheduleArrangement(offline, current, graphs, 0, durationBeats, 0);
      const rendered = await offline.startRendering(); const safeName = current.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      if (format === 'wav') downloadBlob(new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' }), `${safeName}.wav`);
      else downloadBlob(await audioBufferToMp3(rendered), `${safeName}.mp3`);
      flash(`${format.toUpperCase()} EXPORTED`);
    } catch (error) { console.error(error); flash(`${format.toUpperCase()} EXPORT FAILED`); }
  }, [flash, scheduleArrangement]);

  const updateTrack = (trackId: string, mutate: (track: Track) => void, status?: string) => commit((draft) => { const track = draft.tracks.find((candidate) => candidate.id === trackId); if (track) mutate(track); }, status);
  const toggleDrumStep = (rowIndex: number, step: number) => {
    if (!drumClip) return;
    commit((draft) => { const clip = getClip(draft, drumClip.id)?.clip; const row = DRUM_ROWS[rowIndex]; if (clip?.pattern) clip.pattern[row][step] = !clip.pattern[row][step]; });
  };
  const pianoCell = (pitch: number, step: number) => {
    if (!midiClip) return;
    const start = step * 0.25; const existing = midiClip.notes?.find((note) => note.pitch === pitch && Math.abs(note.start - start) < 0.001);
    commit((draft) => {
      const clip = getClip(draft, midiClip.id)?.clip; if (!clip) return; clip.notes ??= [];
      if (existing) { clip.notes = clip.notes.filter((note) => note.id !== existing.id); setSelectedNoteId(null); }
      else { const note: MidiNote = { id: makeId('note'), pitch, start, length: noteLength, velocity: noteVelocity }; clip.notes.push(note); setSelectedNoteId(note.id); void triggerNote(pitch, noteVelocity, selected?.track.id); }
    });
  };
  const updateSelectedNote = (patch: Partial<MidiNote>) => {
    if (!midiClip || !selectedNoteId) return;
    commit((draft) => { const note = getClip(draft, midiClip.id)?.clip.notes?.find((candidate) => candidate.id === selectedNoteId); if (note) Object.assign(note, patch); });
  };

  const onClipPointerDown = (event: ReactPointerEvent, trackId: string, clip: Clip) => {
    event.stopPropagation(); setSelectedTrackId(trackId); setSelectedClipId(clip.id);
    setEditorTab(clip.type === 'drum' ? 'drums' : clip.type === 'midi' ? 'piano' : 'mixer');
    dragRef.current = { clipId: clip.id, trackId, startX: event.clientX, origin: clip.start };
    dragPreviewRef.current = { clipId: clip.id, start: clip.start }; setDragPreview(dragPreviewRef.current);
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current; if (!drag) return;
      const clip = getClip(projectRef.current, drag.clipId)?.clip;
      const next = Math.min(snapBeat(drag.origin + (event.clientX - drag.startX) / beatWidth, projectRef.current.snap), projectDurationBeats(projectRef.current) - (clip?.length ?? 0));
      dragPreviewRef.current = { clipId: drag.clipId, start: next }; setDragPreview(dragPreviewRef.current);
    };
    const up = () => {
      const drag = dragRef.current; const preview = dragPreviewRef.current;
      if (drag && preview && Math.abs(preview.start - drag.origin) > 0.001) commit((draft) => { const clip = getClip(draft, drag.clipId)?.clip; if (clip) clip.start = preview.start; }, 'CLIP MOVED');
      dragRef.current = null; dragPreviewRef.current = null; setDragPreview(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [beatWidth, commit]);

  const totalBeats = projectDurationBeats(project);
  const beatsPerBar = project.timeSignature[0];
  const timelineWidth = totalBeats * beatWidth;
  const bar = Math.floor(position / beatsPerBar) + 1;
  const beatInBar = Math.floor(position % beatsPerBar) + 1;
  const sixteenth = Math.floor((position % 1) * 4) + 1;
  const selectedMidiNote = midiClip?.notes?.find((note) => note.id === selectedNoteId);

  return (
    <main className="daw-shell">
      <input ref={openProjectRef} hidden type="file" accept=".json,.pulseforge" onChange={(event) => void openProject(event)} />
      <input ref={importAudioRef} hidden type="file" accept="audio/*" onChange={(event) => void importAudio(event)} />
      <input ref={sampleFileRef} hidden type="file" accept="audio/*" onChange={(event) => void loadSampler(event)} />

      <header className="daw-header">
        <div className="brand-block"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><small>WEB DAW V1</small><strong>PULSEFORGE</strong></div></div>
        <div className="project-cluster">
          <Button size="sm" variant="ghost" onClick={newProject}><Plus />New</Button><Button size="sm" variant="ghost" onClick={() => openProjectRef.current?.click()}><FolderOpen />Open</Button><Button size="sm" variant="ghost" onClick={saveProject}><Save />Save</Button>
          <input className="project-name" aria-label="Project name" value={project.name} onChange={(event) => commit((draft) => { draft.name = event.target.value; })} />
        </div>
        <div className="transport-cluster" aria-label="Transport">
          <Button size="icon-lg" className="play-button" aria-label="Play" onClick={() => void startPlayback(position)}><Play fill="currentColor" /></Button><Button size="icon-lg" variant="outline" aria-label="Pause" onClick={pause}><Pause fill="currentColor" /></Button><Button size="icon-lg" variant="outline" aria-label="Stop" onClick={() => { if (recordingModeRef.current) stopRecording(); stop(); }}><Square fill="currentColor" /></Button>
          <div className="position-display"><small>BAR · BEAT · STEP</small><strong>{String(bar).padStart(2, '0')} · {beatInBar} · {sixteenth}</strong></div>
          <label className="compact-field"><span>BPM</span><input type="number" min="40" max="240" value={project.bpm} onChange={(event) => commit((draft) => { draft.bpm = Math.max(40, Math.min(240, Number(event.target.value) || 40)); })} /></label>
          <label className="compact-field"><span>METER</span><select value={`${project.timeSignature[0]}/${project.timeSignature[1]}`} onChange={(event) => commit((draft) => { const [top, bottom] = event.target.value.split('/').map(Number); draft.timeSignature = [top, bottom]; })}><option>4/4</option><option>3/4</option><option>6/8</option></select></label>
          <button className={`record-pill ${recordingMode === 'audio' ? 'active' : ''}`} onClick={() => void startAudioRecording()}><Circle fill="currentColor" /> AUDIO</button><button className={`record-pill midi ${recordingMode === 'midi' ? 'active' : ''}`} onClick={() => void startMidiRecording()}><KeyboardMusic /> MIDI</button>
        </div>
        <div className="export-cluster"><Button size="sm" variant="outline" onClick={() => void renderProject('wav')}><Download />WAV</Button><Button size="sm" variant="outline" onClick={() => void renderProject('mp3')}><Download />MP3</Button></div>
      </header>

      <div className="edit-toolbar">
        <div className="tool-group"><Button size="sm" variant="ghost" onClick={undo}><Undo2 />Undo</Button><Button size="sm" variant="ghost" onClick={redo}><Redo2 />Redo</Button></div>
        <div className="tool-group"><Button size="sm" variant="ghost" onClick={cutSelected}><Scissors />Cut</Button><Button size="sm" variant="ghost" onClick={copySelected}><Copy />Copy</Button><Button size="sm" variant="ghost" onClick={pasteClip}><Clipboard />Paste</Button><Button size="sm" variant="ghost" onClick={splitSelected}><Scissors />Split</Button><Button size="sm" variant="ghost" onClick={deleteSelected}><Trash2 />Delete</Button><Button size="sm" variant={selected?.clip.loop ? 'secondary' : 'ghost'} onClick={toggleClipLoop}><Repeat2 />Clip loop</Button></div>
        <div className="tool-spacer" /><Button size="sm" variant="ghost" onClick={() => importAudioRef.current?.click()}><Upload />Import audio</Button>
        <div className="tool-group loop-tools"><Button size="sm" variant={project.loopEnabled ? 'secondary' : 'ghost'} onClick={() => commit((draft) => { draft.loopEnabled = !draft.loopEnabled; })}><Repeat2 />Song loop</Button><label>FROM <input type="number" min="1" max={project.bars} value={Math.floor(project.loopStart / beatsPerBar) + 1} onChange={(event) => commit((draft) => { draft.loopStart = Math.max(0, (Number(event.target.value) - 1) * draft.timeSignature[0]); if (draft.loopEnd <= draft.loopStart) draft.loopEnd = draft.loopStart + draft.timeSignature[0]; })} /></label><label>TO <input type="number" min="1" max={project.bars} value={Math.ceil(project.loopEnd / beatsPerBar)} onChange={(event) => commit((draft) => { draft.loopEnd = Math.max(draft.loopStart + draft.timeSignature[0], Number(event.target.value) * draft.timeSignature[0]); })} /></label></div>
        <div className="tool-group"><Magnet size={14} /><select aria-label="Snap grid" value={project.snap} onChange={(event) => commit((draft) => { draft.snap = Number(event.target.value) as SnapValue; })}><option value="0.25">1/16</option><option value="0.5">1/8</option><option value="1">1/4</option><option value="2">1/2</option><option value="4">1 bar</option></select></div>
        <label className="zoom-control">ZOOM <input type="range" min="34" max="92" value={beatWidth} onChange={(event) => setBeatWidth(Number(event.target.value))} /></label>
      </div>

      <section className="arranger" aria-label="Arrangement timeline">
        <div className="track-list-head"><strong>TRACKS</strong><div className="add-track-menu"><button onClick={() => addTrack('audio')}>+ AUDIO</button><button onClick={() => addTrack('midi')}>+ MIDI</button><button onClick={() => addTrack('drum')}>+ DRUM</button></div></div>
        <div className="timeline-scroll"><div className="timeline-content" style={{ width: timelineWidth }}><div className="loop-region" style={{ left: project.loopStart * beatWidth, width: (project.loopEnd - project.loopStart) * beatWidth }} /><button type="button" className="ruler" aria-label="Set song position" onKeyDown={(event) => { if (event.key === 'ArrowLeft') seek(position - project.snap); if (event.key === 'ArrowRight') seek(position + project.snap); }} onClick={(event) => seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / beatWidth)}>{Array.from({ length: project.bars }, (_, index) => <span className="bar-marker" style={{ left: index * beatsPerBar * beatWidth, width: beatsPerBar * beatWidth }} key={index}><b>{index + 1}</b>{Array.from({ length: Math.max(0, beatsPerBar - 1) }, (_, beatIndex) => <i style={{ left: `${((beatIndex + 1) / beatsPerBar) * 100}%` }} key={beatIndex} />)}</span>)}</button><div className="playhead" style={{ left: position * beatWidth }}><i /></div></div></div>

        {project.tracks.map((track) => <div className={`track-row ${selectedTrack?.id === track.id ? 'selected' : ''}`} key={track.id}>
          <div className="track-header"><i className="track-color" style={{ background: track.color }} /><button className="track-title" onClick={() => setSelectedTrackId(track.id)}><strong>{track.name}</strong><small>{track.type.toUpperCase()} · {track.instrument.toUpperCase()}</small></button><div className="track-buttons"><button className={track.armed ? 'armed' : ''} title="Arm track" onClick={() => updateTrack(track.id, (draft) => { draft.armed = !draft.armed; })}>R</button><button className={track.mute ? 'mute' : ''} title="Mute" onClick={() => updateTrack(track.id, (draft) => { draft.mute = !draft.mute; })}>M</button><button className={track.solo ? 'solo' : ''} title="Solo" onClick={() => updateTrack(track.id, (draft) => { draft.solo = !draft.solo; })}>S</button></div><div className="mini-meter"><span style={{ width: `${(meters[track.id] ?? 0) * 100}%` }} /></div></div>
          <div className="track-lane-scroll"><div className="track-lane" style={{ width: timelineWidth, '--beat': `${beatWidth}px` } as CSSProperties}><button className="lane-seek" aria-label={`Set playhead on ${track.name}; double-click to add a clip`} onClick={(event) => { setSelectedTrackId(track.id); seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / beatWidth); }} onDoubleClick={() => addClip(track.id)} /><div className="loop-region lane-loop" style={{ left: project.loopStart * beatWidth, width: (project.loopEnd - project.loopStart) * beatWidth }} />{track.clips.map((clip) => {
            const visualStart = dragPreview?.clipId === clip.id ? dragPreview.start : clip.start;
            return <button key={clip.id} className={`timeline-clip ${selectedClipId === clip.id ? 'selected' : ''}`} style={{ left: visualStart * beatWidth + 3, width: Math.max(22, clip.length * beatWidth - 6), '--clip-color': clip.color } as CSSProperties} onPointerDown={(event) => onClipPointerDown(event, track.id, clip)}><span>{clip.name}</span><small>{clip.loop ? '↻ ' : ''}{clip.type.toUpperCase()} · {clip.length.toFixed(2)} BEATS</small>{clip.type === 'audio' && <div className="wave-mini">▂▅▃▇▄▆▂▅▇▃▆▄▂▇</div>}{clip.type === 'midi' && <div className="notes-mini">{clip.notes?.slice(0, 16).map((note) => <i key={note.id} style={{ left: `${(note.start / clip.length) * 100}%`, width: `${Math.max(2, (note.length / clip.length) * 100)}%`, bottom: `${((note.pitch - 36) / 40) * 70 + 10}%` }} />)}</div>}</button>;
          })}<div className="lane-playhead" style={{ left: position * beatWidth }} /></div></div>
        </div>)}
      </section>

      <section className="editor-dock">
        <div className="editor-tabs">{EDITOR_TABS.map((tab) => <button className={editorTab === tab ? 'active' : ''} onClick={() => setEditorTab(tab)} key={tab}>{tab === 'drums' ? 'DRUM EDITOR' : tab === 'piano' ? 'PIANO ROLL' : tab.toUpperCase()}</button>)}<div className="editor-context"><span style={{ background: selectedTrack?.color }} />{selectedTrack?.name ?? 'NO TRACK'}{selected?.clip ? ` / ${selected.clip.name}` : ''}</div></div>

        {editorTab === 'drums' && <div className="drum-editor"><div className="editor-side"><small>STEP SEQUENCER</small><strong>{drumClip?.name ?? 'ADD A DRUM CLIP'}</strong><p>Click steps to program a one-bar pattern. Loop the clip to repeat it across the arrangement.</p><Button size="sm" variant="outline" onClick={() => drumClip && commit((draft) => { const clip = getClip(draft, drumClip.id)?.clip; if (clip) clip.pattern = emptyPattern(); })}>Clear pattern</Button></div><div className="step-editor-grid"><div className="step-count"><span />{Array.from({ length: 16 }, (_, step) => <b className={Math.floor((position % 4) / 0.25) === step && transport === 'playing' ? 'playing' : ''} key={step}>{step + 1}</b>)}</div>{DRUM_ROWS.map((row, rowIndex) => <div className="step-editor-row" key={row}><strong><i style={{ background: DRUM_COLORS[rowIndex] }} />{DRUM_LABELS[rowIndex]}</strong>{Array.from({ length: 16 }, (_, step) => <button aria-label={`${DRUM_LABELS[rowIndex]} step ${step + 1}`} style={{ '--step-color': DRUM_COLORS[rowIndex] } as CSSProperties} className={drumClip?.pattern?.[row]?.[step] ? 'active' : ''} onClick={() => toggleDrumStep(rowIndex, step)} key={step} />)}</div>)}</div></div>}

        {editorTab === 'piano' && <div className="piano-editor"><div className="piano-controls"><strong>{midiClip?.name ?? 'ADD / SELECT A MIDI CLIP'}</strong><label>LENGTH <select value={selectedMidiNote?.length ?? noteLength} onChange={(event) => { const value = Number(event.target.value); setNoteLength(value); updateSelectedNote({ length: value }); }}><option value="0.25">1/16</option><option value="0.5">1/8</option><option value="1">1/4</option><option value="2">1/2</option><option value="4">1 bar</option></select></label><label>VELOCITY <input type="range" min="0.1" max="1" step="0.01" value={selectedMidiNote?.velocity ?? noteVelocity} onChange={(event) => { const value = Number(event.target.value); setNoteVelocity(value); updateSelectedNote({ velocity: value }); }} /></label><span>{selectedMidiNote ? `${noteName(selectedMidiNote.pitch)} · ${Math.round(selectedMidiNote.velocity * 127)}` : 'CLICK A CELL TO DRAW'}</span></div><div className="piano-grid">{PITCHES.map((pitch) => <div className="piano-row" key={pitch}><button onPointerDown={() => void triggerNote(pitch, 0.78, selected?.track.id)}>{noteName(pitch)}</button>{Array.from({ length: 16 }, (_, step) => { const note = midiClip?.notes?.find((candidate) => candidate.pitch === pitch && Math.abs(candidate.start - step * 0.25) < 0.001); return <button className={`${note ? 'has-note' : ''} ${note?.id === selectedNoteId ? 'selected' : ''}`} onClick={() => pianoCell(pitch, step)} key={step}>{note && <i style={{ width: `calc(${Math.max(1, Math.round(note.length / 0.25))}00% - 4px)` }} />}</button>; })}</div>)}</div></div>}

        {editorTab === 'mixer' && <div className="mixer-editor">{project.tracks.map((track) => <div className={`mixer-channel ${selectedTrack?.id === track.id ? 'selected' : ''}`} key={track.id}><div className="meter-tall"><span style={{ height: `${(meters[track.id] ?? 0) * 100}%` }} /></div><input className="vertical-fader" aria-label={`${track.name} volume`} type="range" min="0" max="1" step="0.01" value={track.volume} onChange={(event) => updateTrack(track.id, (draft) => { draft.volume = Number(event.target.value); })} /><label>PAN <input type="range" min="-1" max="1" step="0.02" value={track.pan} onChange={(event) => updateTrack(track.id, (draft) => { draft.pan = Number(event.target.value); })} /></label><div className="mixer-buttons"><button className={track.mute ? 'mute' : ''} onClick={() => updateTrack(track.id, (draft) => { draft.mute = !draft.mute; })}>M</button><button className={track.solo ? 'solo' : ''} onClick={() => updateTrack(track.id, (draft) => { draft.solo = !draft.solo; })}>S</button></div><button className="channel-name" onClick={() => setSelectedTrackId(track.id)}>{track.name}</button><small>{Math.round(track.volume * 100)}% · {track.pan === 0 ? 'C' : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : `R${Math.round(track.pan * 100)}`}</small></div>)}<div className="mixer-channel master-channel"><div className="meter-tall"><span style={{ height: `${masterMeter * 100}%` }} /></div><input className="vertical-fader" aria-label="Master volume" type="range" min="0" max="1" step="0.01" value={project.masterVolume} onChange={(event) => commit((draft) => { draft.masterVolume = Number(event.target.value); })} /><Volume2 /><strong>MASTER</strong><small>{Math.round(project.masterVolume * 100)}%</small></div></div>}

        {editorTab === 'effects' && selectedTrack && <div className="effects-editor">{(['eq', 'compressor', 'delay', 'reverb'] as const).map((effect) => <div className={`effect-card ${selectedTrack.effects[effect].enabled ? 'enabled' : ''}`} key={effect}><div className="effect-head"><strong>{effect === 'eq' ? 'PARAMETRIC EQ' : effect.toUpperCase()}</strong><button onClick={() => updateTrack(selectedTrack.id, (track) => { track.effects[effect].enabled = !track.effects[effect].enabled; }, `${effect.toUpperCase()} ${selectedTrack.effects[effect].enabled ? 'OFF' : 'ON'}`)}>{selectedTrack.effects[effect].enabled ? 'ON' : 'OFF'}</button></div>{effect === 'eq' && <><label>FREQUENCY <input type="range" min="80" max="12000" step="10" value={selectedTrack.effects.eq.frequency} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.eq.frequency = Number(event.target.value); })} /><span>{selectedTrack.effects.eq.frequency} Hz</span></label><label>GAIN <input type="range" min="-18" max="18" step="0.5" value={selectedTrack.effects.eq.gain} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.eq.gain = Number(event.target.value); })} /><span>{selectedTrack.effects.eq.gain} dB</span></label></>}{effect === 'compressor' && <><label>THRESHOLD <input type="range" min="-60" max="0" value={selectedTrack.effects.compressor.threshold} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.compressor.threshold = Number(event.target.value); })} /><span>{selectedTrack.effects.compressor.threshold} dB</span></label><label>RATIO <input type="range" min="1" max="20" step="0.5" value={selectedTrack.effects.compressor.ratio} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.compressor.ratio = Number(event.target.value); })} /><span>{selectedTrack.effects.compressor.ratio}:1</span></label></>}{effect === 'delay' && <><label>TIME <input type="range" min="0.05" max="0.8" step="0.01" value={selectedTrack.effects.delay.time} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.delay.time = Number(event.target.value); })} /><span>{Math.round(selectedTrack.effects.delay.time * 1000)} ms</span></label><label>FEEDBACK <input type="range" min="0" max="0.8" step="0.01" value={selectedTrack.effects.delay.feedback} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.delay.feedback = Number(event.target.value); })} /><span>{Math.round(selectedTrack.effects.delay.feedback * 100)}%</span></label></>}{effect === 'reverb' && <label>WET MIX <input type="range" min="0" max="0.7" step="0.01" value={selectedTrack.effects.reverb.mix} onChange={(event) => updateTrack(selectedTrack.id, (track) => { track.effects.reverb.mix = Number(event.target.value); })} /><span>{Math.round(selectedTrack.effects.reverb.mix * 100)}%</span></label>}</div>)}</div>}

        {editorTab === 'instruments' && <div className="instrument-editor"><div className="instrument-browser"><small>VIRTUAL INSTRUMENT</small><strong>{selectedTrack?.type === 'midi' ? selectedTrack.name : 'SELECT A MIDI TRACK'}</strong><div className="instrument-options">{(['synth', 'bass', 'sampler'] as InstrumentType[]).map((instrument) => <button className={selectedTrack?.instrument === instrument ? 'active' : ''} disabled={selectedTrack?.type !== 'midi'} onClick={() => selectedTrack && updateTrack(selectedTrack.id, (track) => { track.instrument = instrument; }, `${instrument.toUpperCase()} LOADED`)} key={instrument}>{instrument.toUpperCase()}</button>)}</div>{selectedTrack?.instrument === 'sampler' && <Button size="sm" variant="outline" onClick={() => sampleFileRef.current?.click()}><FileAudio />{selectedTrack.sampleData ? 'Replace sample' : 'Load sample'}</Button>}<p>Use a MIDI controller or the A–K computer keys. Arm the track and press MIDI Record to capture notes.</p></div><div className="screen-synth"><div className="synth-screen"><small>OSCILLATOR / SAMPLE</small><strong>{selectedTrack?.instrument?.toUpperCase() ?? '—'}</strong><AudioLines /></div><div className="keyboard">{[60, 62, 64, 65, 67, 69, 71, 72].map((pitch) => <button onPointerDown={() => void triggerNote(pitch)} key={pitch}><span>{noteName(pitch)}</span></button>)}</div></div><div className="input-panel"><Gauge /><strong>INPUT & MONITORING</strong><p>Audio tracks can capture any input Safari/Firefox exposes—built-in mic, interface, guitar, or line input.</p>{project.tracks.filter((track) => track.type === 'audio').map((track) => <label key={track.id}><input type="checkbox" checked={track.monitoring} onChange={() => updateTrack(track.id, (draft) => { draft.monitoring = !draft.monitoring; })} /> Monitor {track.name}</label>)}</div></div>}
      </section>

      <footer className="status-bar"><span className={recordingMode ? 'recording-status' : ''}>● {recordingMode ? `RECORDING ${recordingMode.toUpperCase()}` : message}</span><span>{autosaveState}</span><span>{midiState}</span><span><AudioLines /> AUDIO OUTPUT ACTIVE</span><span>SNAP {project.snap === 0.25 ? '1/16' : project.snap} · {project.bpm} BPM · {project.timeSignature[0]}/{project.timeSignature[1]}</span></footer>
    </main>
  );
}
