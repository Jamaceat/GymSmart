import React, { useState, useEffect } from 'react';
import { StyleSheet, Pressable, View, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth, BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Import sub-views
import { ExercisesView } from '@/components/workout/ExercisesView';
import { GroupsView } from '@/components/workout/GroupsView';
import { MetaGroupsView } from '@/components/workout/MetaGroupsView';

export default function WorkoutModuleScreen() {
  const theme = useTheme();
  const { tab, expandId } = useLocalSearchParams<{ tab?: string; expandId?: string }>();

  // Tab index: 0 = Ejercicios, 1 = Grupos, 2 = Rutinas
  const [activeTab, setActiveTab] = useState(0);

  // Sync state if query parameter changes
  useEffect(() => {
    if (tab === 'exercises') {
      setActiveTab(0);
    } else if (tab === 'groups') {
      setActiveTab(1);
    } else if (tab === 'routines') {
      setActiveTab(2);
    }
  }, [tab]);

  const expandIdNum = expandId ? parseInt(expandId, 10) : undefined;

  // Render the currently active sub-view
  const renderActiveView = () => {
    switch (activeTab) {
      case 0:
        return <ExercisesView />;
      case 1:
        return <GroupsView />;
      case 2:
        return <MetaGroupsView initialExpandId={expandIdNum} />;
      default:
        return <ExercisesView />;
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* Segmented Controller / Tabs Selector */}
        <ThemedView type="backgroundElement" style={styles.tabSelectorContainer}>
          <Pressable
            onPress={() => setActiveTab(0)}
            style={({ pressed }) => [
              styles.tabSelectorButton,
              activeTab === 0 && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText
              type="smallBold"
              themeColor={activeTab === 0 ? 'text' : 'textSecondary'}
              style={styles.tabText}>
              Ejercicios
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab(1)}
            style={({ pressed }) => [
              styles.tabSelectorButton,
              activeTab === 1 && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText
              type="smallBold"
              themeColor={activeTab === 1 ? 'text' : 'textSecondary'}
              style={styles.tabText}>
              Grupos
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => setActiveTab(2)}
            style={({ pressed }) => [
              styles.tabSelectorButton,
              activeTab === 2 && { backgroundColor: theme.backgroundSelected },
              pressed && styles.pressed,
            ]}>
            <ThemedText
              type="smallBold"
              themeColor={activeTab === 2 ? 'text' : 'textSecondary'}
              style={styles.tabText}>
              Rutinas
            </ThemedText>
          </Pressable>
        </ThemedView>

        {/* Render View */}
        <View style={styles.content}>
          {renderActiveView()}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  tabSelectorContainer: {
    flexDirection: 'row',
    padding: Spacing.one,
    borderRadius: Spacing.four,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  tabSelectorButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: {
    fontSize: 14,
  },
  content: {
    flex: 1,
  },
  pressed: {
    opacity: 0.8,
  },
});
