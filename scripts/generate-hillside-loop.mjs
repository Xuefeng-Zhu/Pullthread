import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';

const SAMPLE_RATE = 44_100;
const DURATION = 24;
const TAU = Math.PI * 2;

const midiFrequency = (note) => 440 * 2 ** ((note - 69) / 12);
const clamp = (value) => Math.max(-1, Math.min(1, value));

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x21f0_aaad);
    state = Math.imul(state ^ (state >>> 15), 0x735a_2d97);
    state ^= state >>> 15;
    return (state >>> 0) / 0xffff_ffff;
  };
}

function addStereo(track, index, sample, pan = 0) {
  const frame = ((index % track.frames) + track.frames) % track.frames;
  track.left[frame] += sample * Math.sqrt((1 - pan) * 0.5);
  track.right[frame] += sample * Math.sqrt((1 + pan) * 0.5);
}

function addString(track, start, note, gain, pan, decay = 3.8) {
  const delay = Math.max(2, Math.round(SAMPLE_RATE / midiFrequency(note)));
  const lifetime = Math.min(track.seconds, 4.8);
  const frames = Math.round(lifetime * SAMPLE_RATE);
  const line = new Float64Array(delay);
  const random = seededRandom(
    0x9e37_79b9 ^ Math.round(start * 1_000) ^ note * 997,
  );

  for (let index = 0; index < delay; index += 1) {
    line[index] =
      (random() * 2 - 1) * 0.75 +
      Math.sin(Math.PI * index / delay) * 0.25;
  }

  let cursor = 0;
  let lowPass = 0;
  const startFrame = Math.round(start * SAMPLE_RATE);

  for (let index = 0; index < frames; index += 1) {
    const current = line[cursor];
    const next = line[(cursor + 1) % delay];
    line[cursor] = (current * 0.47 + next * 0.53) * 0.9965;
    cursor = (cursor + 1) % delay;
    lowPass += 0.24 * (current - lowPass);

    const age = index / SAMPLE_RATE;
    const attack = Math.min(1, age / 0.012);
    const release = Math.min(1, (lifetime - age) / 0.2);
    const body = lowPass * 0.8 + current * 0.2;
    addStereo(
      track,
      startFrame + index,
      body * gain * attack * release * Math.exp(-age / decay),
      pan,
    );
  }
}

function addSoftTone(track, start, lifetime, note, gain) {
  const startFrame = Math.round(start * SAMPLE_RATE);
  const frames = Math.round(lifetime * SAMPLE_RATE);
  const frequency = midiFrequency(note);

  for (let index = 0; index < frames; index += 1) {
    const age = index / SAMPLE_RATE;
    const envelope =
      Math.min(1, age / 0.55) *
      Math.min(1, (lifetime - age) / 1.1);
    const drift = 1 + Math.sin(TAU * 0.07 * age + note) * 0.0017;
    const value =
      (Math.sin(TAU * frequency * drift * age) +
        0.05 * Math.sin(TAU * frequency * 2.003 * age + 0.4)) *
      envelope *
      gain;
    addStereo(track, startFrame + index, value);
  }
}

function addWoodTap(track, start, gain, pan, seed) {
  const random = seededRandom(seed);
  const startFrame = Math.round(start * SAMPLE_RATE);
  let filtered = 0;

  for (let index = 0; index < SAMPLE_RATE * 0.18; index += 1) {
    const age = index / SAMPLE_RATE;
    filtered += 0.3 * (random() * 2 - 1 - filtered);
    const value =
      (Math.sin(TAU * 170 * age) * 0.75 + filtered * 0.25) *
      Math.exp(-31 * age) *
      gain;
    addStereo(track, startFrame + index, value, pan);
  }
}

function addCloth(track, start, lifetime, gain, pan, seed) {
  const random = seededRandom(seed);
  const startFrame = Math.round(start * SAMPLE_RATE);
  const frames = Math.round(lifetime * SAMPLE_RATE);
  let lowPass = 0;
  let slowPass = 0;

  for (let index = 0; index < frames; index += 1) {
    const age = index / SAMPLE_RATE;
    lowPass += 0.11 * (random() * 2 - 1 - lowPass);
    slowPass += 0.015 * (lowPass - slowPass);
    const envelope = Math.sin(Math.PI * age / lifetime) ** 1.5;
    addStereo(
      track,
      startFrame + index,
      (lowPass - slowPass) * envelope * gain,
      pan,
    );
  }
}

function addCircularReverb(track) {
  const dryLeft = track.left.slice();
  const dryRight = track.right.slice();
  const taps = [
    [0.071, 0.45],
    [0.113, 0.33],
    [0.173, 0.24],
    [0.257, 0.16],
  ];

  for (let index = 0; index < track.frames; index += 1) {
    for (const [seconds, gain] of taps) {
      const offset = Math.round(seconds * SAMPLE_RATE);
      const delayed = (index - offset + track.frames) % track.frames;
      track.left[index] += dryRight[delayed] * gain * 0.15;
      track.right[index] += dryLeft[delayed] * gain * 0.15;
    }
  }
}

function renderHillsideThreads() {
  const frames = SAMPLE_RATE * DURATION;
  const track = {
    seconds: DURATION,
    frames,
    left: new Float64Array(frames),
    right: new Float64Array(frames),
  };
  const beat = 0.75;
  const chords = [
    [55, 59, 62, 67],
    [52, 55, 59, 64],
    [48, 52, 55, 60],
    [50, 54, 57, 62],
    [55, 59, 62, 67],
    [52, 55, 59, 64],
    [48, 52, 55, 60],
    [50, 54, 57, 62],
  ];
  const pattern = [0, 2, 1, 3, 2, 1, 3, 2];

  chords.forEach((chord, bar) => {
    const barStart = bar * beat * 4;
    pattern.forEach((voice, step) => {
      addString(
        track,
        barStart + step * beat * 0.5,
        chord[voice] + (step >= 4 ? 12 : 0),
        step % 4 === 0 ? 0.3 : 0.2,
        step % 2 ? 0.26 : -0.26,
      );
    });
    addSoftTone(track, barStart, beat * 3.8, chord[0] - 12, 0.055);
    if (bar === 2 || bar === 6) {
      addString(track, barStart + beat * 2.5, chord[3] + 12, 0.15, 0.38, 4.5);
    }
    if (bar % 2 === 1) {
      addWoodTap(track, barStart + beat * 3, 0.1, 0.18, 300 + bar);
    }
  });

  addCloth(track, 5.2, 1.6, 0.022, -0.5, 701);
  addCloth(track, 17.2, 1.8, 0.02, 0.5, 702);
  addCircularReverb(track);
  return track;
}

export function writeHillsideLoop(outputPath) {
  const track = renderHillsideThreads();
  let peak = 0;
  for (let index = 0; index < track.frames; index += 1) {
    peak = Math.max(peak, Math.abs(track.left[index]), Math.abs(track.right[index]));
  }
  const scale = peak > 0 ? 0.18 / peak : 1;
  const dataLength = track.frames * 4;
  const wav = Buffer.alloc(44 + dataLength);

  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < track.frames; index += 1) {
    wav.writeInt16LE(
      Math.round(clamp(track.left[index] * scale) * 32_767),
      44 + index * 4,
    );
    wav.writeInt16LE(
      Math.round(clamp(track.right[index] * scale) * 32_767),
      46 + index * 4,
    );
  }

  writeFileSync(outputPath, wav);
}
