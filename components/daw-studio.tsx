'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Pause, Play, RotateCcw, Save, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Drum = { name: string; color: string; hits: boolean[] };
type MixChannel = { volume: number; mute: boolean; solo: boolean };

const STEPS = Array.from({ length: 16 }, (_, index) => index);
const TRACKS = ['DRUMS', 'SYNTH', 'BASS', 'SAMPLE', 'AUDIO 1', 'AUDIO 2', 'AUX', 'MASTER'];
const NOTES = [
  { label: 'C', frequency: 261.63 }, { label: 'D', frequency: 293.66 },
  { label: 'E', frequency: 329.63 }, { label: 'F', frequency: 349.23 },
  { label: 'G', frequency: 392 }, { label: 'A', frequency: 440 },
  { label: 'B', frequency: 493.88 }, { label: 'C', frequency: 523.25 },
];
const PROJECT_KEY = 'pulseforge-project-v1';

const makeInitialDrums = (): Drum[] => [
  { name: 'KICK', color: '#ff6b4a', hits: STEPS.map((step) => [0, 4, 8, 11, 12].includes(step)) },
  { name: 'SNARE', color: '#ffd15c', hits: STEPS.map((step) => [4, 12].includes(step)) },
  { name: 'HAT', color: '#65d7b0', hits: STEPS.map((step) => step % 2 === 0) },
  { name: 'CLAP', color: '#72a7ff', hits: STEPS.map((step) => step === 12) },
];
const makeInitialMix = (): MixChannel[] => TRACKS.map((_, index) => ({ volume: index === 7 ? 82 : Math.max(42, 68 - index * 3), mute: false, solo: false }));

function addNoise(context: BaseAudioContext, destination: AudioNode, start: number, duration: number, frequency: number, gainValue: number) {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
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
}

function scheduleDrum(context: BaseAudioContext, destination: AudioNode, drumIndex: number, start: number) {
  if (drumIndex === 0) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(145, start);
    oscillator.frequency.exponentialRampToValueAtTime(46, start + 0.16);
    gain.gain.setValueAtTime(0.95, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    oscillator.connect(gain).connect(destination);
    oscillator.start(start); oscillator.stop(start + 0.23);
  } else if (drumIndex === 1) {
    addNoise(context, destination, start, 0.16, 1700, 0.5);
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = 175;
    gain.gain.setValueAtTime(0.28, start); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    oscillator.connect(gain).connect(destination); oscillator.start(start); oscillator.stop(start + 0.13);
  } else if (drumIndex === 2) {
    addNoise(context, destination, start, 0.055, 7200, 0.22);
  } else {
    [0, 0.025, 0.055].forEach((offset, index) => addNoise(context, destination, start + offset, 0.07, 1300, 0.22 - index * 0.035));
  }
}

function scheduleSynth(context: BaseAudioContext, destination: AudioNode, frequency: number, start: number, duration = 0.48) {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  oscillator.type = 'sawtooth'; oscillator.frequency.setValueAtTime(frequency, start);
  filter.type = 'lowpass'; filter.frequency.setValueAtTime(1900, start); filter.Q.value = 4;
  gain.gain.setValueAtTime(0.001, start); gain.gain.linearRampToValueAtTime(0.2, start + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(filter).connect(gain).connect(destination); oscillator.start(start); oscillator.stop(start + duration + 0.02);
}

function audioBufferToWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length * channels * 2 + 44;
  const array = new ArrayBuffer(length); const view = new DataView(array);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, length - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length - 44, true);
  let offset = 44;
  for (let sample = 0; sample < buffer.length; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[sample]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true); offset += 2;
    }
  }
  return array;
}

export default function DawStudio() {
  const [drums, setDrums] = useState<Drum[]>(makeInitialDrums);
  const [mix, setMix] = useState<MixChannel[]>(makeInitialMix);
  const [bpm, setBpm] = useState(118);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [message, setMessage] = useState('ENGINE READY');
  const audioRef = useRef<AudioContext | null>(null);
  const drumGainRef = useRef<GainNode | null>(null);
  const synthGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const timerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const drumsRef = useRef(drums); const mixRef = useRef(mix); const loopRef = useRef(loop);

  useEffect(() => { drumsRef.current = drums; }, [drums]);
  useEffect(() => { mixRef.current = mix; }, [mix]);
  useEffect(() => { loopRef.current = loop; }, [loop]);

  const applyMix = useCallback((nextMix = mixRef.current) => {
    const anySolo = nextMix.some((channel, index) => index < 7 && channel.solo);
    const level = (index: number) => {
      const channel = nextMix[index];
      const audible = !channel.mute && (!anySolo || channel.solo);
      return audible ? channel.volume / 100 : 0;
    };
    if (drumGainRef.current) drumGainRef.current.gain.value = level(0);
    if (synthGainRef.current) synthGainRef.current.gain.value = level(1);
    if (masterGainRef.current) masterGainRef.current.gain.value = nextMix[7].mute ? 0 : nextMix[7].volume / 100;
  }, []);

  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      const context = new AudioContext();
      const master = context.createGain(); const drumGain = context.createGain(); const synthGain = context.createGain();
      drumGain.connect(master); synthGain.connect(master); master.connect(context.destination);
      audioRef.current = context; masterGainRef.current = master; drumGainRef.current = drumGain; synthGainRef.current = synthGain;
      applyMix();
    }
    if (audioRef.current.state === 'suspended') await audioRef.current.resume();
    return audioRef.current;
  }, [applyMix]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null; stepRef.current = 0; setPlaying(false); setCurrentStep(-1);
  }, []);

  const triggerStep = useCallback(() => {
    const context = audioRef.current; const drumGain = drumGainRef.current;
    if (!context || !drumGain) return;
    const step = stepRef.current; setCurrentStep(step);
    drumsRef.current.forEach((drum, index) => { if (drum.hits[step]) scheduleDrum(context, drumGain, index, context.currentTime); });
    if (step === 15 && !loopRef.current) { window.setTimeout(stop, (15000 / bpm) * 0.75); return; }
    stepRef.current = (step + 1) % 16;
  }, [bpm, stop]);

  const play = useCallback(async () => {
    if (playing) return; await ensureAudio(); setPlaying(true); setMessage('PLAYING');
    stepRef.current = 0; triggerStep();
    timerRef.current = window.setInterval(triggerStep, 15000 / bpm);
  }, [bpm, ensureAudio, playing, triggerStep]);

  useEffect(() => {
    if (!playing) return;
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(triggerStep, 15000 / bpm);
    return () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); };
  }, [bpm, playing, triggerStep]);

  useEffect(() => () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); void audioRef.current?.close(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || ['INPUT', 'BUTTON'].includes((event.target as HTMLElement).tagName)) return;
      event.preventDefault(); if (playing) stop(); else void play();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [play, playing, stop]);

  const toggleStep = (drumIndex: number, step: number) => setDrums((current) => current.map((drum, index) => index === drumIndex ? { ...drum, hits: drum.hits.map((active, hitIndex) => hitIndex === step ? !active : active) } : drum));
  const updateMix = (index: number, patch: Partial<MixChannel>) => setMix((current) => {
    const next = current.map((channel, channelIndex) => channelIndex === index ? { ...channel, ...patch } : channel); mixRef.current = next; applyMix(next); return next;
  });

  const playNote = async (frequency: number) => { const context = await ensureAudio(); if (synthGainRef.current) scheduleSynth(context, synthGainRef.current, frequency, context.currentTime); };
  const flash = (copy: string) => { setMessage(copy); window.setTimeout(() => setMessage(playing ? 'PLAYING' : 'ENGINE READY'), 1800); };
  const saveProject = () => { localStorage.setItem(PROJECT_KEY, JSON.stringify({ version: 1, bpm, loop, drums, mix })); flash('PROJECT SAVED'); };
  const loadProject = () => {
    const raw = localStorage.getItem(PROJECT_KEY); if (!raw) { flash('NO SAVED PROJECT'); return; }
    try { const project = JSON.parse(raw); setBpm(project.bpm); setLoop(project.loop); setDrums(project.drums); setMix(project.mix); mixRef.current = project.mix; applyMix(project.mix); flash('PROJECT LOADED'); } catch { flash('LOAD FAILED'); }
  };

  const exportWav = async () => {
    flash('RENDERING WAV');
    const secondsPerStep = 60 / bpm / 4; const duration = secondsPerStep * 16 + 0.7;
    const offline = new OfflineAudioContext(2, Math.ceil(44100 * duration), 44100);
    const master = offline.createGain(); const drumGain = offline.createGain();
    drumGain.gain.value = (mix[0].mute ? 0 : mix[0].volume / 100); master.gain.value = (mix[7].mute ? 0 : mix[7].volume / 100);
    drumGain.connect(master); master.connect(offline.destination);
    drums.forEach((drum, index) => drum.hits.forEach((active, step) => { if (active) scheduleDrum(offline, drumGain, index, step * secondsPerStep); }));
    const rendered = await offline.startRendering(); const blob = new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pulseforge-${bpm}bpm.wav`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); flash('WAV EXPORTED');
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="studio-header">
        <div className="brand-block"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">BROWSER INSTRUMENT</p><h1>PULSEFORGE</h1></div></div>
        <div className="transport" aria-label="Transport controls">
          <Button size="icon-lg" className="transport-play" aria-label={playing ? 'Pause' : 'Play'} onClick={() => playing ? stop() : void play()}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</Button>
          <Button size="icon-lg" variant="outline" aria-label="Stop" onClick={stop}><Square fill="currentColor" /></Button>
          <label className="tempo"><span>BPM</span><input aria-label="Tempo" type="number" min="60" max="180" value={bpm} onChange={(event) => setBpm(Math.max(60, Math.min(180, Number(event.target.value) || 60)))} /></label>
          <div className="position"><span>STEP</span><strong>{currentStep < 0 ? '—' : String(currentStep + 1).padStart(2, '0')}</strong></div>
          <label className="loop-control"><span>LOOP</span><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /></label>
        </div>
        <nav className="file-actions" aria-label="Project actions"><Button variant="ghost" size="sm" onClick={loadProject}><FolderOpen />Load</Button><Button variant="ghost" size="sm" onClick={saveProject}><Save />Save</Button><Button variant="outline" size="sm" onClick={() => void exportWav()}><Download />Export WAV</Button></nav>
      </header>

      <section className="workspace">
        <div className="panel sequencer-panel">
          <div className="panel-heading"><div><p className="eyebrow">PATTERN 01</p><h2>DRUM SEQUENCER</h2></div><Button variant="ghost" size="sm" onClick={() => setDrums((current) => current.map((drum) => ({ ...drum, hits: STEPS.map(() => false) })))}><RotateCcw />Clear</Button></div>
          <div className="step-numbers"><span />{STEPS.map((step) => <span className={currentStep === step ? 'playing-number' : ''} key={step}>{step + 1}</span>)}</div>
          <div className="drum-grid">
            {drums.map((drum, drumIndex) => <div className="drum-row" key={drum.name}><div className="drum-label"><i style={{ background: drum.color }} />{drum.name}</div>{STEPS.map((step) => <button key={step} onClick={() => toggleStep(drumIndex, step)} aria-pressed={drum.hits[step]} aria-label={`${drum.name} step ${step + 1}`} className={`step ${drum.hits[step] ? 'active' : ''} ${currentStep === step ? 'playhead' : ''}`} style={{ '--track-color': drum.color } as React.CSSProperties} />)}</div>)}
          </div>
        </div>

        <aside className="panel synth-panel">
          <div className="panel-heading"><div><p className="eyebrow">INSTRUMENT 02</p><h2>POLY SYNTH</h2></div><span className="status-dot">READY</span></div>
          <div className="synth-display"><small>WAVEFORM</small><strong>SAWTOOTH</strong><div className="waveform">╲╱╲╱╲╱╲╱</div></div>
          <div className="knob-row">{['CUTOFF', 'ATTACK', 'RELEASE'].map((label, index) => <div className="knob-wrap" key={label}><div className="knob" style={{ '--turn': `${-130 + index * 45}deg` } as React.CSSProperties}><i /></div><span>{label}</span></div>)}</div>
          <div className="mini-keys" aria-label="Synth keyboard">{NOTES.map((note, index) => <button key={`${note.label}-${index}`} onPointerDown={() => void playNote(note.frequency)}><span>{note.label}</span></button>)}</div>
          <p className="synth-hint">TAP THE KEYS TO PLAY · SAW VOICE / LOW-PASS FILTER</p>
        </aside>

        <div className="panel mixer-panel">
          <div className="panel-heading mixer-heading"><div><p className="eyebrow">8 CHANNELS</p><h2>MIXER</h2></div><span className="signal-copy">DRUMS + SYNTH ROUTED TO MASTER</span></div>
          <div className="mixer-scroll">{TRACKS.map((track, index) => <div className={`channel ${track === 'MASTER' ? 'master' : ''}`} key={track}><div className="channel-meter"><span style={{ height: mix[index].mute ? '0%' : `${Math.max(12, mix[index].volume - 12)}%` }} /></div><input aria-label={`${track} volume`} className="fader" type="range" min="0" max="100" value={mix[index].volume} onChange={(event) => updateMix(index, { volume: Number(event.target.value) })} /><div className="channel-buttons"><button aria-label={`Mute ${track}`} aria-pressed={mix[index].mute} className={mix[index].mute ? 'selected mute' : ''} onClick={() => updateMix(index, { mute: !mix[index].mute })}>M</button><button aria-label={`Solo ${track}`} aria-pressed={mix[index].solo} className={mix[index].solo ? 'selected solo' : ''} disabled={index === 7} onClick={() => updateMix(index, { solo: !mix[index].solo })}>S</button></div><strong>{track}</strong><small>{mix[index].volume} %</small></div>)}</div>
        </div>
      </section>
      <footer><span>SPACE = PLAY / STOP</span><span>16 STEPS · 4/4 · LOCAL PROJECT</span><span className="engine-live" role="status">● {message}</span></footer>
    </main>
  );
}
