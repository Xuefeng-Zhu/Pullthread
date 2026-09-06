import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  advanceSimulation,
  createFixedStepClock,
  releaseSimulation,
  resetSimulation,
} from '../core/simulation';
import type {
  Point,
  SimulationOutcome,
  SimulationPhase,
  Stitch,
} from '../core/types';
import {
  createLevelReplay,
  simulateLevelReplay,
} from '../replay';
import {
  createLevelSimulation,
  createLevelWorld,
} from '../levels/levelLoader';
import type { LevelDefinition } from '../levels/schema';
import { scaleGameplayElapsed } from './gameplayTiming';

export interface GameSessionView {
  readonly travelerX: SharedValue<number>;
  readonly travelerY: SharedValue<number>;
  readonly speed: SharedValue<number>;
}

export interface RoutePreview {
  readonly points: readonly Point[];
  readonly outcome: SimulationOutcome;
}

export interface UseGameSessionOptions {
  readonly level: LevelDefinition;
  readonly phase: SimulationPhase;
  readonly stitches: readonly Stitch[];
  readonly onOutcome: (outcome: SimulationOutcome) => void;
}

export function simulateRoute(
  level: LevelDefinition,
  stitches: readonly Stitch[],
  sampleEveryTicks = 8,
): RoutePreview {
  const run = simulateLevelReplay(
    createLevelReplay(level, stitches),
    sampleEveryTicks,
  );
  return { points: run.points, outcome: run.outcome };
}

export function useGameSession({
  level,
  phase,
  stitches,
  onOutcome,
}: UseGameSessionOptions): GameSessionView {
  const travelerX = useSharedValue(level.traveler.start.x);
  const travelerY = useSharedValue(level.traveler.start.y);
  const speed = useSharedValue(0);
  const onOutcomeRef = useRef(onOutcome);
  const simulation = useMemo(() => createLevelSimulation(level), [level]);
  const world = useMemo(
    () => createLevelWorld(level, stitches),
    [level, stitches],
  );

  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    if (phase === 'planning') {
      resetSimulation(simulation, level.traveler);
      travelerX.value = level.traveler.start.x;
      travelerY.value = level.traveler.start.y;
      speed.value = 0;
      return;
    }

    if (phase !== 'running') {
      return;
    }

    resetSimulation(simulation, level.traveler);
    travelerX.value = level.traveler.start.x;
    travelerY.value = level.traveler.start.y;
    speed.value = 0;
    releaseSimulation(simulation);
    const clock = createFixedStepClock();
    let animationFrame = 0;
    let lastTimestamp: number | null = null;
    let appIsActive = AppState.currentState === 'active';

    const appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        appIsActive = nextState === 'active';
        lastTimestamp = null;
      },
    );

    const frame = (timestamp: number) => {
      if (simulation.phase !== 'running') {
        return;
      }

      animationFrame = requestAnimationFrame(frame);
      if (!appIsActive) {
        return;
      }

      const elapsed =
        lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;
      advanceSimulation(
        clock,
        scaleGameplayElapsed(elapsed),
        simulation,
        world,
        level.physicsConfig,
      );

      travelerX.value = simulation.traveler.position.x;
      travelerY.value = simulation.traveler.position.y;
      speed.value = Math.hypot(
        simulation.traveler.velocity.x,
        simulation.traveler.velocity.y,
      );

      if (simulation.outcome) {
        cancelAnimationFrame(animationFrame);
        onOutcomeRef.current(simulation.outcome);
      }
    };

    animationFrame = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animationFrame);
      appStateSubscription.remove();
    };
  }, [level, phase, simulation, speed, travelerX, travelerY, world]);

  return { travelerX, travelerY, speed };
}
