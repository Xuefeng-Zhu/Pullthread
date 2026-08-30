import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import {
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { SimulationOutcome, SimulationPhase } from '../../game/core/types';
import type { CanvasSize } from '../../game/input/stitchGesture';
import {
  createLevelWorld,
  getLevelVersion,
} from '../../game/levels/levelLoader';
import type { LevelReplayV1 } from '../../game/replay';
import { simulateLevelReplay } from '../../game/replay';
import { FabricCanvas } from '../../game/rendering/FabricCanvas';
import { useGameSession } from '../../game/runtime/useGameSession';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

const EMPTY_SIZE: CanvasSize = { width: 1, height: 1 };

export type ReplayStatus = 'ready' | 'tightening' | 'playing' | 'complete';

interface ReplayStageProps {
  readonly replay: LevelReplayV1;
  readonly highContrast: boolean;
  readonly phase: SimulationPhase;
  readonly status: ReplayStatus;
  readonly onOutcome: (outcome: SimulationOutcome) => void;
}

function replayStatusCopy(status: ReplayStatus): string {
  switch (status) {
    case 'tightening':
      return 'TIGHTENING THREAD';
    case 'playing':
      return 'WATCHING REPLAY';
    case 'complete':
      return 'REPLAY COMPLETE';
    case 'ready':
      return 'REPLAY READY';
  }
}

export function ReplayStage({
  replay,
  highContrast,
  phase,
  status,
  onOutcome,
}: ReplayStageProps) {
  const [size, setSize] = useState(EMPTY_SIZE);
  const stitchProgress = useSharedValue(1);
  const level = useMemo(
    () => getLevelVersion(replay.levelId, replay.levelVersion),
    [replay.levelId, replay.levelVersion],
  );
  const run = useMemo(() => simulateLevelReplay(replay), [replay]);
  const world = useMemo(
    () => createLevelWorld(level, replay.stitches),
    [level, replay.stitches],
  );
  const session = useGameSession({
    level,
    phase,
    stitches: replay.stitches,
    onOutcome,
  });

  /* eslint-disable react-hooks/immutability -- Replay presentation intentionally publishes deterministic thread/traveler snapshots through Reanimated SharedValues. */
  useLayoutEffect(() => {
    if (status === 'tightening') {
      stitchProgress.value = 0;
      stitchProgress.value = withTiming(1, { duration: 560 });
      return;
    }

    stitchProgress.value = 1;
  }, [status, stitchProgress]);

  useLayoutEffect(() => {
    if (status === 'tightening') {
      session.travelerX.value = level.traveler.start.x;
      session.travelerY.value = level.traveler.start.y;
      session.speed.value = 0;
      return;
    }

    if (phase !== 'running') {
      session.travelerX.value = run.finalPosition.x;
      session.travelerY.value = run.finalPosition.y;
      session.speed.value = 0;
    }
  }, [
    phase,
    level.traveler.start.x,
    level.traveler.start.y,
    run.finalPosition.x,
    run.finalPosition.y,
    session.speed,
    session.travelerX,
    session.travelerY,
    status,
  ]);
  /* eslint-enable react-hooks/immutability */

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  }, []);

  return (
    <View
      testID="replay-stage"
      accessible
      accessibilityLabel={`Deterministic replay of the completed pull. ${replayStatusCopy(status)}`}
      accessibilityLiveRegion="polite"
      style={styles.frame}
      onLayout={onLayout}
    >
      <FabricCanvas
        level={level}
        size={size}
        field={world.surface}
        stitches={replay.stitches}
        preview={null}
        route={run.points}
        routeSucceeds={run.outcome.status === 'success'}
        phase={phase}
        travelerX={session.travelerX}
        travelerY={session.travelerY}
        travelerSpeed={session.speed}
        highContrast={highContrast}
        showRoute
        stitchProgress={stitchProgress}
      />
      <View
        testID="replay-status"
        accessible={false}
        style={styles.statusBadge}
      >
        <Text style={styles.statusText}>{replayStatusCopy(status)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 1.08,
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#315868',
    backgroundColor: '#eddfc4',
    ...shadows.raised,
  },
  statusBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: '#b49369',
    backgroundColor: '#f2e2c5',
    ...shadows.soft,
  },
  statusText: {
    color: colors.textPrimary,
    fontFamily: 'NunitoSans_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.8,
  },
});
