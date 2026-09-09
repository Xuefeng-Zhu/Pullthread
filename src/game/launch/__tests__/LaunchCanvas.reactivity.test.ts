/** @jest-environment node */
import { beforeAll, describe, expect, test } from '@jest/globals';
import { transformSync } from '@babel/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createEndlessRun } from '../endless';
import * as simulation from '../simulation';
import * as viewport from '../viewport';
import * as progression from '../progression';
import * as toolEffects from '../toolEffects';
import * as toolCatalog from '../../../commerce/toolCatalog';
import type { LaunchRoom, LaunchState } from '../types';

type Value = { value: unknown; _isReanimatedSharedValue: true };
type Worklet = (() => unknown) & { __closure: Record<string, unknown> };
type Command = readonly [string, ...number[]];
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown> };
type Mapper = { updater: Worklet; inputs: Value[]; previous: unknown[]; output: Value; runs: number };
const compiledSources = new Map<string, string>();

/**
 * Compile the real component with the installed native Worklets plugin, then
 * execute its derived callbacks. Dependencies come from the generated closure,
 * just as Reanimated's extractInputs does; strict equality stops propagation.
 * This measures reactive work, not device frame time or GPU rendering speed.
 */
function compileCanvas(filename: string) {
  const cached = compiledSources.get(filename);
  if (cached) return cached;
  const result = transformSync(readFileSync(filename, 'utf8'), {
    filename, configFile: false, babelrc: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [
      ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }],
      'react-native-worklets/plugin', '@babel/plugin-transform-modules-commonjs',
    ],
  })!.code!;
  compiledSources.set(filename, result);
  return result;
}

function renderer(code: string, room: LaunchRoom, state: LaunchState, reducedMotion = false,
  options: { fonts?: boolean; highContrast?: boolean; size?: { width: number; height: number }; worldStage?: number; worldTransitionTick?: number } = {}) {
  const paths: Command[][] = [];
  const mappers: Mapper[] = [];
  const shared = (value: unknown): Value => ({ value, _isReanimatedSharedValue: true });
  const motion = {
    tick: shared(state.tick), velocityY: shared(state.velocity.y), travelerX: shared(state.position.x), travelerY: shared(state.position.y),
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
    react: { useMemo: (factory: () => unknown) => factory(), memo: (component: unknown) => component },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native-reanimated': { useDerivedValue: derive },
    '@shopify/react-native-skia': {
      ...Object.fromEntries(['Canvas', 'Circle', 'DashPathEffect', 'Group', 'Line', 'Path', 'Rect', 'RoundedRect', 'Text'].map((name) => [name, name])),
      Skia: { PathBuilder: { Make: makePath } }, useFont: () => options.fonts
        ? { getGlyphIDs: (text: string) => [...text], getGlyphWidths: (glyphs: string[]) => glyphs.map(() => 5) } : null,
      vec: (x: number, y: number) => ({ x, y }),
    },
    '../../theme/gamePalette': { getGamePalette: () => ({ frame: '#000' }) },
    '../rendering/FabricTexture': { FabricTexture: (props: Element['props']) => jsx('FabricTexture', props) },
    '../rendering/Traveler': { Traveler: () => null },
    './simulation': simulation,
    './tools': { effectivePockets: toolEffects.effectivePockets },
    './toolEffects': toolEffects,
    './viewport': viewport,
    './progression': progression,
    '../../commerce/toolCatalog': toolCatalog,
  };
  const evaluate = (source: string) => {
    const module = { exports: {} as Record<string, (props: Record<string, unknown>) => Element> };
    // Test-only execution of our compiled local source; no runtime bundling.
    new Function('require', 'module', 'exports', source)(
      (name: string) => {
        if (name.startsWith('@expo-google-fonts/')) return name;
        if (!(name in imports)) throw new Error(`Unexpected canvas import: ${name}`);
        return imports[name];
      }, module, module.exports,
    );
    return module.exports;
  };
  imports['./WorldBackdrop'] = evaluate(compileCanvas(resolve(__dirname, '../WorldBackdrop.tsx')));
  imports['./InteractiveVisuals'] = evaluate(compileCanvas(resolve(__dirname, '../InteractiveVisuals.tsx')));
  imports['./LaunchToolVisuals'] = evaluate(compileCanvas(resolve(__dirname, '../LaunchToolVisuals.tsx')));
  const components = evaluate(code);
  const elements: Element[] = [];
  const mount = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(mount); return; }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const element = value as Element;
    if (typeof element.type === 'function') mount(element.type(element.props));
    else { elements.push(element); mount(element.props.children); }
  };
  mount(components.LaunchCanvas({ room, state, motion, size: options.size ?? { width: 390, height: 844 }, reducedMotion,
    highContrast: options.highContrast, worldStage: options.worldStage, worldTransitionTick: options.worldTransitionTick }));
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

  test.each([false, true])('fraying countdown and spent fabric track shared ticks without rebuilding paths (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const pocket = { ...run.room.pockets[0], frayTicks: 480, route: 'reward' as const };
    const state = { ...run.state, pocketExpiryTicks: { [pocket.id]: 480 } };
    const view = renderer(code, { ...run.room, pockets: [pocket], pickups: [] }, state, reducedMotion, { fonts: true });
    const number = view.elements.find((element) => element.type === 'Text' && element.props.x === -4.5)!;
    const ring = view.elements.find((element) => element.type === 'Path' && 'end' in element.props)!;
    expect(view.value(number.props.text)).toBe('4');
    expect(view.value(ring.props.end)).toBe(1);
    view.paths.length = 0;
    view.motion.tick.value = 240;
    view.flush();
    expect(view.value(number.props.text)).toBe('2');
    expect(view.value(ring.props.end)).toBe(0.5);
    view.motion.tick.value = 480;
    view.flush();
    expect(view.value(number.props.text)).toBe('0');
    expect(view.value(ring.props.end)).toBe(0);
    expect(view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.opacity))).toContain(0.17);
    expect(view.paths).toHaveLength(0);
  });

  test('route pockets keep stitched and star emblems without target pennants', () => {
    const run = createEndlessRun(14);
    const pockets = [
      { ...run.room.pockets[0], id: 'wide', kind: 'checkpoint' as const, route: 'safe' as const, width: 100 },
      { ...run.room.pockets[0], id: 'reward', kind: 'checkpoint' as const, route: 'reward' as const, width: 62 },
    ];
    const view = renderer(code, { ...run.room, pockets, pickups: [] }, { ...run.state, phase: 'flying' });
    expect(view.elements.filter((element) => element.type === 'Line'
      && (element.props.p1 as { y?: number })?.y === -26)).toHaveLength(0);
    expect(view.elements.some((element) => element.type === 'Path' && element.props.path === 'M -8 -4 l 4 4 l 5 -6 M 0 4 l 4 4 l 5 -6')).toBe(true);
    expect(view.paths.some((commands) => commands.filter(([method]) => method === 'lineTo').length === 9)).toBe(true);
  });

  test.each(['x', 'y'] as const)('moving gate follows the simulation on its %s axis with a visible full-range track', (axis) => {
    const run = createEndlessRun(14);
    const hazard = { id: 'gate', radius: 20, center: { x: 180, y: 220 },
      motion: { axis, amplitude: 50, periodTicks: 480, phaseTicks: 0 } };
    const view = renderer(code, { ...run.room, hazards: [hazard] }, { ...run.state, phase: 'flying' }, true);
    view.motion.tick.value = 120;
    view.flush();
    const position = simulation.hazardPosition(hazard, 120);
    expect(view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.transform)))
      .toContainEqual([{ translateX: position.x }, { translateY: position.y }]);
    expect(view.elements.some((element) => element.type === 'Line'
      && JSON.stringify(element.props.p1) === JSON.stringify({ x: axis === 'x' ? 130 : 180, y: axis === 'y' ? 170 : 220 })
      && JSON.stringify(element.props.p2) === JSON.stringify({ x: axis === 'x' ? 230 : 180, y: axis === 'y' ? 270 : 220 }))).toBe(true);
  });

  test.each([false, true])('padded side rails match both world bounds and stay still as the world scrolls (high contrast: %s)', (highContrast) => {
    const run = createEndlessRun(14);
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1022, height: 1280 }]) {
      const room = { ...run.room, sideWallRestitution: 0.8 };
      const view = renderer(code, room, { ...run.state, phase: 'flying' }, true, { size, highContrast });
      const projection = viewport.getLaunchViewport(size, room.bounds);
      const rails = view.elements.filter((element) => element.type === 'RoundedRect'
        && element.props.color === (highContrast ? '#C9D9BA' : '#ABC0A8'));
      expect(rails).toHaveLength(2);
      expect(rails.map((element) => element.props.x)).toEqual([
        projection.offsetX - 7 * projection.scale,
        projection.offsetX + room.bounds.width * projection.scale - 7 * projection.scale,
      ]);
      expect(rails.every((element) => element.props.height === size.height + 14 * projection.scale)).toBe(true);
      view.paths.length = 0;
      view.motion.tick.value = 300;
      view.motion.cameraY.value = -1000;
      view.flush();
      expect(view.paths).toHaveLength(0);
    }
  });

  test('legacy rooms without bouncing walls keep their open-edge seam', () => {
    const run = createEndlessRun(14);
    const view = renderer(code, { ...run.room, sideWallRestitution: undefined }, run.state);
    expect(view.elements.filter((element) => element.type === 'RoundedRect' && element.props.color === '#ABC0A8')).toHaveLength(0);
  });

  test.each([false, true])('all five fabrics repeat after 100 catches and restore without fading (high contrast: %s)', (highContrast) => {
    const run = createEndlessRun(14);
    const colors: unknown[] = [];
    for (let stage = 0; stage < 10; stage += 1) {
      const view = renderer(code, run.room, run.state, false, { highContrast, worldStage: stage, size: { width: 320, height: 568 } });
      const fabrics = view.elements.filter((element) => element.type === 'FabricTexture');
      expect(fabrics).toHaveLength(1);
      expect(fabrics[0].props).toMatchObject({ width: 320, height: 568, highContrast });
      colors.push(fabrics[0].props.baseColor);
      if (!highContrast) expect(fabrics[0].props.baseColor).toBe(progression.WORLD_STAGES[stage % 5].base);
      view.paths.length = 0;
      view.motion.tick.value = 240;
      view.flush();
      expect(view.paths).toHaveLength(0);
    }
    expect(new Set(colors)).toHaveProperty('size', 5);
    expect(colors.slice(0, 5)).toEqual(colors.slice(5));
  });

  test.each([1, 2, 3, 4, 5])('world %s crossfades in 96 active ticks without rebuilding scenery', (worldStage) => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, { ...run.state, tick: 100 }, false, { worldStage, worldTransitionTick: 100 });
    const layer = view.elements.find((element) => element.type === 'Group'
      && (element.props.children as Element)?.props?.stage === worldStage % 5)!;
    expect(view.elements.filter((element) => element.type === 'FabricTexture')).toHaveLength(2);
    expect(view.value(layer.props.opacity)).toBe(0);
    view.paths.length = 0;
    view.motion.tick.value = 148;
    view.flush();
    expect(view.value(layer.props.opacity)).toBe(0.5);
    view.flush();
    expect(view.value(layer.props.opacity)).toBe(0.5);
    view.motion.tick.value = 196;
    view.flush();
    expect(view.value(layer.props.opacity)).toBe(1);
    view.motion.tick.value = 10_000;
    view.flush();
    expect(view.value(layer.props.opacity)).toBe(1);
    expect(view.paths).toHaveLength(0);
  });

  test.each([30, 60, 120])('the background reaches its new fabric after 0.8 seconds at %s FPS', (fps) => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, run.state, false, { worldStage: 1, worldTransitionTick: 0 });
    const layer = view.elements.find((element) => element.type === 'Group'
      && (element.props.children as Element)?.props?.stage === 1)!;
    for (let frame = 1; frame <= fps * 0.8; frame += 1) {
      view.motion.tick.value = frame * 120 / fps;
      view.flush();
      expect(view.value(layer.props.opacity)).toBeCloseTo(frame / (fps * 0.8), 10);
    }
    expect(view.value(layer.props.opacity)).toBe(1);
  });

  test('reduced motion changes worlds immediately while preserving the actual scissors movement', () => {
    const run = createEndlessRun(14);
    const hazard = { id: 'scissors', center: { x: 180, y: 220 }, radius: 18, visual: 'scissors' as const,
      motion: { axis: 'x' as const, amplitude: 34, periodTicks: 600, phaseTicks: 0 } };
    const view = renderer(code, { ...run.room, hazards: [hazard] }, run.state, true, { worldStage: 4, worldTransitionTick: 0 });
    expect(view.elements.filter((element) => element.type === 'FabricTexture')).toHaveLength(1);
    expect(view.elements.some((element) => element.type === 'Circle' && element.props.r === 18 && element.props.color === '#994456')).toBe(true);
    const blades = view.elements.filter((element) => element.type === 'Group'
      && JSON.stringify(view.value(element.props.transform)) === JSON.stringify([{ rotate: 0 }]));
    expect(blades).toHaveLength(1);
    view.paths.length = 0;
    view.motion.tick.value = 150;
    view.flush();
    expect(view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.transform)))
      .toContainEqual([{ translateX: 214 }, { translateY: 220 }]);
    expect(view.value(blades[0].props.transform)).toEqual([{ rotate: 0 }]);
    expect(view.paths).toHaveLength(0);
  });

  test.each([-100, 100])('short aim guide agrees with real 120Hz flight across a wind boundary (%s)', (accelerationX) => {
    const run = createEndlessRun(14);
    const room: LaunchRoom = { ...run.room, bounds: { width: 1000, height: 1000 },
      pockets: [{ ...run.room.pockets[0], center: { x: 500, y: 600 } }], bumpers: [], hazards: [], pickups: [],
      windZones: [{ id: 'ribbon', x: 480, y: 500, width: 100, height: 150, accelerationX }],
    };
    const state = simulation.createLaunchState(room);
    const view = renderer(code, room, state);
    const flight = simulation.createLaunchState(room);
    const pull = { x: -20, y: 70 };
    expect(simulation.launch(room, flight, { tick: 0, pocketId: flight.pocketId, pull })).toBe(true);
    view.motion.travelerX.value = flight.position.x;
    view.motion.travelerY.value = flight.position.y;
    view.motion.pullX.value = pull.x;
    view.motion.pullY.value = pull.y;
    view.paths.length = 0;
    view.flush();
    const guide = view.paths.find((commands) => commands.filter(([command]) => command === 'lineTo').length === 17)!;
    expect(guide).toBeDefined();
    for (let tick = 1; tick <= 34; tick += 1) {
      simulation.stepLaunch(room, flight);
      if (tick % 2 === 0) {
        expect(guide[tick / 2][1]).toBeCloseTo(flight.position.x, 9);
        expect(guide[tick / 2][2]).toBeCloseTo(flight.position.y, 9);
      }
    }
    expect(view.elements.some((element) => element.type === 'RoundedRect' && element.props.width === 100 && element.props.height === 150)).toBe(true);
    expect(view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.transform)))
      .toContainEqual([{ translateX: accelerationX < 0 ? 100 : 0 }, { scaleX: accelerationX < 0 ? -1 : 1 }]);
  });

  test.each([false, true])('an occupied orbit keeps its opening upright while carrying a pull (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const pocket = { ...run.room.pockets[0], center: { x: 180, y: 300 },
      orbit: { radius: 42, periodTicks: 480, phaseTicks: 0, direction: 1 as const } };
    const room = { ...run.room, pockets: [pocket], windZones: [], bumpers: [], hazards: [], barriers: [], switches: [] };
    const state = simulation.createLaunchState(room);
    const view = renderer(code, room, state, reducedMotion);
    expect(view.elements.some((element) => element.type === 'Circle'
      && element.props.cx === 180 && element.props.cy === 300 && element.props.r === 42)).toBe(true);
    view.motion.pullX.value = -10;
    view.motion.pullY.value = 60;
    for (const tick of [120, 240, 360, 480]) {
      view.motion.tick.value = tick;
      view.flush();
      const position = simulation.pocketPosition(pocket, tick);
      expect(view.elements.filter((element) => element.type === 'Group').map((element) => view.value(element.props.transform)))
        .toContainEqual([{ translateX: position.x }, { translateY: position.y }]);
    }
    const cup = view.paths.findLast((path) => path.some(([method]) => method === 'quadTo'))!;
    expect(cup.find(([method]) => method === 'cubicTo')?.slice(-2)).toEqual([-10, 95]);
  });

  test.each([0, 120, 240, 360])('the orbit aim guide inherits actual release momentum at tick %s', (tick) => {
    const run = createEndlessRun(14);
    const pocket = { ...run.room.pockets[0], center: { x: 500, y: 600 }, orbit: { radius: 42, periodTicks: 480, phaseTicks: 0 } };
    const room: LaunchRoom = { ...run.room, bounds: { width: 1000, height: 1000 },
      pockets: [pocket], bumpers: [], hazards: [], pickups: [], barriers: [], switches: [], windZones: [] };
    const source = { ...simulation.createLaunchState(room), tick, position: simulation.pocketPosition(pocket, tick) };
    const view = renderer(code, room, source);
    const flight = { ...source, position: { ...source.position }, previousPosition: { ...source.position }, velocity: { x: 0, y: 0 } };
    const pull = { x: -20, y: 70 };
    expect(simulation.launch(room, flight, { tick, pocketId: flight.pocketId, pull })).toBe(true);
    view.motion.travelerX.value = flight.position.x;
    view.motion.travelerY.value = flight.position.y;
    view.motion.pullX.value = pull.x;
    view.motion.pullY.value = pull.y;
    view.paths.length = 0;
    view.flush();
    const guide = view.paths.find((commands) => commands.filter(([command]) => command === 'lineTo').length === 14)!;
    for (let step = 1; step <= 24; step += 1) {
      simulation.stepLaunch(room, flight);
      if (step % 12 === 0) {
        expect(guide[step / 12 * 5][1]).toBeCloseTo(flight.position.x, 9);
        expect(guide[step / 12 * 5][2]).toBeCloseTo(flight.position.y, 9);
      }
    }
  });

  test.each([false, true])('solid faces match collision rectangles and restored openings remain passable (high contrast: %s)', (highContrast) => {
    const run = createEndlessRun(14);
    const barriers: NonNullable<LaunchRoom['barriers']> = [
      { id: 'cloth', kind: 'tearable', x: 100, y: 100, width: 160, height: 24 },
      { id: 'door-a', kind: 'door', x: 110, y: 220, width: 120, height: 24 },
      { id: 'door-b', kind: 'door', x: 120, y: 340, width: 110, height: 24 },
      { id: 'solid', kind: 'solid', x: 30, y: 150, width: 100, height: 24 },
      { id: 'thorns', kind: 'thorns', x: 130, y: 190, width: 90, height: 24 },
    ];
    const room = { ...run.room, barriers, switches: [{ id: 'button-a', center: { x: 75, y: 300 }, radius: 14, doorIds: ['door-a'] }] };
    const opacity = (view: ReturnType<typeof renderer>, width: number) => {
      const layer = view.elements.find((element) => element.type === 'Group' && Array.isArray(element.props.children)
        && (element.props.children as Element[]).some((child) => child?.type === 'Rect' && child.props.width === width && child.props.x === 0));
      return view.value(layer!.props.opacity);
    };
    const before = renderer(code, room, run.state, false, { highContrast });
    for (const barrier of barriers) expect(opacity(before, barrier.width)).toBe(1);
    const restored = renderer(code, room, { ...run.state, brokenBarrierIds: ['cloth'], activatedSwitchIds: ['button-a'] }, true, { highContrast });
    expect(opacity(restored, 160)).toBe(0);
    expect(opacity(restored, 120)).toBe(0);
    expect(opacity(restored, 110)).toBe(1);
    expect(opacity(restored, 100)).toBe(1);
    expect(opacity(restored, 90)).toBe(1);
    const link = restored.paths.find((path) => JSON.stringify(path[0]) === JSON.stringify(['moveTo', 75, 300]))!;
    expect(link.filter(([method]) => method === 'cubicTo').map((command) => command.slice(-2))).toEqual([[170, 232]]);
    restored.paths.length = 0;
    restored.motion.tick.value = 120;
    restored.flush();
    expect(restored.paths).toHaveLength(0);
  });

  test.each([false, true])('a cloth break flashes briefly without rebuilding paths (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const barrier = { id: 'cloth', kind: 'tearable' as const, x: 100, y: 200, width: 160, height: 24 };
    const state: LaunchState = { ...run.state, tick: 100, phase: 'flying', brokenBarrierIds: ['cloth'], event: { type: 'break', id: 'cloth', tick: 100 } };
    const view = renderer(code, { ...run.room, barriers: [barrier], switches: [] }, state, reducedMotion);
    const flash = view.elements.find((element) => element.type === 'Group'
      && (element.props.children as Element)?.type === 'Rect' && (element.props.children as Element).props.color === '#FFF7E7')!;
    expect(view.value(flash.props.opacity)).toBe(reducedMotion ? 0 : 0.8);
    view.paths.length = 0;
    view.motion.tick.value = 124;
    view.flush();
    expect(view.value(flash.props.opacity)).toBe(reducedMotion ? 0 : 0.4);
    view.motion.tick.value = 148;
    view.flush();
    expect(view.value(flash.props.opacity)).toBe(0);
    expect(view.paths).toHaveLength(0);
  });

  test.each([false, true])('linked buttons and doors keep distinct matching symbols through activation and pruning (high contrast: %s)', (highContrast) => {
    const run = createEndlessRun(14);
    const doors: NonNullable<LaunchRoom['barriers']> = [
      { id: 'section-3-left-door', kind: 'door', x: 50, y: 100, width: 70, height: 12 },
      { id: 'section-3-right-door', kind: 'door', x: 230, y: 110, width: 70, height: 12 },
    ];
    const switches: NonNullable<LaunchRoom['switches']> = [
      { id: 'section-3-left-button', center: { x: 95, y: 300 }, radius: 20, doorIds: [doors[0].id] },
      { id: 'section-3-right-button', center: { x: 260, y: 310 }, radius: 20, doorIds: [doors[1].id] },
    ];
    const room = { ...run.room, barriers: doors, switches };
    const symbol = (view: ReturnType<typeof renderer>, x: number, y: number, strokeWidth: number) => {
      const group = view.elements.find((element) => element.type === 'Group'
        && JSON.stringify(element.props.transform) === JSON.stringify([{ translateX: x }, { translateY: y }]))!;
      const descendants: Element[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object' || !('type' in node)) return;
        descendants.push(node as Element);
        walk((node as Element).props.children);
      };
      walk(group);
      return descendants.find((element) => element.type === 'Path' && typeof element.props.path === 'string'
        && element.props.strokeWidth === strokeWidth)!.props.path;
    };
    const view = renderer(code, room, run.state, true, { highContrast });
    const symbols = switches.map((item, index) => {
      const glyph = symbol(view, item.center.x, item.center.y, 1.5);
      expect(symbol(view, doors[index].x, doors[index].y, 1.6)).toBe(glyph);
      return glyph;
    });
    expect(symbols[0]).not.toBe(symbols[1]);
    const restored = renderer(code, { ...room, barriers: [doors[1]], switches: [switches[1]] },
      { ...run.state, activatedSwitchIds: [switches[1].id] }, true, { highContrast });
    expect(symbol(restored, switches[1].center.x, switches[1].center.y, 1.5)).toBe(symbols[1]);
    expect(symbol(restored, doors[1].x, doors[1].y, 1.6)).toBe(symbols[1]);
    const mirrored = renderer(code, { ...room,
      switches: switches.map((item) => ({ ...item, center: { ...item.center, x: 360 - item.center.x } })),
      barriers: doors.map((door) => ({ ...door, x: 360 - door.x - door.width })),
    }, run.state, true, { highContrast });
    switches.forEach((item, index) => {
      expect(symbol(mirrored, 360 - item.center.x, item.center.y, 1.5)).toBe(symbols[index]);
      expect(symbol(mirrored, 360 - doors[index].x - doors[index].width, doors[index].y, 1.6)).toBe(symbols[index]);
    });
  });

  test.each([false, true])('shutter warnings and closed faces follow the exact physics clock (reduced motion: %s)', (reducedMotion) => {
    const run = createEndlessRun(14);
    const barrier = { id: 'shutter', kind: 'shutter' as const, x: 100, y: 200, width: 160, height: 12, phaseTicks: 120 };
    const view = renderer(code, { ...run.room, barriers: [barrier], switches: [] }, { ...run.state, phase: 'flying' }, reducedMotion);
    const face = view.elements.find((element) => element.type === 'Group' && Array.isArray(element.props.children)
      && (element.props.children as Element[]).some((child) => child?.type === 'Rect' && child.props.width === 160 && child.props.x === 0))!;
    const warning = view.elements.find((element) => element.type === 'Group' && Array.isArray(element.props.children)
      && (element.props.children as Element[]).some((child) => child?.type === 'Rect' && child.props.width === 158 && child.props.strokeWidth === 2))!;
    const teeth = (face.props.children as Element[]).find((element) => element?.type === 'Path' && element.props.style === 'fill')!;
    const commands = (teeth.props.path as { commands: Command[] }).commands;
    expect(commands.filter(([method]) => method === 'close').length).toBeGreaterThan(20);
    for (const [method, x, y] of commands) {
      if (method === 'close') continue;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(barrier.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(barrier.height);
    }
    expect((warning.props.children as Element[]).some((element) => element?.props.path === teeth.props.path)).toBe(false);
    view.paths.length = 0;
    for (const tick of [0, 119, 120, 209, 210, 359, 360, 600]) {
      view.motion.tick.value = tick;
      view.flush();
      expect(view.value(face.props.opacity)).toBe(simulation.barrierIsActive(barrier, { ...run.room, barriers: [barrier] }, run.state, tick) ? 1 : 0);
      expect(view.value(warning.props.opacity)).toBe(simulation.shutterPhase(barrier, tick) === 'warning' ? 1 : 0);
    }
    expect(view.paths).toHaveLength(0);
  });

  test('a pin freezes the rendered receiver and orbit arm at the same effective tick', () => {
    const run = createEndlessRun(14);
    const pocket = { ...run.room.pockets[1], orbit: { radius: 42, periodTicks: 480, phaseTicks: 0 } };
    const state: LaunchState = { ...run.state, toolEffects: { pin: { targetId: pocket.id, startedTick: 60 } } };
    const view = renderer(code, { ...run.room, pockets: [run.room.pockets[0], pocket] }, state);
    const position = simulation.pocketPosition(pocket, 60, state);
    for (const tick of [60, 120, 360]) {
      view.motion.tick.value = tick; view.flush();
      expect(view.elements.filter(element => element.type === 'Group').map(element => view.value(element.props.transform)))
        .toContainEqual([{ translateX: position.x }, { translateY: position.y }]);
      expect(view.elements.some(element => element.type === 'Line' && JSON.stringify(view.value(element.props.p2)) === JSON.stringify(position))).toBe(true);
    }
  });

  test('sail visibility follows actual descent without requiring a React event at the apex', () => {
    const run = createEndlessRun(14);
    const view = renderer(code, run.room, { ...run.state, phase: 'flying', velocity: { x: 10, y: -100 }, toolEffects: { sail: true } });
    const sail = view.elements.find(element => element.type === 'Group' && Array.isArray(element.props.children)
      && (element.props.children as Element[]).some(child => child?.type === 'Path' && child.props.color === '#f4e4b4'))!;
    expect(view.value(sail.props.opacity)).toBe(0);
    view.motion.velocityY.value = 0; view.flush();
    expect(view.value(sail.props.opacity)).toBe(1);
    view.motion.velocityY.value = -100; view.flush();
    expect(view.value(sail.props.opacity)).toBe(0);
  });

  test('a temporary pocket is drawn while available and disappears after its outgoing launch', () => {
    const run = createEndlessRun(14);
    const pocket = { id: 'tool-stitch-0-0', center: { x: 170, y: 170 }, kind: 'checkpoint' as const, width: 80 };
    const state = { ...run.state, stitchedPocket: { pocket, spent: false, originPocketId: run.state.pocketId } };
    const visible = renderer(code, run.room, state);
    const spent = renderer(code, run.room, { ...state, phase: 'flying', pocketId: pocket.id, stitchedPocket: { ...state.stitchedPocket, spent: true } });
    const transforms = (view: ReturnType<typeof renderer>) => view.elements.filter(element => element.type === 'Group').map(element => view.value(element.props.transform));
    expect(transforms(visible)).toContainEqual([{ translateX: 170 }, { translateY: 170 }]);
    expect(transforms(spent)).not.toContainEqual([{ translateX: 170 }, { translateY: 170 }]);
  });

});
