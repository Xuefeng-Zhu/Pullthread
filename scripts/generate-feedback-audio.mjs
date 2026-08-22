import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22_050;
const TAU = Math.PI * 2;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(scriptDirectory, '..', 'assets', 'audio');

const clamp = (value, minimum = -1, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const fade = (time, duration, attack = 0.01, release = 0.04) =>
  Math.min(1, time / attack, (duration - time) / release);

const seededNoise = (seed) => {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return (state / 0xffff_ffff) * 2 - 1;
  };
};

const makeRustle = () => {
  const noise = seededNoise(0x504c_5448);
  let lowPass = 0;

  return (time, duration) => {
    lowPass += 0.18 * (noise() - lowPass);
    const movement = 0.35 + 0.65 * Math.sin(Math.PI * time / duration) ** 2;
    return lowPass * movement * fade(time, duration, 0.025, 0.06);
  };
};

const makeThreadDraw = () => {
  const noise = seededNoise(0x5448_5244);
  let filtered = 0;

  return (time, duration) => {
    filtered += 0.32 * (noise() - filtered);
    const fiber = Math.sin(TAU * (740 + 130 * time) * time) * 0.22;
    return (filtered * 0.38 + fiber) * fade(time, duration, 0.015, 0.05);
  };
};

const makeRolling = () => {
  const noise = seededNoise(0x4254_544e);
  let filtered = 0;

  return (time, duration) => {
    filtered += 0.12 * (noise() - filtered);
    const bumps = 0.28 + 0.72 * Math.max(0, Math.sin(TAU * 13 * time)) ** 3;
    return filtered * bumps * fade(time, duration, 0.02, 0.08);
  };
};

const sounds = [
  {
    fileName: 'cloth-rustle.wav',
    duration: 0.2,
    gain: 0.34,
    sample: makeRustle(),
  },
  {
    fileName: 'thread-draw.wav',
    duration: 0.24,
    gain: 0.28,
    sample: makeThreadDraw(),
  },
  {
    fileName: 'stitch-pluck.wav',
    duration: 0.19,
    gain: 0.48,
    sample: (time, duration) => {
      const decay = Math.exp(-19 * time);
      const fundamental = Math.sin(TAU * 315 * time);
      const harmonic = Math.sin(TAU * 630 * time + 0.35) * 0.34;
      return (fundamental + harmonic) * decay * fade(time, duration, 0.004, 0.035);
    },
  },
  {
    fileName: 'traveler-roll.wav',
    duration: 0.32,
    gain: 0.23,
    sample: makeRolling(),
  },
  {
    fileName: 'button-click.wav',
    duration: 0.09,
    gain: 0.42,
    sample: (time, duration) => {
      const body = Math.sin(TAU * 185 * time) * Math.exp(-42 * time);
      const tick = Math.sin(TAU * 1_240 * time) * Math.exp(-95 * time) * 0.45;
      return (body + tick) * fade(time, duration, 0.002, 0.018);
    },
  },
  {
    fileName: 'success.wav',
    duration: 0.42,
    gain: 0.36,
    sample: (time, duration) => {
      const notes = [392, 493.88, 587.33];
      const starts = [0, 0.1, 0.2];
      let value = 0;

      for (let index = 0; index < notes.length; index += 1) {
        const localTime = time - starts[index];
        if (localTime >= 0) {
          value +=
            Math.sin(TAU * notes[index] * localTime) *
            Math.exp(-7.5 * localTime) *
            Math.min(1, localTime / 0.008);
        }
      }

      return value * fade(time, duration, 0.005, 0.07) * 0.58;
    },
  },
  {
    fileName: 'failure.wav',
    duration: 0.34,
    gain: 0.34,
    sample: (time, duration) => {
      const sweepPhase = TAU * (235 * time - (68 * time * time) / duration);
      const wobble = 1 + 0.12 * Math.sin(TAU * 8 * time);
      return (
        Math.sin(sweepPhase) *
        wobble *
        Math.exp(-4.6 * time) *
        fade(time, duration, 0.012, 0.07)
      );
    },
  },
];

const writeWav = ({ fileName, duration, gain, sample }) => {
  const sampleCount = Math.round(SAMPLE_RATE * duration);
  const dataLength = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataLength);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const value = clamp(sample(time, duration) * gain);
    wav.writeInt16LE(Math.round(value * 32_767), 44 + index * 2);
  }

  writeFileSync(join(outputDirectory, fileName), wav);
};

mkdirSync(outputDirectory, { recursive: true });
sounds.forEach(writeWav);

stdout.write(
  `Generated ${sounds.length} original feedback sounds in ${outputDirectory}\n`,
);
