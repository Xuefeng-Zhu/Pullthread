import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 22_050;
const MUSIC_SAMPLE_RATE = 44_100;
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

const MUSIC_DURATION = 20;
const BEAT_DURATION = 60 / 96;

const frequencyFromMidi = (note) => 440 * 2 ** ((note - 69) / 12);

const circularAge = (time, start, lifetime) => {
  let age = time - start;
  if (age < 0) age += MUSIC_DURATION;
  return age < lifetime ? age : null;
};

const pluck = (age, frequency, lifetime) => {
  const attack = Math.min(1, age / 0.006);
  const release = Math.min(1, (lifetime - age) / 0.055);
  const decay = Math.exp(-4.4 * age);
  const shimmer = 0.2 * Math.sin(TAU * 4.2 * age);
  return (
    (Math.sin(TAU * frequency * age) +
      0.38 * Math.sin(TAU * frequency * 2 * age + 0.16) +
      0.13 * Math.sin(TAU * frequency * 3 * age + 0.41)) *
    attack *
    release *
    decay *
    (1 + shimmer)
  );
};

const bass = (age, frequency, lifetime) => {
  const attack = Math.min(1, age / 0.018);
  const release = Math.min(1, (lifetime - age) / 0.12);
  return (
    (Math.sin(TAU * frequency * age) +
      0.18 * Math.sin(TAU * frequency * 2 * age)) *
    attack *
    release *
    Math.exp(-2.1 * age)
  );
};

const indexedNoise = (index, seed) => {
  let value = (index + seed) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0_aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a_2d97);
  value ^= value >>> 15;
  return (value / 0xffff_ffff) * 2 - 1;
};

const chords = [
  [55, 59, 62],
  [60, 64, 67],
  [52, 55, 59],
  [50, 54, 57],
  [55, 59, 62],
  [60, 64, 67],
  [52, 55, 59],
  [50, 54, 57],
];
const melodySteps = [74, 71, 69, 67, 71, 74, 76, 74];

const pluckEvents = [];
const bassEvents = [];
const woodEvents = [];
const brushEvents = [];

for (let bar = 0; bar < chords.length; bar += 1) {
  const barStart = bar * 4 * BEAT_DURATION;
  const chord = chords[bar];

  for (let step = 0; step < 8; step += 1) {
    const start = barStart + step * BEAT_DURATION * 0.5;
    const chordNote = chord[step % chord.length] + (step >= 4 ? 12 : 0);
    pluckEvents.push({
      start,
      frequency: frequencyFromMidi(chordNote),
      lifetime: 0.48,
      pan: step % 2 === 0 ? -0.28 : 0.28,
      gain: 0.48,
    });
    brushEvents.push({ start, lifetime: 0.13, pan: step % 2 ? -0.5 : 0.5 });
  }

  for (const beat of [0, 2]) {
    bassEvents.push({
      start: barStart + beat * BEAT_DURATION,
      frequency: frequencyFromMidi(chord[0] - 12),
      lifetime: 1.05,
    });
  }

  for (const beat of [1, 3]) {
    woodEvents.push({
      start: barStart + beat * BEAT_DURATION,
      lifetime: 0.12,
      pan: beat === 1 ? -0.18 : 0.18,
    });
  }

  for (const beat of [1.5, 3.5]) {
    pluckEvents.push({
      start: barStart + beat * BEAT_DURATION,
      frequency: frequencyFromMidi(melodySteps[bar]),
      lifetime: 0.52,
      pan: bar % 2 === 0 ? 0.38 : -0.38,
      gain: 0.38,
    });
  }
}

const makeMusicSample = (time, sampleIndex) => {
  let left = 0;
  let right = 0;

  const add = (value, pan = 0) => {
    left += value * Math.sqrt((1 - pan) * 0.5);
    right += value * Math.sqrt((1 + pan) * 0.5);
  };

  for (const event of pluckEvents) {
    const age = circularAge(time, event.start, event.lifetime);
    if (age !== null) {
      add(pluck(age, event.frequency, event.lifetime) * event.gain, event.pan);
    }
  }

  for (const event of bassEvents) {
    const age = circularAge(time, event.start, event.lifetime);
    if (age !== null) {
      add(bass(age, event.frequency, event.lifetime) * 0.3);
    }
  }

  for (const event of woodEvents) {
    const age = circularAge(time, event.start, event.lifetime);
    if (age !== null) {
      const envelope = Math.exp(-34 * age) * Math.min(1, age / 0.0025);
      const knock = Math.sin(TAU * 185 * age) * Math.exp(-22 * age);
      const grain = indexedNoise(sampleIndex, 0x574f_4f44) * 0.35;
      add((knock + grain) * envelope * 0.24, event.pan);
    }
  }

  for (const event of brushEvents) {
    const age = circularAge(time, event.start, event.lifetime);
    if (age !== null) {
      const envelope =
        Math.min(1, age / 0.008) *
        Math.min(1, (event.lifetime - age) / 0.035);
      add(indexedNoise(sampleIndex, 0x4252_5348) * envelope * 0.025, event.pan);
    }
  }

  return [left, right];
};

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

const writeMusicWav = () => {
  const sampleCount = Math.round(MUSIC_SAMPLE_RATE * MUSIC_DURATION);
  const samples = new Float32Array(sampleCount * 2);
  let peak = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const [left, right] = makeMusicSample(index / MUSIC_SAMPLE_RATE, index);
    samples[index * 2] = left;
    samples[index * 2 + 1] = right;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
  }

  const scale = peak > 0 ? 0.22 / peak : 1;
  const dataLength = sampleCount * 4;
  const wav = Buffer.alloc(44 + dataLength);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(MUSIC_SAMPLE_RATE, 24);
  wav.writeUInt32LE(MUSIC_SAMPLE_RATE * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < samples.length; index += 1) {
    wav.writeInt16LE(
      Math.round(clamp(samples[index] * scale) * 32_767),
      44 + index * 2,
    );
  }

  writeFileSync(join(outputDirectory, 'playful-climb-loop.wav'), wav);
};

mkdirSync(outputDirectory, { recursive: true });
sounds.forEach(writeWav);
writeMusicWav();

stdout.write(
  `Generated ${sounds.length} feedback sounds and 1 music loop in ${outputDirectory}\n`,
);
