const SAMPLE_RATE = 22050;

function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function oscillator(type, phase) {
  switch (type) {
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(phase));
    case 'square':
      return Math.sign(Math.sin(phase)) || 0;
    case 'saw': {
      const normalized = phase / (2 * Math.PI);
      return 2 * (normalized - Math.floor(normalized + 0.5));
    }
    case 'sine':
    default:
      return Math.sin(phase);
  }
}

function pseudoNoise(sampleIndex) {
  const seed = Math.sin(sampleIndex * 12.9898) * 43758.5453123;
  return ((seed - Math.floor(seed)) * 2) - 1;
}

function envelope(progress) {
  const attack = clamp(progress / 0.1, 0, 1);
  const release = clamp((1 - progress) / 0.18, 0, 1);
  return attack * release;
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);

  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function renderWavDataUri({ durationMs, layers, noiseAmount = 0 }) {
  const durationSeconds = durationMs / 1000;
  const totalSamples = Math.floor(durationSeconds * SAMPLE_RATE);
  const buffer = new ArrayBuffer(44 + (totalSamples * 2));
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + (totalSamples * 2), true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, totalSamples * 2, true);

  for (let sampleIndex = 0; sampleIndex < totalSamples; sampleIndex += 1) {
    const currentTime = sampleIndex / SAMPLE_RATE;
    let sample = 0;

    layers.forEach((layer) => {
      const start = (layer.start ?? 0) * durationSeconds;
      const end = (layer.end ?? 1) * durationSeconds;

      if (currentTime < start || currentTime > end) {
        return;
      }

      const span = Math.max(end - start, 0.0001);
      const localProgress = clamp((currentTime - start) / span, 0, 1);
      const frequencyStart = layer.from ?? layer.frequency ?? 440;
      const frequencyEnd = layer.to ?? frequencyStart;
      const frequency = frequencyStart + ((frequencyEnd - frequencyStart) * localProgress);
      const vibrato = layer.vibrato
        ? Math.sin(2 * Math.PI * layer.vibrato * (currentTime - start)) * 0.85
        : 0;
      const phase = (2 * Math.PI * frequency * (currentTime - start)) + vibrato;

      sample += oscillator(layer.wave, phase) * (layer.amplitude ?? 0.2) * envelope(localProgress);
    });

    if (noiseAmount > 0) {
      sample += pseudoNoise(sampleIndex) * noiseAmount * 0.35;
    }

    view.setInt16(44 + (sampleIndex * 2), clamp(sample * 0.9) * 0x7fff, true);
  }

  return `data:audio/wav;base64,${encodeBase64(buffer)}`;
}

export const FIRE_LOOP = renderWavDataUri({
  durationMs: 1800,
  layers: [
    { wave: 'sine', from: 82, to: 70, amplitude: 0.22 },
    { wave: 'triangle', from: 126, to: 104, amplitude: 0.18 },
    { wave: 'square', from: 36, to: 28, amplitude: 0.06 },
  ],
  noiseAmount: 0.18,
});

export const SPELL_CHIME = renderWavDataUri({
  durationMs: 920,
  layers: [
    { wave: 'triangle', from: 523.25, to: 659.25, amplitude: 0.18, start: 0, end: 0.5 },
    { wave: 'sine', from: 783.99, to: 1046.5, amplitude: 0.12, start: 0.18, end: 0.82 },
    { wave: 'square', from: 1318.51, to: 1174.66, amplitude: 0.04, start: 0.28, end: 0.75 },
  ],
  noiseAmount: 0.015,
});

export const MANDRAKE_WAIL = renderWavDataUri({
  durationMs: 1300,
  layers: [
    { wave: 'saw', from: 720, to: 360, amplitude: 0.24, vibrato: 11 },
    { wave: 'triangle', from: 460, to: 220, amplitude: 0.16, vibrato: 13 },
    { wave: 'square', from: 980, to: 540, amplitude: 0.05, start: 0.08, end: 0.74 },
  ],
  noiseAmount: 0.03,
});
