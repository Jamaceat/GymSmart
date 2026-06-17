/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable react-hooks/immutability */
import React, { useLayoutEffect, useCallback } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withSpring,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';

interface SortableListProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T, index: number, dragGesture: any) => React.ReactNode;
  onOrderChange: (newData: T[]) => void;
  itemHeight: number;
}

export function SortableList<T>({
  data,
  keyExtractor,
  renderItem,
  onOrderChange,
  itemHeight,
}: SortableListProps<T>) {
  // Initialize positions synchronously on first render
  const initialPositions = (() => {
    const pos: Record<string, number> = {};
    data.forEach((item, index) => {
      pos[keyExtractor(item)] = index;
    });
    return pos;
  })();
  const positions = useSharedValue<Record<string, number>>(initialPositions);

  // Update positions in useLayoutEffect when data changes to avoid render-phase writes
  useLayoutEffect(() => {
    const newPositions: Record<string, number> = {};
    data.forEach((item, index) => {
      newPositions[keyExtractor(item)] = index;
    });
    positions.value = newPositions;
  }, [data, keyExtractor]);

  const handleDragEnd = useCallback((finalPositions: Record<string, number>) => {
    const sortedData = [...data].sort((a, b) => {
      const aKey = keyExtractor(a);
      const bKey = keyExtractor(b);
      return (finalPositions[aKey] ?? 0) - (finalPositions[bKey] ?? 0);
    });
    onOrderChange(sortedData);
  }, [data, keyExtractor, onOrderChange]);

  return (
    <View style={{ height: data.length * itemHeight, position: 'relative' }}>
      {data.map((item, index) => {
        const id = keyExtractor(item);
        return (
          <SortableItem
            key={id}
            id={id}
            index={index}
            dataLength={data.length}
            positions={positions}
            itemHeight={itemHeight}
            handleDragEnd={handleDragEnd}
          >
            {(dragGesture) => renderItem(item, index, dragGesture)}
          </SortableItem>
        );
      })}
    </View>
  );
}

interface SortableItemProps {
  id: string;
  index: number;
  dataLength: number;
  positions: SharedValue<Record<string, number>>;
  itemHeight: number;
  handleDragEnd: (finalPositions: Record<string, number>) => void;
  children: (dragGesture: any) => React.ReactNode;
}

function SortableItem({
  id,
  index,
  dataLength,
  positions,
  itemHeight,
  handleDragEnd,
  children,
}: SortableItemProps) {
  const isDragging = useSharedValue(false);
  const startIndex = useSharedValue(0);
  const translateY = useSharedValue(0);

  // Synchronously initialize offsetY to its correct position on mount
  const offsetY = useSharedValue(index * itemHeight);

  // Sync position in useLayoutEffect when the item's index changes from the outside
  useLayoutEffect(() => {
    if (!isDragging.value) {
      offsetY.value = withSpring(index * itemHeight, { damping: 20, stiffness: 150 });
    }
  }, [index, itemHeight]);

  // React to order changes caused by other items dragging over us (runs on UI thread)
  useAnimatedReaction(
    () => {
      return positions.value[id] ?? 0;
    },
    (nextIndex, prevIndex) => {
      if (nextIndex !== prevIndex && !isDragging.value) {
        offsetY.value = withSpring(nextIndex * itemHeight, { damping: 20, stiffness: 150 });
      }
    }
  );

  const panGesture = Gesture.Pan()
    .onStart(() => {
      isDragging.value = true;
      startIndex.value = positions.value[id] ?? 0;
    })
    .onUpdate((event) => {
      translateY.value = event.translationY;
      
      const currentTargetPosition = startIndex.value * itemHeight + translateY.value;
      offsetY.value = currentTargetPosition;

      const currentIndex = positions.value[id] ?? 0;
      const newIndex = Math.max(
        0,
        Math.min(dataLength - 1, Math.round(currentTargetPosition / itemHeight))
      );

      if (newIndex !== currentIndex) {
        const currentPositions = { ...positions.value };
        const targetId = Object.keys(currentPositions).find(
          (key) => currentPositions[key] === newIndex && key !== id
        );

        if (targetId) {
          // Swap positions in the shared value
          currentPositions[targetId] = currentIndex;
          currentPositions[id] = newIndex;
          positions.value = currentPositions;
        }
      }
    })
    .onEnd(() => {
      isDragging.value = false;
      const finalIndex = positions.value[id] ?? 0;
      offsetY.value = withSpring(finalIndex * itemHeight, { damping: 20, stiffness: 150 });
      
      const currentPositions = { ...positions.value };
      runOnJS(handleDragEnd)(currentPositions);
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: itemHeight,
      transform: [{ translateY: offsetY.value }],
      zIndex: isDragging.value ? 999 : 1,
      opacity: isDragging.value ? 0.9 : 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: isDragging.value ? 4 : 0 },
      shadowOpacity: isDragging.value ? 0.25 : 0,
      shadowRadius: isDragging.value ? 5 : 0,
      elevation: isDragging.value ? 5 : 0,
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      {children(panGesture)}
    </Animated.View>
  );
}
