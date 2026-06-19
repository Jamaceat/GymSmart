import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, BottomTabInset, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getMuscleName, MuscleIntensity } from '@/constants/muscle-groups';
import {
  getMetaGroupWithGroups,
  getGroupWithExercises,
  MetaGroup,
  ExerciseGroup,
  Exercise,
  insertExerciseCompletionAudit,
} from '@/database/database';
import { useAlert } from '@/components/ui/alert-provider';

interface SessionExercise {
  uniqueId: string; // `${metaGroupItemId}-${exercise.id}`
  exercise: Exercise;
  groupName: string;
  metaGroupItemId: number;
}

function calculateTotalReps(exercise: Exercise): number {
  if (exercise.is_constant === 1) {
    return (exercise.default_sets || 0) * (exercise.default_reps || 0);
  }
  if (exercise.series_config) {
    try {
      const config = JSON.parse(exercise.series_config) as { set: number; reps: number }[];
      return config.reduce((sum, item) => sum + (item.reps || 0), 0);
    } catch (e) {
      console.error('Failed to parse series config for exercise', exercise.id, e);
    }
  }
  return (exercise.default_sets || 0) * (exercise.default_reps || 0);
}

export default function WorkoutSessionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { alert } = useAlert();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  // Search parameters
  const { metaGroupId, date } = useLocalSearchParams<{ metaGroupId: string; date: string }>();

  // Routine and layout state
  const [metaGroup, setMetaGroup] = useState<MetaGroup | null>(null);
  const [sessionExercises, setSessionExercises] = useState<SessionExercise[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Modals and UI State
  const [isExerciseListOpen, setIsExerciseListOpen] = useState(false);
  const [showResetOptions, setShowResetOptions] = useState(false);

  // Session Progress State
  const [completedExercises, setCompletedExercises] = useState<Set<string>>(new Set());
  const [completedSets, setCompletedSets] = useState<Set<number>>(new Set()); // 1-based set indices completed for active exercise
  const [currentSet, setCurrentSet] = useState<number>(1);
  const [setTimes, setSetTimes] = useState<Record<number, number>>({});
  const [customReps, setCustomReps] = useState<Record<string, Record<number, number>>>({});

  // Timer State
  const [activeSeconds, setActiveSeconds] = useState<number>(0);
  const [restSeconds, setRestSeconds] = useState<number>(0);
  const [isResting, setIsResting] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  // Custom Reset Config state (modified by the user)
  const [resetSet, setResetSet] = useState<number>(1);
  const [resetReps, setResetReps] = useState<number>(10);

  // Ref trackers for DB load and skip reset side-effects
  const isLoadedFromDb = React.useRef(false);
  const lastActiveIndex = React.useRef<number | null>(null);

  // Ref keeping latest state values to avoid stale closures in unmount cleanup
  const stateRef = React.useRef({
    activeIndex,
    activeSeconds,
    restSeconds,
    isResting,
    currentSet,
    completedSets,
    completedExercises,
    setTimes,
    customReps,
  });

  useEffect(() => {
    stateRef.current = {
      activeIndex,
      activeSeconds,
      restSeconds,
      isResting,
      currentSet,
      completedSets,
      completedExercises,
      setTimes,
      customReps,
    };
  }, [activeIndex, activeSeconds, restSeconds, isResting, currentSet, completedSets, completedExercises, setTimes, customReps]);

  // Flattened active exercise helper
  const activeSessionItem = sessionExercises[activeIndex] || null;
  const activeExercise = activeSessionItem?.exercise || null;

  // Format date for title
  const formattedDate = useMemo(() => {
    if (!date) return '';
    try {
      const [year, month, day] = date.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    } catch {
      return date;
    }
  }, [date]);

  // Save progress callback
  const saveProgress = useCallback(
    async (
      idx: number,
      activeSecs: number,
      restSecs: number,
      resting: boolean,
      currSet: number,
      doneSets: Set<number>,
      doneExs: Set<string>,
      timesMap?: Record<number, number>,
      customRepsMap?: Record<string, Record<number, number>>
    ) => {
      try {
        const doneSetsStr = Array.from(doneSets).join(',');
        const doneExsStr = Array.from(doneExs).join(',');
        const currentTimes = timesMap || stateRef.current.setTimes || {};
        const setTimesStr = JSON.stringify(currentTimes);
        const currentCustomReps = customRepsMap || stateRef.current.customReps || {};
        const customRepsStr = JSON.stringify(currentCustomReps);
        await db.runAsync(
          `INSERT OR REPLACE INTO session_progress 
            (meta_group_id, scheduled_date, active_index, active_seconds, rest_seconds, is_resting, current_set, completed_sets, completed_exercises, set_times, custom_reps) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            parseInt(metaGroupId!, 10),
            date,
            idx,
            activeSecs,
            restSecs,
            resting ? 1 : 0,
            currSet,
            doneSetsStr,
            doneExsStr,
            setTimesStr,
            customRepsStr,
          ]
        );
      } catch (e) {
        console.error('Error saving session progress:', e);
      }
    },
    [db, metaGroupId, date]
  );

  // Clear progress callback
  const clearSessionProgress = useCallback(async () => {
    try {
      await db.runAsync(
        'DELETE FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ?',
        [parseInt(metaGroupId!, 10), date]
      );
    } catch (e) {
      console.error('Error clearing session progress:', e);
    }
  }, [db, metaGroupId, date]);

  // Load routine and flatten exercises
  useEffect(() => {
    if (!metaGroupId) return;

    const loadRoutine = async () => {
      try {
        setIsLoading(true);
        const mGroupId = parseInt(metaGroupId, 10);
        const routineData = await getMetaGroupWithGroups(db, mGroupId);

        if (routineData) {
          setMetaGroup(routineData);

          if (routineData.groups && routineData.groups.length > 0) {
            const flattened: SessionExercise[] = [];
            
            for (const group of routineData.groups) {
              const fullGroup = await getGroupWithExercises(db, group.id!);
              if (fullGroup && fullGroup.exercises && fullGroup.exercises.length > 0) {
                for (const exercise of fullGroup.exercises) {
                  flattened.push({
                    uniqueId: `${group.meta_group_item_id}-${exercise.id}`,
                    exercise,
                    groupName: fullGroup.name,
                    metaGroupItemId: group.meta_group_item_id!,
                  });
                }
              }
            }
            setSessionExercises(flattened);

            // Fetch progress from database
            const progress = await db.getFirstAsync<{
              active_index: number;
              active_seconds: number;
              rest_seconds: number;
              is_resting: number;
              current_set: number;
              completed_sets: string | null;
              completed_exercises: string | null;
              set_times: string | null;
              custom_reps: string | null;
            }>(
              'SELECT * FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ?',
              [mGroupId, date]
            );

            if (progress) {
              setActiveIndex(progress.active_index);
              setActiveSeconds(progress.active_seconds);
              setRestSeconds(progress.rest_seconds);
              setIsResting(progress.is_resting === 1);
              setCurrentSet(progress.current_set);
              
              if (progress.completed_sets) {
                const sets = progress.completed_sets.split(',').map(Number).filter(Boolean);
                setCompletedSets(new Set(sets));
              } else {
                setCompletedSets(new Set());
              }

              if (progress.completed_exercises) {
                const exs = progress.completed_exercises.split(',').filter(Boolean);
                setCompletedExercises(new Set(exs));
              } else {
                setCompletedExercises(new Set());
              }

              if (progress.set_times) {
                try {
                  setSetTimes(JSON.parse(progress.set_times));
                } catch (e) {
                  setSetTimes({});
                }
              } else {
                setSetTimes({});
              }

              if (progress.custom_reps) {
                try {
                  setCustomReps(JSON.parse(progress.custom_reps));
                } catch (e) {
                  setCustomReps({});
                }
              } else {
                setCustomReps({});
              }
            } else {
              setActiveIndex(0);
              setCompletedExercises(new Set());
              setCustomReps({});
            }
          }
        }
      } catch (error) {
        console.error('Error loading session routine:', error);
        alert('Error', 'No se pudo cargar el entrenamiento.');
      } finally {
        isLoadedFromDb.current = true;
        setIsLoading(false);
      }
    };

    loadRoutine();
  }, [db, metaGroupId]);

  // Unmount effect to save active timers & progress when leaving
  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (isLoadedFromDb.current && s.completedExercises.size < sessionExercises.length && sessionExercises.length > 0) {
        saveProgress(
          s.activeIndex,
          s.activeSeconds,
          s.restSeconds,
          s.isResting,
          s.currentSet,
          s.completedSets,
          s.completedExercises,
          s.setTimes
        );
      }
    };
  }, [saveProgress, sessionExercises.length]);

  // Parse exercise series config
  const parsedSeriesConfig = useMemo(() => {
    if (!activeExercise) return [];
    if (activeExercise.is_constant === 1) {
      return Array.from({ length: activeExercise.default_sets }, (_, i) => ({
        set: i + 1,
        reps: activeExercise.default_reps,
      }));
    }
    if (activeExercise.series_config) {
      try {
        return JSON.parse(activeExercise.series_config) as { set: number; reps: number }[];
      } catch (e) {
        console.error('Failed to parse series_config:', e);
      }
    }
    return [];
  }, [activeExercise]);

  const isAllSetsCompleted = useMemo(() => {
    return parsedSeriesConfig.length > 0 && completedSets.size === parsedSeriesConfig.length;
  }, [completedSets, parsedSeriesConfig]);

  // Update default reset values when active exercise or series changes
  useEffect(() => {
    if (!isLoadedFromDb.current) return;

    if (lastActiveIndex.current === null) {
      lastActiveIndex.current = activeIndex;
      return;
    }

    if (activeIndex !== lastActiveIndex.current) {
      lastActiveIndex.current = activeIndex;

      if (activeExercise) {
        setCurrentSet(1);
        setCompletedSets(new Set());
        setSetTimes({});
        setResetSet(1);
        const initialReps = parsedSeriesConfig[0]?.reps ?? activeExercise.default_reps ?? 10;
        setResetReps(initialReps);
        
        // Stop timers when switching exercises
        setIsRunning(false);
        setIsResting(false);
        setActiveSeconds(0);
        setRestSeconds(0);
        setShowResetOptions(false);
      }
    }
  }, [activeIndex, activeExercise, parsedSeriesConfig]);

  // Handle manual/programmatic exercise selection with reset & save
  const handleSelectExercise = (idx: number) => {
    setActiveIndex(idx);
    setIsExerciseListOpen(false);
    
    // Reset timers & tracking state locally
    setCurrentSet(1);
    setCompletedSets(new Set());
    setSetTimes({});
    setIsResting(false);
    setIsRunning(false);
    setActiveSeconds(0);
    setRestSeconds(0);
    setShowResetOptions(false);

    saveProgress(
      idx,
      0, // activeSeconds
      0, // restSeconds
      false, // isResting
      1, // currentSet
      new Set(), // completedSets
      completedExercises,
      {}
    );
  };

  // Update default reset reps when chosen reset set changes
  const handleResetSetChange = (setNum: number) => {
    const bounded = Math.max(1, Math.min(parsedSeriesConfig.length, setNum));
    setResetSet(bounded);
    const setConfig = parsedSeriesConfig[bounded - 1];
    if (setConfig) {
      setResetReps(setConfig.reps);
    }
  };

  // Update specific set reps during session
  const handleUpdateReps = (setNum: number, newReps: number) => {
    if (!activeSessionItem) return;
    const uniqueId = activeSessionItem.uniqueId;
    const updatedCustomReps = {
      ...customReps,
      [uniqueId]: {
        ...(customReps[uniqueId] || {}),
        [setNum]: newReps,
      },
    };
    setCustomReps(updatedCustomReps);
    saveProgress(
      activeIndex,
      activeSeconds,
      restSeconds,
      isResting,
      currentSet,
      completedSets,
      completedExercises,
      setTimes,
      updatedCustomReps
    );
  };

  // Cross-timer interval logic
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRunning) {
      interval = setInterval(() => {
        if (isResting) {
          setRestSeconds((prev) => prev + 1);
        } else {
          setActiveSeconds((prev) => prev + 1);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, isResting]);

  // Format seconds to MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Toggle active stopwatch timer for current set (Work vs Pause)
  const handleToggleActiveTimer = () => {
    setIsRunning((prev) => !prev);
    
    saveProgress(
      activeIndex,
      activeSeconds,
      restSeconds,
      isResting,
      currentSet,
      completedSets,
      completedExercises
    );
  };

  // Finish current set, check it off, and trigger rest timer
  const handleFinishSet = () => {
    const nextCompletedSets = new Set(completedSets);
    nextCompletedSets.add(currentSet);
    setCompletedSets(nextCompletedSets);

    const isAllCompleted = nextCompletedSets.size === parsedSeriesConfig.length;

    let nextSet = currentSet;
    if (currentSet < parsedSeriesConfig.length) {
      nextSet = currentSet + 1;
      setCurrentSet(nextSet);
    }

    if (isAllCompleted) {
      setIsResting(false);
      setIsRunning(false);
      setRestSeconds(0);
    } else {
      setIsResting(true);
      setIsRunning(true);
      setRestSeconds(0); // Reset rest timer for new rest period
    }

    const nextSetTimes = { ...setTimes, [currentSet]: activeSeconds };
    setSetTimes(nextSetTimes);

    saveProgress(
      activeIndex,
      activeSeconds,
      0, // rest seconds reset
      !isAllCompleted, // isResting
      nextSet,
      nextCompletedSets,
      completedExercises,
      nextSetTimes
    );
  };

  // Start the next set, conmuting back to exercise execution
  const handleStartNextSet = () => {
    setIsResting(false);
    setIsRunning(true);
    setActiveSeconds(0);

    saveProgress(
      activeIndex,
      0,
      restSeconds,
      false, // isResting = false
      currentSet,
      completedSets,
      completedExercises
    );
  };

  // Toggle absolute Pause/Resume
  const handlePlayPause = () => {
    setIsRunning((prev) => !prev);
  };

  // Custom reset logic
  const handleCustomReset = () => {
    if (!activeSessionItem) return;

    // Reset timer metrics
    setActiveSeconds(0);
    setRestSeconds(0);
    setIsResting(false);
    setIsRunning(true); // Auto-start execution on reset

    // Update active set tracking
    setCurrentSet(resetSet);
    
    // Clear completed sets from the resetSet point onwards
    const nextCompletedSets = new Set(completedSets);
    const nextSetTimes = { ...setTimes };
    for (let i = resetSet; i <= parsedSeriesConfig.length; i++) {
      nextCompletedSets.delete(i);
      delete nextSetTimes[i];
    }
    setCompletedSets(nextCompletedSets);
    setSetTimes(nextSetTimes);

    // Update reps for the reset set to the specified resetReps
    const uniqueId = activeSessionItem.uniqueId;
    const updatedCustomReps = {
      ...customReps,
      [uniqueId]: {
        ...(customReps[uniqueId] || {}),
        [resetSet]: resetReps,
      },
    };
    setCustomReps(updatedCustomReps);

    setShowResetOptions(false);
    
    saveProgress(
      activeIndex,
      0, // activeSeconds reset
      0, // restSeconds reset
      false, // isResting reset
      resetSet,
      nextCompletedSets,
      completedExercises,
      nextSetTimes,
      updatedCustomReps
    );

    alert('Reiniciado', `Ejercicio reiniciado en la Serie ${resetSet} con ${resetReps} repeticiones.`);
  };

  // Finish active exercise and progress
  const handleFinishExercise = () => {
    if (!activeSessionItem) return;

    // Pause timers
    setIsRunning(false);
    setIsResting(false);

    // Save completed
    const nextCompletedExercises = new Set(completedExercises);
    nextCompletedExercises.add(activeSessionItem.uniqueId);
    setCompletedExercises(nextCompletedExercises);

    // Audit completed sets for active exercise
    const saveActiveExerciseAudit = async () => {
      try {
        const auditDate = date || new Date().toISOString().split('T')[0];
        const routineName = metaGroup?.name || 'Rutina sin nombre';
        const routineId = parseInt(metaGroupId!, 10);
        const ex = activeExercise;
        if (!ex) return;

        // Delete any existing audits for this exercise instance in this routine on this date to prevent duplicates
        await db.runAsync(
          'DELETE FROM exercise_completion_audits WHERE exercise_id = ? AND routine_id = ? AND completed_date = ? AND meta_group_item_id = ?',
          [ex.id || null, routineId, auditDate, activeSessionItem.metaGroupItemId]
        );

        // Get the series configs to know the reps for each set
        const seriesReps: Record<number, number> = {};
        if (ex.is_constant === 1) {
          for (let i = 1; i <= ex.default_sets; i++) {
            seriesReps[i] = ex.default_reps;
          }
        } else if (ex.series_config) {
          try {
            const config = JSON.parse(ex.series_config) as { set: number; reps: number }[];
            config.forEach(item => {
              seriesReps[item.set] = item.reps;
            });
          } catch (e) {
            console.error('Failed to parse series config:', e);
          }
        }

        // Insert audit for each completed set
        for (const setNum of completedSets) {
          const reps = customReps[activeSessionItem.uniqueId]?.[setNum] ?? seriesReps[setNum] ?? ex.default_reps ?? 10;
          const secs = setTimes[setNum] ?? 0;
          await insertExerciseCompletionAudit(db, {
            exercise_id: ex.id || null,
            exercise_name: ex.name,
            set_index: setNum,
            repetitions: reps,
            seconds_taken: secs,
            routine_id: routineId,
            routine_name: routineName,
            completed_date: auditDate,
            group_name: activeSessionItem.groupName,
            meta_group_item_id: activeSessionItem.metaGroupItemId,
          });
        }
      } catch (e) {
        console.error('Error saving active exercise audit:', e);
      }
    };

    saveActiveExerciseAudit();

    // Determine next exercise
    const nextUncompletedIndex = sessionExercises.findIndex(
      (item, idx) => idx > activeIndex && !nextCompletedExercises.has(item.uniqueId)
    );

    let nextIdx = activeIndex;
    if (nextUncompletedIndex !== -1) {
      nextIdx = nextUncompletedIndex;
      setActiveIndex(nextIdx);
    } else {
      // Check if there are any remaining uncompleted exercises from the start
      const firstUncompletedIndex = sessionExercises.findIndex(
        (item) => !nextCompletedExercises.has(item.uniqueId) && item.uniqueId !== activeSessionItem.uniqueId
      );

      if (firstUncompletedIndex !== -1) {
        nextIdx = firstUncompletedIndex;
        setActiveIndex(nextIdx);
      } else {
        // All exercises in the routine completed!
        clearSessionProgress();
        
        // Mark routine as completed in database if date is provided
        if (date) {
          db.runAsync(
            'UPDATE scheduled_routines SET is_completed = 1 WHERE meta_group_id = ? AND scheduled_date = ?',
            [parseInt(metaGroupId!, 10), date]
          ).catch(err => console.error('Error marking scheduled routine as completed:', err));
        }

        alert(
          '¡Entrenamiento Terminado!',
          'Has completado todos los ejercicios de la rutina programada. ¡Buen trabajo!',
          [{ text: 'Finalizar', onPress: () => router.back() }]
        );
        return;
      }
    }

    // Since we are changing the exercise, we save the progress at the NEXT index
    // with reset timer and set values for the new active exercise!
    saveProgress(
      nextIdx,
      0, // activeSeconds
      0, // restSeconds
      false, // isResting
      1, // currentSet
      new Set(), // completedSets
      nextCompletedExercises,
      {}
    );
  };

  // Check off or manually select a set
  const handleToggleSetManual = (setNum: number) => {
    const nextCompletedSets = new Set(completedSets);
    const nextSetTimes = { ...setTimes };

    if (nextCompletedSets.has(setNum)) {
      nextCompletedSets.delete(setNum);
      delete nextSetTimes[setNum];
    } else {
      nextCompletedSets.add(setNum);
      nextSetTimes[setNum] = activeSeconds || 0;
    }
    setCompletedSets(nextCompletedSets);
    setSetTimes(nextSetTimes);
    setCurrentSet(setNum);

    const isAllCompleted = nextCompletedSets.size === parsedSeriesConfig.length;
    let nextIsResting = isResting;
    let nextIsRunning = isRunning;
    let nextRestSeconds = restSeconds;

    if (isAllCompleted) {
      nextIsResting = false;
      nextIsRunning = false;
      nextRestSeconds = 0;
      setIsResting(false);
      setIsRunning(false);
      setRestSeconds(0);
    }

    saveProgress(
      activeIndex,
      activeSeconds,
      nextRestSeconds,
      nextIsResting,
      setNum,
      nextCompletedSets,
      completedExercises,
      nextSetTimes
    );
  };

  // Open exercise video helper
  const handleOpenVideo = (url: string | null) => {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      alert('Error', 'No se pudo abrir el video en este dispositivo.');
    });
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3c87f7" />
        <ThemedText style={{ marginTop: Spacing.two }} type="small">Cargando entrenamiento...</ThemedText>
      </ThemedView>
    );
  }

  if (sessionExercises.length === 0) {
    return (
      <ThemedView style={styles.emptyContainer}>
        <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <SymbolView
            name={{ ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' }}
            size={48}
            tintColor={theme.textSecondary}
          />
          <ThemedText style={styles.emptyTitle} type="smallBold">
            Rutina sin ejercicios
          </ThemedText>
          <ThemedText style={styles.emptySubtitle} type="small" themeColor="textSecondary">
            Esta rutina no tiene ejercicios asignados. Agrega grupos y ejercicios en el módulo de entrenamiento.
          </ThemedText>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtnLarge, { backgroundColor: theme.text }]}>
            <ThemedText style={{ color: theme.background }} type="smallBold">
              Volver al Calendario
            </ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  // Routine Completion Stats
  const percentComplete = Math.round((completedExercises.size / sessionExercises.length) * 100);

  // Render Exercise Item in Drawer/Sidebar
  const renderExerciseListItem = (item: SessionExercise, idx: number) => {
    const isActive = idx === activeIndex;
    const isDone = completedExercises.has(item.uniqueId);

    return (
      <Pressable
        key={item.uniqueId}
        onPress={() => handleSelectExercise(idx)}
        style={({ pressed }) => [
          styles.drawerItem,
          isActive && { backgroundColor: theme.backgroundSelected },
          pressed && styles.pressed,
        ]}>
        <View style={styles.drawerItemLeft}>
          <SymbolView
            name={
              isDone
                ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                : isActive
                ? { ios: 'play.circle.fill', android: 'play_circle', web: 'play_circle' }
                : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }
            }
            size={18}
            tintColor={isDone ? '#34c759' : isActive ? '#3c87f7' : theme.textSecondary}
          />
          <View style={{ flex: 1 }}>
            <ThemedText
              type="smallBold"
              style={[
                styles.drawerItemName,
                isDone && { textDecorationLine: 'line-through', opacity: 0.6 },
              ]}>
              {item.exercise.name}
            </ThemedText>
            <ThemedText type="code" themeColor="textSecondary">
              {item.groupName}
            </ThemedText>
          </View>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={14}
          tintColor={theme.textSecondary}
        />
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* Header Block */}
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
              size={24}
              tintColor={theme.text}
            />
          </Pressable>
          
          <View style={styles.headerTitleContainer}>
            <ThemedText type="smallBold" style={styles.headerTitle} numberOfLines={1}>
              {metaGroup?.name}
            </ThemedText>
            {formattedDate ? (
              <ThemedText type="code" themeColor="textSecondary">
                {formattedDate} • {percentComplete}% completado
              </ThemedText>
            ) : null}
          </View>

          <Pressable
            onPress={() => setIsExerciseListOpen(true)}
            style={({ pressed }) => [styles.listBtn, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }}
              size={20}
              tintColor={theme.text}
            />
          </Pressable>
        </View>

        {/* Layout Row (Responsive) */}
        <View style={styles.layoutRow}>
          {/* Tablet Left Panel (Fixed Sidebar) */}
          {isTablet && (
            <ThemedView type="backgroundSelected" style={styles.sidebarPanel}>
              <View style={styles.sidebarHeader}>
                <ThemedText type="smallBold">Ejercicios de la Rutina</ThemedText>
                <ThemedText type="code" themeColor="textSecondary">
                  {completedExercises.size} de {sessionExercises.length} terminados
                </ThemedText>
              </View>
              <ScrollView contentContainerStyle={styles.sidebarScroll}>
                {sessionExercises.map((item, idx) => renderExerciseListItem(item, idx))}
              </ScrollView>
            </ThemedView>
          )}

          {/* Active Control Panel (Main View) */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.mainScrollContent}
            style={styles.mainScroll}>
            
            {activeExercise && (
              <View style={styles.activeContainer}>
                {/* Exercise Info Card */}
                <ThemedView type="backgroundElement" style={styles.exerciseCard}>
                  <View style={styles.cardHeader}>
                    <View style={styles.badgeRow}>
                      <View style={styles.muscleBadge}>
                        <ThemedText type="code" style={{ color: '#3c87f7', fontWeight: 'bold' }}>
                          GRUPO: {activeSessionItem.groupName.toUpperCase()}
                        </ThemedText>
                      </View>
                      {(() => {
                        if (activeExercise.muscles && activeExercise.muscles.length > 0) {
                          const intensityOrder: Record<MuscleIntensity, number> = {
                            primary: 1,
                            secondary: 2,
                            stabilizer: 3,
                          };
                          const sortedMuscles = [...activeExercise.muscles].sort(
                            (a, b) => intensityOrder[a.intensity] - intensityOrder[b.intensity]
                          );

                          return sortedMuscles.map((m) => {
                            const muscleName = getMuscleName(m.muscle_id);
                            const badgeColor: Record<MuscleIntensity, { bg: string; text: string }> = {
                              primary: { bg: 'rgba(60, 135, 247, 0.12)', text: '#3c87f7' },
                              secondary: { bg: 'rgba(52, 199, 89, 0.12)', text: '#34c759' },
                              stabilizer: { bg: 'rgba(255, 149, 0, 0.12)', text: '#ff9500' },
                            };
                            const colors = badgeColor[m.intensity] || badgeColor.primary;
                            const prefix: Record<MuscleIntensity, string> = {
                              primary: 'P',
                              secondary: 'S',
                              stabilizer: 'E',
                            };

                            return (
                              <View
                                key={m.muscle_id}
                                style={[styles.muscleBadge, { backgroundColor: colors.bg }]}>
                                <ThemedText type="code" style={{ color: colors.text, fontWeight: 'bold' }}>
                                  {prefix[m.intensity]}: {muscleName.toUpperCase()}
                                </ThemedText>
                              </View>
                            );
                          });
                        } else if (activeExercise.muscle_group) {
                          return (
                            <View style={[styles.muscleBadge, { backgroundColor: 'rgba(52, 199, 89, 0.12)' }]}>
                              <ThemedText type="code" style={{ color: '#34c759', fontWeight: 'bold' }}>
                                MÚSCULO: {activeExercise.muscle_group.toUpperCase()}
                              </ThemedText>
                            </View>
                          );
                        }
                        return null;
                      })()}
                    </View>
                    {activeExercise.video_url && (
                      <Pressable
                        onPress={() => handleOpenVideo(activeExercise.video_url)}
                        style={({ pressed }) => [styles.videoBtn, pressed && styles.pressed]}>
                        <SymbolView
                          name={{ ios: 'play.rectangle.fill', android: 'play_circle_filled', web: 'play_circle_filled' }}
                          size={20}
                          tintColor="#ff453a"
                        />
                        <ThemedText type="code" style={{ color: '#ff453a', fontWeight: 'bold' }}>VER VIDEO</ThemedText>
                      </Pressable>
                    )}
                  </View>

                  <ThemedText type="subtitle" style={styles.exerciseNameText}>
                    {activeExercise.name}
                  </ThemedText>

                  <ThemedText type="small" themeColor="textSecondary" style={styles.exerciseObjectiveText}>
                    {activeExercise.is_constant === 1
                      ? `Objetivo: ${activeExercise.default_sets} series de ${activeExercise.default_reps} repeticiones`
                      : 'Objetivo: Series variables (subsets)'}
                  </ThemedText>
                </ThemedView>

                {/* Double Timers Component */}
                <View style={styles.timersContainer}>
                  <ThemedView
                    type="backgroundElement"
                    style={[
                      styles.timerCard,
                      !isResting && isRunning && styles.activeTimerBorder,
                    ]}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.timerCardLabel}>
                      REALIZACIÓN
                    </ThemedText>
                    <ThemedText
                      type="subtitle"
                      style={[
                        styles.timerNumber,
                        { color: !isResting && isRunning ? '#3c87f7' : theme.text },
                      ]}>
                      {formatTime(activeSeconds)}
                    </ThemedText>
                    <View style={styles.timerIndicatorRow}>
                      {!isResting && isRunning && (
                        <View style={[styles.pulseDot, { backgroundColor: '#3c87f7' }]} />
                      )}
                      <ThemedText type="code" themeColor={!isResting && isRunning ? 'text' : 'textSecondary'}>
                        {!isResting && isRunning ? 'Contando...' : 'Pausado'}
                      </ThemedText>
                    </View>
                  </ThemedView>

                  <ThemedView
                    type="backgroundElement"
                    style={[
                      styles.timerCard,
                      isResting && isRunning && styles.activeRestBorder,
                    ]}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.timerCardLabel}>
                      DESCANSO
                    </ThemedText>
                    <ThemedText
                      type="subtitle"
                      style={[
                        styles.timerNumber,
                        { color: isResting && isRunning ? '#ff9500' : theme.textSecondary },
                      ]}>
                      {formatTime(restSeconds)}
                    </ThemedText>
                    <View style={styles.timerIndicatorRow}>
                      {isResting && isRunning && (
                        <View style={[styles.pulseDot, { backgroundColor: '#ff9500' }]} />
                      )}
                      <ThemedText type="code" themeColor={isResting && isRunning ? 'text' : 'textSecondary'}>
                        {isResting && isRunning ? 'Contando...' : 'Pausado'}
                      </ThemedText>
                    </View>
                  </ThemedView>
                </View>

                {/* Status Bar */}
                <ThemedView type="backgroundElement" style={styles.statusBanner}>
                  <SymbolView
                    name={
                      isAllSetsCompleted
                        ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                        : isResting
                        ? { ios: 'hourglass', android: 'hourglass_empty', web: 'hourglass_empty' }
                        : { ios: 'figure.strengthtraining.traditional', android: 'fitness_center', web: 'fitness_center' }
                    }
                    size={18}
                    tintColor={isAllSetsCompleted ? '#34c759' : isResting ? '#ff9500' : '#3c87f7'}
                  />
                  <ThemedText type="smallBold" style={{ color: isAllSetsCompleted ? '#34c759' : isResting ? '#ff9500' : '#3c87f7' }}>
                    {isAllSetsCompleted
                      ? 'ESTADO: EJERCICIO COMPLETADO'
                      : isResting
                      ? 'ESTADO: DESCANSO ACTIVO'
                      : isRunning
                      ? 'ESTADO: REALIZANDO EJERCICIO'
                      : 'ESTADO: SESIÓN PAUSADA'}
                  </ThemedText>
                </ThemedView>

                {/* Series Progress Tracker */}
                <ThemedView type="backgroundElement" style={styles.seriesSection}>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>
                    Registro de Series
                  </ThemedText>
                  
                  <View style={styles.seriesGrid}>
                    {parsedSeriesConfig.map((item, index) => {
                      const setNum = index + 1;
                      const isSetDone = completedSets.has(setNum);
                      const isActiveSet = currentSet === setNum;

                      return (
                        <Pressable
                          key={setNum}
                          onPress={() => handleToggleSetManual(setNum)}
                          style={[
                            styles.seriesItemRow,
                            isActiveSet && { borderColor: '#3c87f7', borderWidth: 1.5 },
                            isSetDone && { opacity: 0.6 },
                          ]}>
                          <View style={styles.seriesItemLeft}>
                            <View
                              style={[
                                styles.setCheckCircle,
                                isSetDone && { backgroundColor: '#34c759', borderColor: '#34c759' },
                                isActiveSet && !isSetDone && { borderColor: '#3c87f7' },
                              ]}>
                              {isSetDone && (
                                <SymbolView
                                  name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                                  size={10}
                                  tintColor="#ffffff"
                                />
                              )}
                            </View>
                            <ThemedText type="smallBold">
                              Serie {setNum}
                            </ThemedText>
                          </View>

                          <View style={styles.seriesItemRight}>
                            {(() => {
                              const currentRepsValue = customReps[activeSessionItem.uniqueId]?.[setNum] ?? item.reps;
                              return (
                                <View style={styles.repsCounterContainer}>
                                  <Pressable
                                    onPress={(e) => {
                                      e.stopPropagation();
                                      handleUpdateReps(setNum, Math.max(1, currentRepsValue - 1));
                                    }}
                                    style={({ pressed }) => [
                                      styles.repsCounterBtn,
                                      pressed && styles.repsCounterBtnPressed,
                                    ]}>
                                    <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 16 }}>-</ThemedText>
                                  </Pressable>
                                  <ThemedText type="smallBold" style={styles.repsCounterValue}>
                                    {currentRepsValue}
                                  </ThemedText>
                                  <Pressable
                                    onPress={(e) => {
                                      e.stopPropagation();
                                      handleUpdateReps(setNum, Math.min(150, currentRepsValue + 1));
                                    }}
                                    style={({ pressed }) => [
                                      styles.repsCounterBtn,
                                      pressed && styles.repsCounterBtnPressed,
                                    ]}>
                                    <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 16 }}>+</ThemedText>
                                  </Pressable>
                                  <ThemedText type="code" themeColor="textSecondary" style={{ marginRight: Spacing.one }}>
                                    reps
                                  </ThemedText>
                                </View>
                              );
                            })()}
                            {setTimes[setNum] !== undefined && (
                              <ThemedText type="code" themeColor="textSecondary" style={{ marginRight: Spacing.one }}>
                                • {formatTime(setTimes[setNum])}
                              </ThemedText>
                            )}
                            {isActiveSet && (
                              <View style={styles.activeSetBadge}>
                                <ThemedText type="code" style={styles.activeSetBadgeText}>
                                  ACTIVA
                                </ThemedText>
                              </View>
                            )}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </ThemedView>

                {/* Ergonomic Main Action Toggler (Work / Rest) */}
                <View style={styles.primaryActions}>
                  {(() => {
                    if (isAllSetsCompleted) {
                      return (
                        <Pressable
                          onPress={handleFinishExercise}
                          style={({ pressed }) => [
                            styles.mainActionButton,
                            { backgroundColor: '#34c759' },
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={{ ios: 'arrow.right.circle.fill', android: 'arrow_forward', web: 'arrow_forward' }}
                            size={20}
                            tintColor="#ffffff"
                          />
                          <ThemedText type="default" style={styles.mainActionButtonText}>
                            Ir a Siguiente Serie
                          </ThemedText>
                        </Pressable>
                      );
                    }

                    const isInitialState = !isRunning && activeSeconds === 0 && restSeconds === 0 && completedSets.size === 0;

                    if (isInitialState) {
                      return (
                        <Pressable
                          onPress={handleStartNextSet}
                          style={({ pressed }) => [
                            styles.mainActionButton,
                            { backgroundColor: '#3c87f7' },
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                            size={20}
                            tintColor="#ffffff"
                          />
                          <ThemedText type="default" style={styles.mainActionButtonText}>
                            Comenzar Serie {currentSet}
                          </ThemedText>
                        </Pressable>
                      );
                    }

                    if (isResting) {
                      return (
                        <Pressable
                          onPress={handleStartNextSet}
                          style={({ pressed }) => [
                            styles.mainActionButton,
                            { backgroundColor: '#3c87f7' },
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }}
                            size={20}
                            tintColor="#ffffff"
                          />
                          <ThemedText type="default" style={styles.mainActionButtonText}>
                            Comenzar Serie {currentSet}
                          </ThemedText>
                        </Pressable>
                      );
                    }

                    // Active conmuting: show two buttons side-by-side
                    return (
                      <View style={styles.twoButtonRow}>
                        <Pressable
                          onPress={handleToggleActiveTimer}
                          style={({ pressed }) => [
                            styles.halfActionButton,
                            { backgroundColor: isRunning ? '#8e8e93' : '#3c87f7' },
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={
                              isRunning
                                ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                                : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                            }
                            size={18}
                            tintColor="#ffffff"
                          />
                          <ThemedText type="smallBold" style={styles.actionButtonTextWhite}>
                            {isRunning ? `Pausar Serie ${currentSet}` : `Continuar Serie ${currentSet}`}
                          </ThemedText>
                        </Pressable>

                        <Pressable
                          onPress={handleFinishSet}
                          style={({ pressed }) => [
                            styles.halfActionButton,
                            { backgroundColor: '#ff9500' },
                            pressed && styles.pressed,
                          ]}>
                          <SymbolView
                            name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                            size={18}
                            tintColor="#ffffff"
                          />
                          <ThemedText type="smallBold" style={styles.actionButtonTextWhite}>
                            Terminar Serie {currentSet}
                          </ThemedText>
                        </Pressable>
                      </View>
                    );
                  })()}
                </View>

                {/* Utility Control Panel */}
                <View style={styles.utilityControls}>
                  <Pressable
                    disabled={isAllSetsCompleted}
                    onPress={handlePlayPause}
                    style={({ pressed }) => [
                      styles.utilityBtn,
                      { backgroundColor: theme.backgroundElement },
                      isAllSetsCompleted && { opacity: 0.5 },
                      pressed && !isAllSetsCompleted && styles.pressed,
                    ]}>
                    <SymbolView
                      name={
                        isRunning
                          ? { ios: 'pause.fill', android: 'pause', web: 'pause' }
                          : { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }
                      }
                      size={18}
                      tintColor={theme.text}
                    />
                    <ThemedText type="smallBold">
                      {isRunning ? 'Pausar' : 'Reanudar'}
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setShowResetOptions((prev) => !prev)}
                    style={({ pressed }) => [
                      styles.utilityBtn,
                      { backgroundColor: theme.backgroundElement },
                      showResetOptions && { borderColor: '#3c87f7', borderWidth: 1.5 },
                      pressed && styles.pressed,
                    ]}>
                    <SymbolView
                      name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                      size={18}
                      tintColor={theme.text}
                    />
                    <ThemedText type="smallBold">
                      Reiniciar
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={handleFinishExercise}
                    style={({ pressed }) => [
                      styles.utilityBtn,
                      { backgroundColor: 'rgba(52, 199, 89, 0.15)', borderColor: '#34c759' },
                      pressed && styles.pressed,
                    ]}>
                    <SymbolView
                      name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                      size={18}
                      tintColor="#34c759"
                    />
                    <ThemedText type="smallBold" style={{ color: '#34c759' }}>
                      Finalizado
                    </ThemedText>
                  </Pressable>
                </View>

                {/* Collapsible Reset Settings panel */}
                {showResetOptions && (
                  <ThemedView type="backgroundElement" style={styles.resetOptionsCard}>
                    <ThemedText type="smallBold" style={{ marginBottom: Spacing.two }}>
                      Configuración de Reinicio
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
                      Modifica desde qué serie/repetición deseas comenzar el ejercicio de nuevo.
                    </ThemedText>

                    <View style={styles.resetSettingsRow}>
                      <View style={styles.resetField}>
                        <ThemedText type="code" themeColor="textSecondary">
                          SERIE DE INICIO
                        </ThemedText>
                        <View style={styles.counterRow}>
                          <Pressable
                            onPress={() => handleResetSetChange(resetSet - 1)}
                            style={[styles.counterBtn, { backgroundColor: theme.background }]}>
                            <ThemedText type="smallBold">-</ThemedText>
                          </Pressable>
                          <ThemedText type="smallBold" style={styles.counterValue}>
                            {resetSet}
                          </ThemedText>
                          <Pressable
                            onPress={() => handleResetSetChange(resetSet + 1)}
                            style={[styles.counterBtn, { backgroundColor: theme.background }]}>
                            <ThemedText type="smallBold">+</ThemedText>
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.resetField}>
                        <ThemedText type="code" themeColor="textSecondary">
                          REPETICIONES
                        </ThemedText>
                        <View style={styles.counterRow}>
                          <Pressable
                            onPress={() => setResetReps((prev) => Math.max(1, prev - 1))}
                            style={[styles.counterBtn, { backgroundColor: theme.background }]}>
                            <ThemedText type="smallBold">-</ThemedText>
                          </Pressable>
                          <ThemedText type="smallBold" style={styles.counterValue}>
                            {resetReps}
                          </ThemedText>
                          <Pressable
                            onPress={() => setResetReps((prev) => Math.min(100, prev + 1))}
                            style={[styles.counterBtn, { backgroundColor: theme.background }]}>
                            <ThemedText type="smallBold">+</ThemedText>
                          </Pressable>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      onPress={handleCustomReset}
                      style={({ pressed }) => [
                        styles.executeResetBtn,
                        { backgroundColor: theme.text },
                        pressed && styles.pressed,
                      ]}>
                      <SymbolView
                        name={{ ios: 'arrow.clockwise.circle.fill', android: 'refresh', web: 'refresh' }}
                        size={16}
                        tintColor={theme.background}
                      />
                      <ThemedText type="smallBold" style={{ color: theme.background }}>
                        Aplicar Reinicio Personalizado
                      </ThemedText>
                    </Pressable>
                  </ThemedView>
                )}

                {/* Bottom Navigation (Prev / Next exercise shortcuts) */}
                <View style={styles.prevNextRow}>
                  <Pressable
                    disabled={activeIndex === 0}
                    onPress={() => handleSelectExercise(activeIndex - 1)}
                    style={({ pressed }) => [
                      styles.prevNextBtn,
                      activeIndex === 0 && styles.disabled,
                      pressed && styles.pressed,
                    ]}>
                    <SymbolView
                      name={{ ios: 'arrow.left', android: 'arrow_back', web: 'arrow_back' }}
                      size={18}
                      tintColor={theme.text}
                    />
                    <ThemedText type="smallBold">Anterior</ThemedText>
                  </Pressable>

                  <ThemedText type="code" themeColor="textSecondary">
                    Ej. {activeIndex + 1} de {sessionExercises.length}
                  </ThemedText>

                  <Pressable
                    disabled={activeIndex === sessionExercises.length - 1}
                    onPress={() => handleSelectExercise(activeIndex + 1)}
                    style={({ pressed }) => [
                      styles.prevNextBtn,
                      activeIndex === sessionExercises.length - 1 && styles.disabled,
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold">Siguiente</ThemedText>
                    <SymbolView
                      name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
                      size={18}
                      tintColor={theme.text}
                    />
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.bottomSpacer} />
          </ScrollView>
        </View>

        {/* Mobile Exercise Drawer (Collapsible list) */}
        <Modal
          visible={isExerciseListOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setIsExerciseListOpen(false)}>
          <View style={styles.drawerOverlay}>
            <ThemedView type="backgroundElement" style={styles.drawerContent}>
              <View style={styles.drawerHeader}>
                <View>
                  <ThemedText type="smallBold" style={styles.drawerTitle}>
                    Ejercicios del Día
                  </ThemedText>
                  <ThemedText type="code" themeColor="textSecondary">
                    Selecciona uno para cambiar de ejercicio
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => setIsExerciseListOpen(false)}
                  style={({ pressed }) => [styles.closeDrawerBtn, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.drawerScroll}>
                {sessionExercises.map((item, idx) => renderExerciseListItem(item, idx))}
              </ScrollView>
            </ThemedView>
          </View>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: 960,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  emptyTitle: {
    fontSize: 20,
    marginTop: Spacing.three,
    marginBottom: Spacing.one,
  },
  emptySubtitle: {
    textAlign: 'center',
    marginBottom: Spacing.four,
    maxWidth: 320,
  },
  backBtnLarge: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: 99,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  backBtn: {
    padding: Spacing.one,
  },
  listBtn: {
    padding: Spacing.one,
  },
  headerTitleContainer: {
    flex: 1,
    marginHorizontal: Spacing.two,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  layoutRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // Responsive Tablet panel
  sidebarPanel: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(128,128,128,0.2)',
  },
  sidebarHeader: {
    padding: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
    gap: Spacing.half,
  },
  sidebarScroll: {
    padding: Spacing.two,
    gap: Spacing.one,
  },
  // Main Panel scroll
  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  activeContainer: {
    gap: Spacing.three,
  },
  // Exercise info Card
  exerciseCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one + Spacing.half,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    flex: 1,
    marginRight: Spacing.two,
  },
  muscleBadge: {
    backgroundColor: 'rgba(60, 135, 247, 0.12)',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  videoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 69, 58, 0.08)',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    gap: Spacing.one,
  },
  exerciseNameText: {
    fontSize: 24,
    fontWeight: 'bold',
    lineHeight: 30,
  },
  exerciseObjectiveText: {
    fontSize: 14,
  },
  // Double Timers Display
  timersContainer: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  timerCard: {
    flex: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: Spacing.half,
  },
  activeTimerBorder: {
    borderColor: '#3c87f7',
  },
  activeRestBorder: {
    borderColor: '#ff9500',
  },
  timerCardLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  timerNumber: {
    fontSize: 34,
    fontWeight: 'bold',
    lineHeight: 40,
    fontFamily: Platform.select({ ios: 'CourierNewPS-BoldMT', android: 'monospace', web: 'monospace' }),
  },
  timerIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginTop: Spacing.half,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.15)',
  },
  // Series checklist
  seriesSection: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  seriesGrid: {
    gap: Spacing.one + Spacing.half,
  },
  seriesItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(128,128,128,0.06)',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  seriesItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  setCheckCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(128,128,128,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  seriesItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  activeSetBadge: {
    backgroundColor: '#3c87f7',
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
  },
  activeSetBadgeText: {
    fontSize: 8,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  repsCounterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  repsCounterBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(128,128,128,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  repsCounterBtnPressed: {
    opacity: 0.6,
  },
  repsCounterValue: {
    fontSize: 14,
    fontWeight: 'bold',
    minWidth: 20,
    textAlign: 'center',
  },
  // Action Buttons
  primaryActions: {
    marginTop: Spacing.one,
  },
  mainActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    height: 56,
  },
  mainActionButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  twoButtonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
  },
  halfActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one + Spacing.half,
    height: 56,
  },
  actionButtonTextWhite: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  utilityControls: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  utilityBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
    gap: Spacing.one + Spacing.half,
    height: 48,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  // Reset Config card
  resetOptionsCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.2)',
  },
  resetSettingsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  resetField: {
    flex: 1,
    gap: Spacing.one,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  counterValue: {
    minWidth: 28,
    textAlign: 'center',
    fontSize: 16,
  },
  executeResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  // Prev / Next Navigation footer
  prevNextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.two,
    paddingVertical: Spacing.one,
  },
  prevNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    padding: Spacing.two,
  },
  // Mobile drawer Modal
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  drawerContent: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    maxHeight: '80%',
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
    paddingBottom: Spacing.two,
    marginBottom: Spacing.two,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeDrawerBtn: {
    padding: Spacing.half,
  },
  drawerScroll: {
    gap: Spacing.one,
    paddingBottom: Spacing.four,
  },
  drawerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  drawerItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flex: 1,
  },
  drawerItemName: {
    fontSize: 15,
  },
  // Shared styles
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.3,
  },
  bottomSpacer: {
    height: 80,
  },
});
