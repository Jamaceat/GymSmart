/**
 * Constants for the Water Fill and Ripple animations on exercise statistics.
 */

export const WATER_FILL_CONSTANTS = {
  // Gestures and general timings
  FILL_DURATION_MS: 5000,
  DRAIN_DURATION_MS: 250,

  // Colors
  WATER_COLOR: 'rgba(60, 135, 247, 0.18)',
  WAVE_COLOR_FRONT: 'rgba(60, 135, 247, 0.25)',
  WAVE_COLOR_BACK: 'rgba(60, 135, 247, 0.15)',
  RIPPLE_COLOR: 'rgba(60, 135, 247, 0.32)',
  BUBBLE_COLOR: 'rgba(255, 255, 255, 0.45)',

  // Waves
  WAVE_1: {
    ROTATE_DURATION_MS: 2200,
    TRANSLATE_DURATION_MS: 1800,
    SIZE: 600,
    BORDER_RADIUS: 220,
    TOP_OFFSET: -550,
    LEFT_OFFSET: '-35%',
  },
  WAVE_2: {
    ROTATE_DURATION_MS: 3000,
    TRANSLATE_DURATION_MS: 2400,
    SIZE: 580,
    BORDER_RADIUS: 210,
    TOP_OFFSET: -545,
    LEFT_OFFSET: '-25%',
  },

  // Ripples
  RIPPLE: {
    INITIAL_SIZE: 100,
    BORDER_RADIUS: 50,
    MAX_SCALE: 6.5,
  },

  // Bubbles
  BUBBLES: [
    { delay: 0, startX: 15, size: 4 },
    { delay: 350, startX: 38, size: 6 },
    { delay: 150, startX: 55, size: 3 },
    { delay: 600, startX: 72, size: 5 },
    { delay: 800, startX: 88, size: 4 },
  ],
  BUBBLE_BASE_DURATION_MS: 1300,
  BUBBLE_RANDOM_DURATION_MAX_MS: 400,
} as const;
