# Pulseforge

A compact browser-only beat studio built with the Web Audio API. Pulseforge includes a 16-step drum sequencer, playable sawtooth synth, eight-channel mixer concept, local project memory, and offline WAV export. Audio and project data stay on your device.

## Features

- Four synthesized drum voices: kick, snare, hi-hat, and clap
- 16-step transport with 60–180 BPM and one-shot/loop modes
- Playable eight-note synth keyboard
- Eight mixer channels with volume, mute, and solo controls
- Local save/load using browser storage
- One-bar 44.1 kHz WAV export
- Responsive desktop and tablet layout

## Run locally

Install Node.js 22 and pnpm, then:

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Press Space to start or stop playback. Browsers require the first sound to be started by a click or key press.

## Deploy to GitHub Pages

1. Create a new GitHub repository and upload this folder (or push it with Git).
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Push to the `main` branch. The included workflow builds and publishes the site.

The finished URL will be `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

## Technology

React, TypeScript, Vinext/Vite, Tailwind CSS, and the native Web Audio API. No backend, user account, sample library, or analytics are required.
