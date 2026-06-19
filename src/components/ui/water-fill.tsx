import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
  SharedValue,
} from 'react-native-reanimated';

import { WATER_FILL_CONSTANTS } from '@/constants/water-fill';

interface WaterFillProps {
  progress: SharedValue<number>;
  pressLocation: { x: number; y: number } | null;
}

function Bubble({ delay, startX, size }: { delay: number; startX: number; size: number }) {
  const bubbleY = useSharedValue(100);
  
  useEffect(() => {
    bubbleY.value = withRepeat(
      withDelay(
        delay,
        withTiming(-35, {
          duration: WATER_FILL_CONSTANTS.BUBBLE_BASE_DURATION_MS + Math.random() * WATER_FILL_CONSTANTS.BUBBLE_RANDOM_DURATION_MAX_MS,
          easing: Easing.linear,
        })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: bubbleY.value }],
      opacity: bubbleY.value < 10 ? Math.max(0, (bubbleY.value + 35) / 45) * 0.75 : 0.75,
    };
  });

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          left: `${startX}%`,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        animatedStyle,
      ]}
    />
  );
}

export function WaterFill({ progress, pressLocation }: WaterFillProps) {
  const waveRotate1 = useSharedValue(0);
  const waveRotate2 = useSharedValue(0);
  const waveTranslateX1 = useSharedValue(0);
  const waveTranslateX2 = useSharedValue(0);

  useEffect(() => {
    waveRotate1.value = withRepeat(
      withTiming(360, { duration: WATER_FILL_CONSTANTS.WAVE_1.ROTATE_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );
    waveRotate2.value = withRepeat(
      withTiming(-360, { duration: WATER_FILL_CONSTANTS.WAVE_2.ROTATE_DURATION_MS, easing: Easing.linear }),
      -1,
      false
    );
    waveTranslateX1.value = withRepeat(
      withTiming(50, { duration: WATER_FILL_CONSTANTS.WAVE_1.TRANSLATE_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    waveTranslateX2.value = withRepeat(
      withTiming(-50, { duration: WATER_FILL_CONSTANTS.WAVE_2.TRANSLATE_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const animatedFill = useAnimatedStyle(() => ({
    height: `${progress.value * 100}%`,
    opacity: progress.value,
  }));

  const animatedWave1 = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${waveRotate1.value}deg` },
      { translateX: waveTranslateX1.value },
    ],
  }));

  const animatedWave2 = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${waveRotate2.value}deg` },
      { translateX: waveTranslateX2.value },
    ],
  }));

  const animatedRipple = useAnimatedStyle(() => {
    if (!pressLocation) return { opacity: 0 };
    const scale = progress.value * WATER_FILL_CONSTANTS.RIPPLE.MAX_SCALE;
    return {
      position: 'absolute',
      left: pressLocation.x - WATER_FILL_CONSTANTS.RIPPLE.INITIAL_SIZE / 2,
      top: pressLocation.y - WATER_FILL_CONSTANTS.RIPPLE.INITIAL_SIZE / 2,
      width: WATER_FILL_CONSTANTS.RIPPLE.INITIAL_SIZE,
      height: WATER_FILL_CONSTANTS.RIPPLE.INITIAL_SIZE,
      borderRadius: WATER_FILL_CONSTANTS.RIPPLE.BORDER_RADIUS,
      backgroundColor: WATER_FILL_CONSTANTS.RIPPLE_COLOR,
      transform: [{ scale }],
      opacity: Math.max(0, 1 - progress.value * 1.1),
    };
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Ripple expanding from touch coordinates */}
      <Animated.View style={animatedRipple} />

      {/* Rising water layer with waves and bubbles */}
      <Animated.View
        pointerEvents="none"
        style={[styles.waterFillLayer, animatedFill]}
      >
        <Animated.View style={[styles.wave, animatedWave1]} />
        <Animated.View style={[styles.wave2, animatedWave2]} />
        
        {/* Rising Effervescent Bubbles */}
        {WATER_FILL_CONSTANTS.BUBBLES.map((b, idx) => (
          <Bubble key={idx} delay={b.delay} startX={b.startX} size={b.size} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  waterFillLayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: WATER_FILL_CONSTANTS.WATER_COLOR,
    overflow: 'hidden',
  },
  wave: {
    position: 'absolute',
    top: WATER_FILL_CONSTANTS.WAVE_1.TOP_OFFSET,
    left: WATER_FILL_CONSTANTS.WAVE_1.LEFT_OFFSET,
    width: WATER_FILL_CONSTANTS.WAVE_1.SIZE,
    height: WATER_FILL_CONSTANTS.WAVE_1.SIZE,
    borderRadius: WATER_FILL_CONSTANTS.WAVE_1.BORDER_RADIUS,
    backgroundColor: WATER_FILL_CONSTANTS.WAVE_COLOR_FRONT,
  },
  wave2: {
    position: 'absolute',
    top: WATER_FILL_CONSTANTS.WAVE_2.TOP_OFFSET,
    left: WATER_FILL_CONSTANTS.WAVE_2.LEFT_OFFSET,
    width: WATER_FILL_CONSTANTS.WAVE_2.SIZE,
    height: WATER_FILL_CONSTANTS.WAVE_2.SIZE,
    borderRadius: WATER_FILL_CONSTANTS.WAVE_2.BORDER_RADIUS,
    backgroundColor: WATER_FILL_CONSTANTS.WAVE_COLOR_BACK,
  },
  bubble: {
    position: 'absolute',
    bottom: -15,
    backgroundColor: WATER_FILL_CONSTANTS.BUBBLE_COLOR,
  },
});
