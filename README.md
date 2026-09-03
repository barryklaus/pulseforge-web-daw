# Pulseforge Browser DAW V1

Pulseforge is a functional, browser-only digital audio workstation. It uses the Web Audio, MediaRecorder, and Web MIDI APIs; projects and audio stay on the device unless the user downloads or uploads a project file.

## V1 features

- Complete project model with New, Open, Save, recovery autosave, and embedded recorded/imported audio
- Play, pause, stop, song-position display, BPM, 4/4, 3/4, and 6/8 grids
- Microphone/audio-interface recording into armed audio tracks, with optional input monitoring
- Web MIDI and computer-keyboard input, live instrument playing, and MIDI recording
- Multi-bar timeline with audio, MIDI, and drum tracks
- Select, cut, copy, paste, split, delete, drag/move, clip looping, and snap-to-grid editing
- Per-track volume, pan, mute, solo, arming, monitoring, and live level meters
- Insert EQ, compressor, delay, and convolution reverb
- Built-in poly synth, bass synth, sample instrument, and synthesized drum kit
- Piano-roll note drawing/editing with note length and velocity
- 16-step drum editor
- Undo/redo history and automatic local recovery
- Offline WAV and MP3 rendering
- Responsive desktop, tablet, and narrow-screen interface

## Run locally

Install Node.js 22.13+ and pnpm, then run:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The first audio action must be initiated by a click or key press. Audio recording requires browser permission for the selected microphone or interface. Web MIDI support depends on the browser and device.

## Deploy to GitHub Pages

1. Upload the repository contents to the root of a GitHub repository.
2. In **Settings → Pages**, select **GitHub Actions** as the source.
3. Push or upload a change to the `main` branch.
4. The included workflow builds and deploys the static app.

The URL will be `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

The deployment workflow includes the asset-path adjustment needed by this Vinext static export on GitHub Pages.

## Project files and privacy

**Save** downloads a `.pulseforge.json` file containing the full session, including short recorded/imported audio clips and sampler data. **Open** restores that file. Autosave uses local browser storage; very large recordings can exceed the browser's local quota, so download a project file regularly.

No backend, account, analytics, or cloud upload is required.

## Stack

React 19, TypeScript, Vinext/Vite, Tailwind CSS, Web Audio API, MediaRecorder, Web MIDI, and `@breezystack/lamejs` for local MP3 encoding.
