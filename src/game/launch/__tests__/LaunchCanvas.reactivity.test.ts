/** @jest-environment node */
import { beforeAll, describe, expect, test } from '@jest/globals';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createEndlessRun } from '../endless';
import * as simulation from '../simulation';
import * as viewport from '../viewport';
import * as toolCatalog from '../../../commerce/toolCatalog';
import type { LaunchRoom, LaunchState } from '../types';

type Value = { value: unknown; _isReanimatedSharedValue: true };
type Worklet = (() => unknown) & { __closure: Record<string, unknown> };
type Command = readonly [string, ...number[]];
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
type Mapper = { updater: Worklet; inputs: Value[]; previous: unknown[]; output: Value; runs: number };

/**
 * Compile the real component with the installed native Worklets plugin, then
 * execute its derived callbacks. Dependencies come from the generated closure,
 * just as Reanimated's extractInputs does; strict equality stops propagation.
 * This measures reactive work, not device frame time or GPU rendering speed.
 */
function compileCanvas(filename: string) {
  return transformSync(readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [
      ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
      'react-native-worklets/plugin', '@babel/plugin-transform-modules-commonjs',
    ],
  })!.code!;
}

function renderer(code: string, room: LaunchRoom, state: LaunchState, reducedMotion = false) {
  const paths: Command[][] = [];
  const mappers: Mapper[] = [];
  const shared = (value: unknown): Value => ({ value, _isReanimatedSharedValue: true });
  const motion = {
    tick: shared(state.tick), travelerX: shared(state.position.x), travelerY: shared(state.position.y),
    pullX: shared(0), pullY: shared(0), cameraY: shared(0),
    impactTick: shared(-1000), impactX: shared(0), impactY: shared(0),
  };
  const extract = (input: unknown, results: Value[] = []): Value[] => {
    if (!input || typeof input !== 'object') return results;
    if ('_isReanimatedSharedValue' in input) results.push(input as Value);
    else if (Array.isArray(input) || Object.getPrototypeOf(input) === Object.prototype) {
      Object.values(input).forEach((value) => extract(value, results));
    }
    return results;
  };
  const derive = (updater: Worklet) => {
    const inputs = extract(updater.__closure);
    const output = shared(updater());
    mappers.push({ updater, inputs, output, previous: inputs.map((input) => input.value), runs: 1 });
    return output;
  };
  const makePath = () => {
    const commands: Command[] = [];
    const builder: Record<string, (...args: number[]) => unknown> = {};
    for (const method of ['moveTo', 'lineTo', 'quadTo', 'cubicTo', 'close']) {
      builder[method] = (...args) => { commands.push([method, ...args]); return builder; };
    }
    builder.detach = () => { paths.push(commands); return { commands }; };
    return builder;
  };
  const jsx = (type: Element['type'], props: Element['props']): Element => ({ type, props });
  const imports: Record<string, unknown> = {
    react: { useMemo: (factory: () => unknown) => factory() },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native-reanimated': { useDerivedValue: derive },
    '@shopify/react-native-skia': {
      ...Object.fromEntries(['Canvas', 'Circle', 'DashPathEffect', 'Group', 'Line', 'Path', 'RoundedRect', 'Text'].map((name) => [name, name])),
      Skia: { PathBuilder: { Make: makePath } }, useFont: () => null,
      vec: (x: number, y: number) => ({ x, y }),
    },
    '../../theme/gamePalette': { getGamePalette: () => ({ frame: '#000' }) },
    '../rendering/FabricTexture': { FabricTexture: () => null },
    '../rendering/Traveler': { Traveler: () => null },
    './simulation': simulation,
    './viewport': viewport,
    '../../commerce/toolCatalog': toolCatalog,
  };
  const module = { exports: {} as { LaunchCanvas: (props: Record<string, unknown>) => Element } };
  // Test-only execution of our compiled local source; no runtime bundling.
  new Function('require', 'module', 'exports', code)(
    (name: string) => {
      if (name.startsWith('@expo-google-fonts/')) return name;
      if (!(name in imports)) throw new Error(`Unexpected canvas import: ${name}`);
      return imports[name];
    }, module, module.exports,
  );
  const elements: Element[] = [];
  const mount = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(mount); return; }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const element = value as Element;
    if (typeof element.type === 'function') mount(element.type(element.props));
    else { elements.push(element); mount(element.props.children); }
  };
  mount(module.exports.LaunchCanvas({ room, state, motion, size: { width: 390, height: 844 }, reducedMotion }));
  const flush = () => {
    // All inputs are created before their consumers in these components.
    for (const mapper of mappers) {
      const values = mapper.inputs.map((input) => input.value);
      if (values.some((value, index) => value !== mapper.previous[index])) {
        mapper.output.value = mapper.updater();
        mapper.runs += 1;
        mapper.previous = values;
      }
    }
  };
  const value = (input: unknown): unknown => input && typeof input === 'object' && '_isReanimatedSharedValue' in input
    ? (input as Value).value : input;
  return { paths, mappers, motion, flush, elements, value };
}

describe('LaunchCanvas reactive work', () => {
  let code: string;
  beforeAll(() => {
    code = compileCanvas(process.env.PULLTHREAD_CANVAS_SOURCE ?? resolve(__dirname, '../LaunchCanvas.tsx'));
  });

  test.each([false, true])('idle pockets do not rebuild paths as flight ticks advance (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, { ...run.state, phase: 'flying' }, reducedMotion);
    view.paths.length = 0;
    for (let frame = 1; frame <= 60; frame += 1) {
      view.motion.tick.value = frame * 2;
      view.motion.travelerX.value = 80 + frame;
      view.motion.travelerY.value = 490 - frame;
      view.flush();
    }
    expect(view.paths).toHaveLength(0);
  });

  test('aim paths do not rebuild for unrelated clock or camera updates', () => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, run.state);
    view.motion.pullX.value = -20;
    view.motion.pullY.value = 70;
    view.flush();
    view.paths.length = 0;
    view.motion.tick.value = 120;
    view.motion.cameraY.value = -100;
    view.flush();
    expect(view.paths).toHaveLength(0);
  });

  test('only the occupied cup and hem deform; launch snap settles at its existing lifetime', () => {
    const run = createEndlessRun(14);
    const held = renderer(code, run.room, run.state);
    held.paths.length = 0;
    held.motion.pullX.value = -20;
    held.motion.pullY.value = 70;
    held.flush();
    const cup = held.paths.find((path) => path.some(([method]) => method === 'quadTo'))!;
    expect(cup.find(([method]) => method === 'cubicTo')?.slice(-2)).toEqual([-20, 105]);
    expect(held.paths.filter((path) => path.some(([method]) => method === 'cubicTo'))).toHaveLength(2);

    const flying = renderer(code, run.room, {
      ...run.state, phase: 'flying', event: { type: 'launch', id: run.state.pocketId, tick: 0 },
    });
    flying.paths.length = 0;
    flying.motion.tick.value = 15;
    flying.flush();
    expect(flying.paths).toHaveLength(2);
    const snapCup = flying.paths.find((path) => path.some(([method]) => method === 'quadTo'))!;
    expect(snapCup.find(([method]) => method === 'cubicTo')?.at(-1)).toBeCloseTo(35 + Math.sin(15 * 0.37) * Math.exp(-1) * 10);
    flying.motion.tick.value = 55;
    flying.flush();
    flying.paths.length = 0;
    flying.motion.tick.value = 56;
    flying.flush();
    expect(flying.paths).toHaveLength(0);
  });

  test('moving receivers and bumper compression keep their original coordinates and timing', () => {
    const run = createEndlessRun(14);
    const room = { ...run.room,
      pockets: [{ ...run.room.pockets[0], motion: { amplitude: 60, periodTicks: 480, phaseTicks: 0 } }],
      bumpers: [{ id: 'cushion', center: { x: 180, y: 250 }, radius: 25, restitution: 1 }],
    };
    const view = renderer(code, room, { ...run.state, phase: 'flying' });
    view.motion.tick.value = 120;
    view.motion.impactTick.value = 110;
    view.motion.impactX.value = 180;
    view.motion.impactY.value = 250;
    view.flush();
    const transforms = view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.transform));
    expect(transforms).toContainEqual([{ translateX: 140 }, { translateY: 490 }]);
    const compression = Math.sin(10 * 0.36) * Math.exp(-1) * 0.16;
    expect(transforms).toContainEqual([
      { translateX: 180 }, { translateY: 250 }, { scaleX: 1 + compression }, { scaleY: 1 - compression },
    ]);
  });

  test.each([false, true])('invisible impact radius stops changing (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, { ...run.state, phase: 'flying' }, reducedMotion);
    const ring = view.elements.find((element) => element.type === 'Circle' && element.props.cx === view.motion.impactX)!;
    view.motion.impactTick.value = 0;
    view.motion.tick.value = 32;
    view.flush();
    const settledRadius = view.value(ring.props.r);
    expect(settledRadius).toBe(reducedMotion ? 12 : 39.2);
    view.motion.tick.value = 10_000;
    view.flush();
    expect(view.value(ring.props.r)).toBe(settledRadius);
  });
});
