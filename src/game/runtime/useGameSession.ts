import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import {
  SPIKE_LEVEL,
  SPIKE_PHYSICS_CONFIG,
  createSpikeSimulation,
  createSpikeWorld,
} from '../levels/spikeLevel';
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
  createSpikeReplay,
  simulateSpikeReplay,
} from '../replay';

export interface GameSessionView {
  readonly travelerX: SharedValue<number>;
  readonly travelerY: SharedValue<number>;
  readonly speed: SharedValue<number>;
}

export interface RoutePreview {
  readonly points: readonly Point[];
  readonly outcome: SimulationOutcome;
}

interface UseGameSessionOptions {
  readonly phase: SimulationPhase;
  readonly stitches: readonly Stitch[];
  readonly onOutcome: (outcome: SimulationOutcome) => void;
}

export function simulateRoute(
  stitches: readonly Stitch[],
  sampleEveryTicks = 8,
): RoutePreview {
  const run = simulateSpikeReplay(
    createSpikeReplay(stitches),
    sampleEveryTicks,
  );
  return { points: run.points, outcome: run.outcome };
}

export function useGameSession({
  phase,
  stitches,
  onOutcome,
}: UseGameSessionOptions): GameSessionView {
  const travelerX = useSharedValue(SPIKE_LEVEL.traveler.start.x);
  const travelerY = useSharedValue(SPIKE_LEVEL.traveler.start.y);
  const speed = useSharedValue(0);
  const onOutcomeRef = useRef(onOutcome);
  const simulationRef = useRef(createSpikeSimulation());
  const world = useMemo(() => createSpikeWorld(stitches), [stitches]);

  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    const simulation = simulationRef.current;

    if (phase === 'planning') {
      resetSimulation(simulation, SPIKE_LEVEL.traveler);
      travelerX.value = SPIKE_LEVEL.traveler.start.x;
      travelerY.value = SPIKE_LEVEL.traveler.start.y;
      speed.value = 0;
      return;
    }

    if (phase !== 'running') {
      return;
    }

    resetSimulation(simulation, SPIKE_LEVEL.traveler);
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
        elapsed,
        simulation,
        world,
        SPIKE_PHYSICS_CONFIG,
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
  }, [phase, speed, travelerX, travelerY, world]);

  return { travelerX, travelerY, speed };
}
