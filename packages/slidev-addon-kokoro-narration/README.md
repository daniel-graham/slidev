# slidev-addon-kokoro-narration

Run natural text-to-speech narration in a Slidev deck with
[`kokoro-js`](https://www.npmjs.com/package/kokoro-js). The model loads lazily in
the browser the first time narration starts, so regular deck startup stays
light.

## Install

```bash
npm install slidev-addon-kokoro-narration
```

Then add the addon to your deck headmatter:

```md
---
addons:
  - slidev-addon-kokoro-narration
---
```

## Use

```md
<KokoroNarration text="This slide explains the main result." />
```

Useful props:

- `text`: narration text for the current slide.
- `voice`: Kokoro voice id, default `af_heart`.
- `speed`: speech speed, default `1`.
- `model`: model id, default `onnx-community/Kokoro-82M-v1.0-ONNX`.
- `dtype`: model precision, default `q8`.
- `device`: `wasm`, `webgpu`, or `auto`, default `wasm`.

The component generates a WAV object URL in the browser and revokes it after
playback or when the slide component unmounts.
