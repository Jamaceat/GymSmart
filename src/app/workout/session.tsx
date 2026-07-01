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
  TextInput,
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
  getExercises,
  getExerciseById,
  MetaGroup,
  ExerciseGroup,
  Exercise,
  insertExerciseCompletionAudit,
} from '@/database/database';
import { useAlert } from '@/components/ui/alert-provider';

interface SessionExercise {
  uniqueId: string; // `${metaGroupItemId}-${exercise.id}` or `adhoc-${timestamp}-${exercise.id}`
  exercise: Exercise;
  groupName: string;
  metaGroupItemId: number;
  isAdhoc?: boolean;
}

interface AdhocExerciseInfo {
  uniqueId: string;
  exerciseId: number;
  groupName: string;
  metaGroupItemId?: number;
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

function getNextSetToComplete(completed: Set<number>, seriesConfig: { set: number; reps: number }[]): number {
  for (const item of seriesConfig) {
    if (!completed.has(item.set)) return item.set;
  }
  return seriesConfig.length > 0 ? seriesConfig[seriesConfig.length - 1].set : 1;
}

export default function WorkoutSessionScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { alert } = useAlert();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  // Search parameters
  const { metaGroupId, date, scheduledRoutineId } = useLocalSearchParams<{
    metaGroupId: string;
    date: string;
    scheduledRoutineId?: string;
  }>();

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
  const [allCompletedSets, setAllCompletedSets] = useState<Record<string, number[]>>({});
  const [allSetTimes, setAllSetTimes] = useState<Record<string, Record<number, number>>>({});
  const [currentSet, setCurrentSet] = useState<number>(1);
  const [customReps, setCustomReps] = useState<Record<string, Record<number, number>>>({});
  const [customWeights, setCustomWeights] = useState<Record<string, Record<number, number>>>({});
  const [expandedSets, setExpandedSets] = useState<Record<number, boolean>>({});
  const [extraSetsPerExercise, setExtraSetsPerExercise] = useState<Record<string, number>>({});
  const [deletedSetsPerExercise, setDeletedSetsPerExercise] = useState<Record<string, number[]>>({});

  // Add exercise to session modal state
  const [isAddExerciseOpen, setIsAddExerciseOpen] = useState(false);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState('');

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
  const skipNextActiveIndexReset = React.useRef(false);
  const lastActiveIndex = React.useRef<number | null>(null);

  // Ref keeping latest state values to avoid stale closures in unmount cleanup
  const stateRef = React.useRef({
    activeIndex,
    activeSeconds,
    restSeconds,
    isResting,
    currentSet,
    allCompletedSets,
    completedExercises,
    allSetTimes,
    customReps,
    customWeights,
    extraSetsPerExercise,
    deletedSetsPerExercise,
    adhocExerciseInfos: [] as AdhocExerciseInfo[],
  });

  useEffect(() => {
    stateRef.current = {
      activeIndex,
      activeSeconds,
      restSeconds,
      isResting,
      currentSet,
      allCompletedSets,
      completedExercises,
      allSetTimes,
      customReps,
      customWeights,
      extraSetsPerExercise,
      deletedSetsPerExercise,
      adhocExerciseInfos: sessionExercises
        .filter(e => e.isAdhoc)
        .map(e => ({ uniqueId: e.uniqueId, exerciseId: e.exercise.id!, groupName: e.groupName, metaGroupItemId: e.metaGroupItemId })),
    };
  }, [activeIndex, activeSeconds, restSeconds, isResting, currentSet, allCompletedSets, completedExercises, allSetTimes, customReps, customWeights, extraSetsPerExercise, deletedSetsPerExercise, sessionExercises]);

  // Flattened active exercise helper
  const activeSessionItem = sessionExercises[activeIndex] || null;
  const activeExercise = activeSessionItem?.exercise || null;

  // Derived Completed Sets and Set Times for the active exercise
  const completedSets = useMemo(() => {
    if (!activeSessionItem) return new Set<number>();
    return new Set(allCompletedSets[activeSessionItem.uniqueId] || []);
  }, [allCompletedSets, activeSessionItem]);

  const setTimes = useMemo(() => {
    if (!activeSessionItem) return {};
    return allSetTimes[activeSessionItem.uniqueId] || {};
  }, [allSetTimes, activeSessionItem]);

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
      doneSetsMap: Record<string, number[]>,
      doneExs: Set<string>,
      timesMap?: Record<string, Record<number, number>>,
      customRepsMap?: Record<string, Record<number, number>>,
      customWeightsMap?: Record<string, Record<number, number>>,
      extraSetsOverride?: Record<string, number>,
      adhocInfosOverride?: AdhocExerciseInfo[],
      deletedSetsOverride?: Record<string, number[]>
    ) => {
      try {
        const doneSetsStr = JSON.stringify(doneSetsMap);
        const doneExsStr = Array.from(doneExs).join(',');
        const currentTimes = timesMap || stateRef.current.allSetTimes || {};
        const setTimesStr = JSON.stringify(currentTimes);
        const currentCustomReps = customRepsMap || stateRef.current.customReps || {};
        const customRepsStr = JSON.stringify(currentCustomReps);
        const currentCustomWeights = customWeightsMap || stateRef.current.customWeights || {};
        const customWeightsStr = JSON.stringify(currentCustomWeights);
        const currentExtraSets = extraSetsOverride ?? stateRef.current.extraSetsPerExercise ?? {};
        const extraSetsStr = JSON.stringify(currentExtraSets);
        const currentAdhocInfos = adhocInfosOverride ?? stateRef.current.adhocExerciseInfos ?? [];
        const adhocExsStr = JSON.stringify(currentAdhocInfos);
        const currentDeletedSets = deletedSetsOverride ?? stateRef.current.deletedSetsPerExercise ?? {};
        const deletedSetsStr = JSON.stringify(currentDeletedSets);
        const schedId = scheduledRoutineId ? parseInt(scheduledRoutineId, 10) : 0;
        await db.runAsync(
          `INSERT OR REPLACE INTO session_progress
            (meta_group_id, scheduled_date, scheduled_routine_id, active_index, active_seconds, rest_seconds, is_resting, current_set, completed_sets, completed_exercises, set_times, custom_reps, custom_weights, extra_sets, adhoc_exercises, deleted_sets)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            parseInt(metaGroupId!, 10),
            date,
            schedId,
            idx,
            activeSecs,
            restSecs,
            resting ? 1 : 0,
            currSet,
            doneSetsStr,
            doneExsStr,
            setTimesStr,
            customRepsStr,
            customWeightsStr,
            extraSetsStr,
            adhocExsStr,
            deletedSetsStr,
          ]
        );
      } catch (e) {
        console.error('Error saving session progress:', e);
      }
    },
    [db, metaGroupId, date, scheduledRoutineId]
  );

  // Clear progress callback
  const clearSessionProgress = useCallback(async () => {
    try {
      const schedId = scheduledRoutineId ? parseInt(scheduledRoutineId, 10) : 0;
      if (schedId > 0) {
        await db.runAsync(
          'DELETE FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ? AND scheduled_routine_id = ?',
          [parseInt(metaGroupId!, 10), date, schedId]
        );
      } else {
        await db.runAsync(
          'DELETE FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ? AND (scheduled_routine_id IS NULL OR scheduled_routine_id = 0)',
          [parseInt(metaGroupId!, 10), date]
        );
      }
    } catch (e) {
      console.error('Error clearing session progress:', e);
    }
  }, [db, metaGroupId, date, scheduledRoutineId]);

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

            // Fetch progress from database (before setSessionExercises so we can include adhoc)
            const schedId = scheduledRoutineId ? parseInt(scheduledRoutineId, 10) : 0;
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
              custom_weights: string | null;
              extra_sets: string | null;
              adhoc_exercises: string | null;
              deleted_sets: string | null;
            }>(
              schedId > 0
                ? 'SELECT * FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ? AND scheduled_routine_id = ?'
                : 'SELECT * FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ? AND (scheduled_routine_id IS NULL OR scheduled_routine_id = 0)',
              schedId > 0
                ? [mGroupId, date, schedId]
                : [mGroupId, date]
            );

            if (progress) {
              // Bypass activeIndex change reset during initial DB restoration
              skipNextActiveIndexReset.current = true;
              lastActiveIndex.current = progress.active_index;

              setActiveIndex(progress.active_index);
              setActiveSeconds(progress.active_seconds);
              setRestSeconds(progress.rest_seconds);
              setIsResting(progress.is_resting === 1);
              setCurrentSet(progress.current_set);
              
              if (progress.completed_sets) {
                try {
                  const parsed = JSON.parse(progress.completed_sets);
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    setAllCompletedSets(parsed);
                  } else {
                    const sets = progress.completed_sets.split(',').map(Number).filter(Boolean);
                    const activeEx = flattened[progress.active_index];
                    if (activeEx) {
                      setAllCompletedSets({ [activeEx.uniqueId]: sets });
                    } else {
                      setAllCompletedSets({});
                    }
                  }
                } catch (e) {
                  const sets = progress.completed_sets.split(',').map(Number).filter(Boolean);
                  const activeEx = flattened[progress.active_index];
                  if (activeEx) {
                    setAllCompletedSets({ [activeEx.uniqueId]: sets });
                  } else {
                    setAllCompletedSets({});
                  }
                }
              } else {
                setAllCompletedSets({});
              }

              if (progress.completed_exercises) {
                const exs = progress.completed_exercises.split(',').filter(Boolean);
                setCompletedExercises(new Set(exs));
              } else {
                setCompletedExercises(new Set());
              }

              if (progress.set_times) {
                try {
                  const parsed = JSON.parse(progress.set_times);
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const keys = Object.keys(parsed);
                    if (keys.length > 0 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null) {
                      setAllSetTimes(parsed);
                    } else {
                      const activeEx = flattened[progress.active_index];
                      if (activeEx) {
                        setAllSetTimes({ [activeEx.uniqueId]: parsed });
                      } else {
                        setAllSetTimes({});
                      }
                    }
                  } else {
                    setAllSetTimes({});
                  }
                } catch (e) {
                  setAllSetTimes({});
                }
              } else {
                setAllSetTimes({});
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

              if (progress.custom_weights) {
                try {
                  setCustomWeights(JSON.parse(progress.custom_weights));
                } catch (e) {
                  setCustomWeights({});
                }
              } else {
                setCustomWeights({});
              }

              if (progress.extra_sets) {
                try {
                  setExtraSetsPerExercise(JSON.parse(progress.extra_sets));
                } catch (e) {
                  setExtraSetsPerExercise({});
                }
              } else {
                setExtraSetsPerExercise({});
              }

              if (progress.deleted_sets) {
                try {
                  setDeletedSetsPerExercise(JSON.parse(progress.deleted_sets));
                } catch (e) {
                  setDeletedSetsPerExercise({});
                }
              } else {
                setDeletedSetsPerExercise({});
              }

              // Restore adhoc exercises and append them to the flat list
              if (progress.adhoc_exercises) {
                try {
                  const adhocInfos = JSON.parse(progress.adhoc_exercises) as AdhocExerciseInfo[];
                  for (const info of adhocInfos) {
                    const exercise = await getExerciseById(db, info.exerciseId);
                    if (exercise) {
                      // Sessions saved before metaGroupItemId existed encode the timestamp in the uniqueId
                      const parsedTs = Number(info.uniqueId.split('-')[1]);
                      flattened.push({
                        uniqueId: info.uniqueId,
                        exercise,
                        groupName: info.groupName,
                        metaGroupItemId: info.metaGroupItemId ?? (Number.isFinite(parsedTs) && parsedTs > 0 ? -parsedTs : 0),
                        isAdhoc: true,
                      });
                    }
                  }
                } catch (e) {
                  // ignore parse error
                }
              }
            } else {
              setActiveIndex(0);
              setCompletedExercises(new Set());
              setCustomReps({});
              setCustomWeights({});
              setAllCompletedSets({});
              setAllSetTimes({});
              setCurrentSet(1);
              setActiveSeconds(0);
              setRestSeconds(0);
              setIsResting(false);
              setIsRunning(false);
              setExtraSetsPerExercise({});
              setDeletedSetsPerExercise({});
            }

            setSessionExercises(flattened);
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
  }, [db, metaGroupId, date, scheduledRoutineId, alert]);

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
          s.allCompletedSets,
          s.completedExercises,
          s.allSetTimes
        );
      }
    };
  }, [saveProgress, sessionExercises.length]);

  // Build the full series config for any session item, including ad-hoc extra sets
  const buildSeriesConfig = useCallback((
    item: SessionExercise,
    extrasMap: Record<string, number>,
    deletedMap: Record<string, number[]> = {}
  ): { set: number; reps: number }[] => {
    const ex = item.exercise;
    let base: { set: number; reps: number }[] = [];
    if (ex.is_constant === 1) {
      base = Array.from({ length: ex.default_sets }, (_, i) => ({ set: i + 1, reps: ex.default_reps }));
    } else if (ex.series_config) {
      try {
        base = JSON.parse(ex.series_config) as { set: number; reps: number }[];
      } catch (e) {
        console.error('Failed to parse series_config:', e);
      }
    }
    const extras = extrasMap[item.uniqueId] || 0;
    if (extras > 0) {
      const lastReps = base.length > 0 ? base[base.length - 1].reps : (ex.default_reps || 10);
      for (let i = 0; i < extras; i++) {
        base.push({ set: base.length + 1, reps: lastReps });
      }
    }
    const deleted = new Set(deletedMap[item.uniqueId] || []);
    if (deleted.size > 0) {
      base = base.filter(s => !deleted.has(s.set));
    }
    return base;
  }, []);

  // Rewrite the audit rows for one exercise instance (delete-then-insert keeps it idempotent)
  const auditExerciseCompletion = useCallback(async (
    sessionItem: SessionExercise,
    setsToAudit: number[],
    auditTimes: Record<number, number>,
    repsMap: Record<string, Record<number, number>>,
    weightsMap: Record<string, Record<number, number>>,
    extrasMap: Record<string, number>,
    deletedMap: Record<string, number[]>
  ) => {
    try {
      const auditDate = date || new Date().toISOString().split('T')[0];
      const routineName = metaGroup?.name || 'Rutina sin nombre';
      const routineId = parseInt(metaGroupId!, 10);
      const schedId = scheduledRoutineId && parseInt(scheduledRoutineId, 10) > 0 ? parseInt(scheduledRoutineId, 10) : null;
      const ex = sessionItem.exercise;

      // Delete previous audits for this exercise instance only. The unscheduled branch must
      // not touch audits that belong to scheduled sessions of the same routine and date.
      const exerciseClause = ex.id ? 'exercise_id = ?' : 'exercise_name = ?';
      const exerciseKey = ex.id ?? ex.name;
      if (schedId) {
        await db.runAsync(
          `DELETE FROM exercise_completion_audits WHERE ${exerciseClause} AND scheduled_routine_id = ? AND meta_group_item_id = ?`,
          [exerciseKey, schedId, sessionItem.metaGroupItemId]
        );
      } else {
        await db.runAsync(
          `DELETE FROM exercise_completion_audits
           WHERE ${exerciseClause} AND routine_id = ? AND completed_date = ? AND meta_group_item_id = ?
             AND (scheduled_routine_id IS NULL OR scheduled_routine_id = 0)`,
          [exerciseKey, routineId, auditDate, sessionItem.metaGroupItemId]
        );
      }

      // Reps per set exactly as the session shows them (includes extra sets, excludes deleted ones)
      const seriesReps: Record<number, number> = {};
      for (const item of buildSeriesConfig(sessionItem, extrasMap, deletedMap)) {
        seriesReps[item.set] = item.reps;
      }

      for (const setNum of setsToAudit) {
        const reps = repsMap[sessionItem.uniqueId]?.[setNum] ?? seriesReps[setNum] ?? ex.default_reps ?? 10;
        const weight = weightsMap[sessionItem.uniqueId]?.[setNum] ?? ex.weight ?? null;
        const secs = auditTimes[setNum] ?? 0;
        await insertExerciseCompletionAudit(db, {
          exercise_id: ex.id || null,
          exercise_name: ex.name,
          set_index: setNum,
          repetitions: reps,
          weight,
          seconds_taken: secs,
          routine_id: routineId,
          routine_name: routineName,
          completed_date: auditDate,
          group_name: sessionItem.groupName,
          meta_group_item_id: sessionItem.metaGroupItemId,
          scheduled_routine_id: schedId,
        });
      }
    } catch (e) {
      console.error('Error saving exercise audit:', e);
    }
  }, [db, date, metaGroup, metaGroupId, scheduledRoutineId, buildSeriesConfig]);

  // Parse exercise series config (active exercise + extra sets - deleted sets)
  const parsedSeriesConfig = useMemo(() => {
    if (!activeSessionItem) return [];
    return buildSeriesConfig(activeSessionItem, extraSetsPerExercise, deletedSetsPerExercise);
  }, [activeSessionItem, extraSetsPerExercise, deletedSetsPerExercise, buildSeriesConfig]);

  const isAllSetsCompleted = useMemo(() => {
    return parsedSeriesConfig.length > 0 && parsedSeriesConfig.every(s => completedSets.has(s.set));
  }, [completedSets, parsedSeriesConfig]);

  // Update default reset values when active exercise or series changes
  useEffect(() => {
    if (!isLoadedFromDb.current) return;

    if (lastActiveIndex.current === null) {
      lastActiveIndex.current = activeIndex;
      return;
    }

    if (skipNextActiveIndexReset.current) {
      skipNextActiveIndexReset.current = false;
      lastActiveIndex.current = activeIndex;
      return;
    }

    if (activeIndex !== lastActiveIndex.current) {
      lastActiveIndex.current = activeIndex;

      if (activeExercise && activeSessionItem) {
        const itemCompletedSets = new Set(allCompletedSets[activeSessionItem.uniqueId] || []);
        const nextSet = getNextSetToComplete(itemCompletedSets, parsedSeriesConfig);

        setCurrentSet(nextSet);
        setExpandedSets({});
        setResetSet(nextSet);
        const initialReps = parsedSeriesConfig.find(s => s.set === nextSet)?.reps ?? activeExercise.default_reps ?? 10;
        setResetReps(initialReps);
        
        // Stop timers when switching exercises
        setIsRunning(false);
        setIsResting(false);
        setActiveSeconds(0);
        setRestSeconds(0);
        setShowResetOptions(false);
      }
    }
  }, [activeIndex, activeExercise, parsedSeriesConfig, allCompletedSets, activeSessionItem]);

  // Handle manual/programmatic exercise selection with reset & save
  const handleSelectExercise = (idx: number) => {
    setActiveIndex(idx);
    setIsExerciseListOpen(false);
    
    // Reset timers & tracking state locally
    setIsResting(false);
    setIsRunning(false);
    setActiveSeconds(0);
    setRestSeconds(0);
    setShowResetOptions(false);

    const targetSessionItem = sessionExercises[idx];
    const targetCompletedSetsArray = targetSessionItem ? (allCompletedSets[targetSessionItem.uniqueId] || []) : [];
    const targetCompletedSets = new Set(targetCompletedSetsArray);
    const targetSeriesConfig = targetSessionItem ? buildSeriesConfig(targetSessionItem, extraSetsPerExercise, deletedSetsPerExercise) : [];
    const nextSet = getNextSetToComplete(targetCompletedSets, targetSeriesConfig);

    setCurrentSet(nextSet);

    saveProgress(
      idx,
      0, // activeSeconds
      0, // restSeconds
      false, // isResting
      nextSet, // currentSet
      allCompletedSets,
      completedExercises,
      allSetTimes
    );
  };

  // Navigate to adjacent set in reset config (target is the raw +1/-1 of current resetSet)
  const handleResetSetChange = (targetSetNum: number) => {
    const currentIdx = parsedSeriesConfig.findIndex(s => s.set === resetSet);
    const newIdx = targetSetNum > resetSet
      ? Math.min(parsedSeriesConfig.length - 1, currentIdx + 1)
      : Math.max(0, currentIdx - 1);
    const setConfig = parsedSeriesConfig[newIdx];
    if (setConfig) {
      setResetSet(setConfig.set);
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
      allCompletedSets,
      completedExercises,
      allSetTimes,
      updatedCustomReps
    );

    // Keep the audit in sync when editing an already-finished exercise
    if (completedExercises.has(uniqueId)) {
      auditExerciseCompletion(
        activeSessionItem,
        allCompletedSets[uniqueId] || [],
        allSetTimes[uniqueId] || {},
        updatedCustomReps,
        customWeights,
        extraSetsPerExercise,
        deletedSetsPerExercise
      );
    }
  };

  // Update specific set weight during session
  const handleUpdateWeight = (setNum: number, newWeight: number) => {
    if (!activeSessionItem) return;
    const uniqueId = activeSessionItem.uniqueId;
    const updatedCustomWeights = {
      ...customWeights,
      [uniqueId]: {
        ...(customWeights[uniqueId] || {}),
        [setNum]: newWeight,
      },
    };
    setCustomWeights(updatedCustomWeights);
    saveProgress(
      activeIndex,
      activeSeconds,
      restSeconds,
      isResting,
      currentSet,
      allCompletedSets,
      completedExercises,
      allSetTimes,
      customReps,
      updatedCustomWeights
    );

    // Keep the audit in sync when editing an already-finished exercise
    if (completedExercises.has(uniqueId)) {
      auditExerciseCompletion(
        activeSessionItem,
        allCompletedSets[uniqueId] || [],
        allSetTimes[uniqueId] || {},
        customReps,
        updatedCustomWeights,
        extraSetsPerExercise,
        deletedSetsPerExercise
      );
    }
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
      allCompletedSets,
      completedExercises,
      allSetTimes
    );
  };

  // Finish current set, check it off, and trigger rest timer
  const handleFinishSet = () => {
    const nextCompletedSets = new Set(completedSets);
    nextCompletedSets.add(currentSet);

    const isAllCompleted = parsedSeriesConfig.every(s => nextCompletedSets.has(s.set));

    const currentSetIdx = parsedSeriesConfig.findIndex(s => s.set === currentSet);
    const nextSetConfig = parsedSeriesConfig[currentSetIdx + 1];
    let nextSet = currentSet;
    if (!isAllCompleted && nextSetConfig) {
      nextSet = nextSetConfig.set;
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

    const updatedAllCompletedSets = {
      ...allCompletedSets,
      [activeSessionItem.uniqueId]: Array.from(nextCompletedSets)
    };

    const updatedAllSetTimes = {
      ...allSetTimes,
      [activeSessionItem.uniqueId]: nextSetTimes
    };

    setAllCompletedSets(updatedAllCompletedSets);
    setAllSetTimes(updatedAllSetTimes);

    saveProgress(
      activeIndex,
      activeSeconds,
      0, // rest seconds reset
      !isAllCompleted, // isResting
      nextSet,
      updatedAllCompletedSets,
      completedExercises,
      updatedAllSetTimes
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
      allCompletedSets,
      completedExercises,
      allSetTimes
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
    
    // Clear completed sets from the resetSet position onwards (gap-aware)
    const nextCompletedSets = new Set(completedSets);
    const nextSetTimes = { ...setTimes };
    const resetSetIdx = parsedSeriesConfig.findIndex(s => s.set === resetSet);
    for (let i = resetSetIdx; i < parsedSeriesConfig.length; i++) {
      nextCompletedSets.delete(parsedSeriesConfig[i].set);
      delete nextSetTimes[parsedSeriesConfig[i].set];
    }

    const updatedAllCompletedSets = {
      ...allCompletedSets,
      [activeSessionItem.uniqueId]: Array.from(nextCompletedSets)
    };

    const updatedAllSetTimes = {
      ...allSetTimes,
      [activeSessionItem.uniqueId]: nextSetTimes
    };

    setAllCompletedSets(updatedAllCompletedSets);
    setAllSetTimes(updatedAllSetTimes);

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
      updatedAllCompletedSets,
      completedExercises,
      updatedAllSetTimes,
      updatedCustomReps,
      customWeights
    );

    // Keep the audit in sync when resetting an already-finished exercise
    if (completedExercises.has(uniqueId)) {
      auditExerciseCompletion(
        activeSessionItem,
        Array.from(nextCompletedSets),
        nextSetTimes,
        updatedCustomReps,
        customWeights,
        extraSetsPerExercise,
        deletedSetsPerExercise
      );
    }

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

    // Snapshot state for auditing to prevent state race conditions
    const auditPromise = auditExerciseCompletion(
      activeSessionItem,
      Array.from(completedSets),
      { ...setTimes },
      customReps,
      customWeights,
      extraSetsPerExercise,
      deletedSetsPerExercise
    );

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

        // Mark routine as completed once the last audit is persisted
        const schedId = scheduledRoutineId ? parseInt(scheduledRoutineId, 10) : 0;
        const markRoutineCompleted = async () => {
          if (schedId > 0) {
            await db.runAsync('UPDATE scheduled_routines SET is_completed = 1 WHERE id = ?', [schedId]);
            return;
          }
          if (!date) return;
          const mgId = parseInt(metaGroupId!, 10);
          // Mark a single pending instance, not every instance scheduled for the day
          const updated = await db.runAsync(
            `UPDATE scheduled_routines SET is_completed = 1
             WHERE id = (
               SELECT id FROM scheduled_routines
               WHERE meta_group_id = ? AND scheduled_date = ? AND is_completed = 0
               ORDER BY id LIMIT 1
             )`,
            [mgId, date]
          );
          if (updated.changes === 0) {
            const existing = await db.getFirstAsync<{ id: number }>(
              'SELECT id FROM scheduled_routines WHERE meta_group_id = ? AND scheduled_date = ? LIMIT 1',
              [mgId, date]
            );
            if (!existing) {
              // Unscheduled session: create its completed row so stats count it, and link its audits
              const inserted = await db.runAsync(
                'INSERT INTO scheduled_routines (meta_group_id, scheduled_date, is_completed) VALUES (?, ?, 1)',
                [mgId, date]
              );
              await db.runAsync(
                `UPDATE exercise_completion_audits SET scheduled_routine_id = ?
                 WHERE routine_id = ? AND completed_date = ?
                   AND (scheduled_routine_id IS NULL OR scheduled_routine_id = 0)`,
                [inserted.lastInsertRowId, mgId, date]
              );
            }
          }
        };
        auditPromise
          .then(markRoutineCompleted)
          .catch(err => console.error('Error marking scheduled routine as completed:', err));

        alert(
          '¡Entrenamiento Terminado!',
          'Has completado todos los ejercicios de la rutina programada. ¡Buen trabajo!',
          [{ text: 'Finalizar', onPress: () => router.back() }]
        );
        return;
      }
    }

    // Determine next set for the next active exercise
    const nextSessionItem = sessionExercises[nextIdx];
    const nextCompletedSetsArray = nextSessionItem ? (allCompletedSets[nextSessionItem.uniqueId] || []) : [];
    const nextCompletedSets = new Set(nextCompletedSetsArray);
    const nextSeriesConfig = nextSessionItem ? buildSeriesConfig(nextSessionItem, extraSetsPerExercise, deletedSetsPerExercise) : [];
    const nextSet = getNextSetToComplete(nextCompletedSets, nextSeriesConfig);

    setCurrentSet(nextSet);

    saveProgress(
      nextIdx,
      0, // activeSeconds
      0, // restSeconds
      false, // isResting
      nextSet, // currentSet
      allCompletedSets,
      nextCompletedExercises,
      allSetTimes
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

    const updatedAllCompletedSets = {
      ...allCompletedSets,
      [activeSessionItem.uniqueId]: Array.from(nextCompletedSets)
    };

    const updatedAllSetTimes = {
      ...allSetTimes,
      [activeSessionItem.uniqueId]: nextSetTimes
    };

    setAllCompletedSets(updatedAllCompletedSets);
    setAllSetTimes(updatedAllSetTimes);
    setCurrentSet(setNum);

    const isAllCompleted = parsedSeriesConfig.every(s => nextCompletedSets.has(s.set));
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
      updatedAllCompletedSets,
      completedExercises,
      updatedAllSetTimes
    );

    // Keep the audit in sync when toggling sets of an already-finished exercise
    if (completedExercises.has(activeSessionItem.uniqueId)) {
      auditExerciseCompletion(
        activeSessionItem,
        updatedAllCompletedSets[activeSessionItem.uniqueId] || [],
        updatedAllSetTimes[activeSessionItem.uniqueId] || {},
        customReps,
        customWeights,
        extraSetsPerExercise,
        deletedSetsPerExercise
      );
    }
  };

  // Open exercise video helper
  const handleOpenVideo = (url: string | null) => {
    if (!url) return;
    Linking.openURL(url).catch(() => {
      alert('Error', 'No se pudo abrir el video en este dispositivo.');
    });
  };

  // Add an extra set to the current exercise during the session
  const handleAddExtraSet = () => {
    if (!activeSessionItem) return;
    const uniqueId = activeSessionItem.uniqueId;
    const newExtras = { ...extraSetsPerExercise, [uniqueId]: (extraSetsPerExercise[uniqueId] || 0) + 1 };
    stateRef.current.extraSetsPerExercise = newExtras;
    setExtraSetsPerExercise(newExtras);
    saveProgress(
      activeIndex, activeSeconds, restSeconds, isResting, currentSet,
      allCompletedSets, completedExercises, allSetTimes, customReps, customWeights, newExtras
    );
  };

  // Delete a set from the current exercise during the session
  const handleDeleteSet = (setNum: number) => {
    if (!activeSessionItem) return;
    const uniqueId = activeSessionItem.uniqueId;

    // Register the set as deleted
    const currentDeleted = deletedSetsPerExercise[uniqueId] || [];
    const newDeleted = { ...deletedSetsPerExercise, [uniqueId]: [...currentDeleted, setNum] };

    // Remove from completedSets
    const newAllCompletedSets = { ...allCompletedSets };
    if (newAllCompletedSets[uniqueId]) {
      newAllCompletedSets[uniqueId] = newAllCompletedSets[uniqueId].filter(s => s !== setNum);
    }

    // Remove from customReps, customWeights, setTimes
    const newCustomReps = { ...customReps };
    if (newCustomReps[uniqueId]?.[setNum] !== undefined) {
      const { [setNum]: _r, ...restReps } = newCustomReps[uniqueId];
      newCustomReps[uniqueId] = restReps;
    }
    const newCustomWeights = { ...customWeights };
    if (newCustomWeights[uniqueId]?.[setNum] !== undefined) {
      const { [setNum]: _w, ...restWeights } = newCustomWeights[uniqueId];
      newCustomWeights[uniqueId] = restWeights;
    }
    const newAllSetTimes = { ...allSetTimes };
    if (newAllSetTimes[uniqueId]?.[setNum] !== undefined) {
      const { [setNum]: _t, ...restTimes } = newAllSetTimes[uniqueId];
      newAllSetTimes[uniqueId] = restTimes;
    }

    // Compute new config after deletion to find a valid currentSet
    const newConfig = buildSeriesConfig(activeSessionItem, extraSetsPerExercise, newDeleted);
    let nextCurrentSet = currentSet;
    if (currentSet === setNum) {
      nextCurrentSet = getNextSetToComplete(new Set(newAllCompletedSets[uniqueId] || []), newConfig);
    }

    stateRef.current.deletedSetsPerExercise = newDeleted;
    setDeletedSetsPerExercise(newDeleted);
    setAllCompletedSets(newAllCompletedSets);
    setCustomReps(newCustomReps);
    setCustomWeights(newCustomWeights);
    setAllSetTimes(newAllSetTimes);
    setCurrentSet(nextCurrentSet);

    saveProgress(
      activeIndex, activeSeconds, restSeconds, isResting, nextCurrentSet,
      newAllCompletedSets, completedExercises, newAllSetTimes, newCustomReps, newCustomWeights,
      extraSetsPerExercise, undefined, newDeleted
    );

    // Keep the audit in sync when deleting sets of an already-finished exercise
    if (completedExercises.has(uniqueId)) {
      auditExerciseCompletion(
        activeSessionItem,
        newAllCompletedSets[uniqueId] || [],
        newAllSetTimes[uniqueId] || {},
        newCustomReps,
        newCustomWeights,
        extraSetsPerExercise,
        newDeleted
      );
    }
  };

  // Add an ad-hoc exercise to the current session (not part of the routine)
  const handleAddAdhocExercise = (exercise: Exercise) => {
    const ts = Date.now();
    const uniqueId = `adhoc-${ts}-${exercise.id}`;
    const newItem: SessionExercise = {
      uniqueId,
      exercise,
      groupName: 'Sesión actual',
      // Unique negative id so audits of repeated adhoc instances of the same exercise don't collide
      metaGroupItemId: -ts,
      isAdhoc: true,
    };
    const newIdx = sessionExercises.length;
    const updatedExercises = [...sessionExercises, newItem];
    const newAdhocInfos: AdhocExerciseInfo[] = updatedExercises
      .filter(e => e.isAdhoc)
      .map(e => ({ uniqueId: e.uniqueId, exerciseId: e.exercise.id!, groupName: e.groupName, metaGroupItemId: e.metaGroupItemId }));

    stateRef.current.adhocExerciseInfos = newAdhocInfos;
    setSessionExercises(updatedExercises);
    setIsAddExerciseOpen(false);
    setIsExerciseListOpen(false);
    setExerciseSearch('');

    // Navigate to the new exercise
    setActiveIndex(newIdx);
    setIsResting(false);
    setIsRunning(false);
    setActiveSeconds(0);
    setRestSeconds(0);
    setShowResetOptions(false);
    setCurrentSet(1);

    saveProgress(
      newIdx, 0, 0, false, 1,
      allCompletedSets, completedExercises, allSetTimes, customReps, customWeights,
      extraSetsPerExercise, newAdhocInfos
    );
  };

  // Load all exercises for the add-exercise modal
  useEffect(() => {
    if (!isAddExerciseOpen) return;
    getExercises(db).then(setAllExercises).catch(() => setAllExercises([]));
  }, [isAddExerciseOpen, db]);

  const filteredExercises = useMemo(() => {
    if (!exerciseSearch.trim()) return allExercises;
    const q = exerciseSearch.toLowerCase();
    return allExercises.filter(e => e.name.toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q));
  }, [allExercises, exerciseSearch]);

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
              <ThemedText
                type="smallBold"
                style={[
                  styles.drawerItemName,
                  isDone && { textDecorationLine: 'line-through', opacity: 0.6 },
                ]}>
                {item.exercise.name}
              </ThemedText>
              {item.isAdhoc && (
                <View style={styles.adhocBadge}>
                  <ThemedText type="code" style={styles.adhocBadgeText}>+</ThemedText>
                </View>
              )}
            </View>
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
              <Pressable
                onPress={() => setIsAddExerciseOpen(true)}
                style={({ pressed }) => [styles.addExerciseBtn, { margin: Spacing.two, marginBottom: 0 }, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                  size={16}
                  tintColor="#3c87f7"
                />
                <ThemedText type="small" style={{ color: '#3c87f7', fontWeight: '600' }}>
                  Agregar ejercicio
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/(tabs)/workout?tab=routines&expandId=${metaGroupId}`)}
                style={({ pressed }) => [styles.addExerciseBtn, { margin: Spacing.two, marginTop: 0 }, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'pencil.circle.fill', android: 'edit', web: 'edit' }}
                  size={16}
                  tintColor="#ff9500"
                />
                <ThemedText type="small" style={{ color: '#ff9500', fontWeight: '600' }}>
                  Editar rutina
                </ThemedText>
              </Pressable>
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
                    {parsedSeriesConfig.map((item) => {
                      const setNum = item.set;
                      const isSetDone = completedSets.has(setNum);
                      const isActiveSet = currentSet === setNum;
                      const isExpanded = expandedSets[setNum] ?? isActiveSet;

                      const handlePressRow = () => {
                        if (!isTablet) {
                          setExpandedSets((prev) => ({
                            ...prev,
                            [setNum]: !isExpanded,
                          }));
                        } else {
                          handleToggleSetManual(setNum);
                        }
                      };

                      if (isTablet) {
                        return (
                          <Pressable
                            key={setNum}
                            onPress={handlePressRow}
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
                              {activeExercise?.weight !== null && activeExercise?.weight !== undefined && (() => {
                                const currentWeightValue = customWeights[activeSessionItem.uniqueId]?.[setNum] ?? activeExercise.weight;
                                return (
                                  <View style={styles.repsCounterContainer}>
                                    <Pressable
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        handleUpdateWeight(setNum, Math.max(0, currentWeightValue - 1));
                                      }}
                                      style={({ pressed }) => [
                                        styles.repsCounterBtn,
                                        pressed && styles.repsCounterBtnPressed,
                                      ]}>
                                      <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 16 }}>-</ThemedText>
                                    </Pressable>
                                    <ThemedText type="smallBold" style={styles.repsCounterValue}>
                                      {currentWeightValue}
                                    </ThemedText>
                                    <Pressable
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        handleUpdateWeight(setNum, Math.min(1000, currentWeightValue + 1));
                                      }}
                                      style={({ pressed }) => [
                                        styles.repsCounterBtn,
                                        pressed && styles.repsCounterBtnPressed,
                                      ]}>
                                      <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 16 }}>+</ThemedText>
                                    </Pressable>
                                    <ThemedText type="code" themeColor="textSecondary" style={{ marginRight: Spacing.one }}>
                                      kg
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
                              <Pressable
                                onPress={(e) => { e.stopPropagation(); handleDeleteSet(setNum); }}
                                style={({ pressed }) => [styles.deleteSetBtn, pressed && { opacity: 0.5 }]}>
                                <SymbolView
                                  name={{ ios: 'trash', android: 'delete_outline', web: 'delete_outline' }}
                                  size={14}
                                  tintColor="#ff453a"
                                />
                              </Pressable>
                            </View>
                          </Pressable>
                        );
                      }

                      // Mobile layout (Collapsible)
                      const currentRepsValue = customReps[activeSessionItem.uniqueId]?.[setNum] ?? item.reps;
                      const currentWeightValue = customWeights[activeSessionItem.uniqueId]?.[setNum] ?? activeExercise.weight;
                      const hasWeight = activeExercise.weight !== null && activeExercise.weight !== undefined;

                      return (
                        <View
                          key={setNum}
                          style={[
                            styles.mobileSeriesCard,
                            isActiveSet && { borderColor: '#3c87f7', borderWidth: 1.5 },
                            isSetDone && { opacity: 0.6 },
                          ]}>
                          {/* Row Header - Collapsible trigger */}
                          <Pressable
                            onPress={handlePressRow}
                            style={styles.mobileSeriesHeader}>
                            <View style={styles.seriesItemLeft}>
                              <Pressable
                                onPress={(e) => {
                                  e.stopPropagation();
                                  handleToggleSetManual(setNum);
                                }}
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
                              </Pressable>
                              <ThemedText type="smallBold">
                                Serie {setNum}
                              </ThemedText>
                              
                              {/* Compact summary of values when collapsed */}
                              {!isExpanded && (
                                <ThemedText type="code" themeColor="textSecondary" style={styles.mobileSummaryText}>
                                  ({currentRepsValue} reps{hasWeight ? ` • ${currentWeightValue} kg` : ''})
                                </ThemedText>
                              )}
                            </View>

                            <View style={styles.mobileSeriesHeaderRight}>
                              {setTimes[setNum] !== undefined && (
                                <ThemedText type="code" themeColor="textSecondary" style={{ marginRight: Spacing.one }}>
                                  {formatTime(setTimes[setNum])}
                                </ThemedText>
                              )}
                              {isActiveSet && (
                                <View style={styles.activeSetBadge}>
                                  <ThemedText type="code" style={styles.activeSetBadgeText}>
                                    ACTIVA
                                  </ThemedText>
                                </View>
                              )}
                              <Pressable
                                onPress={(e) => { e.stopPropagation(); handleDeleteSet(setNum); }}
                                style={({ pressed }) => [styles.deleteSetBtn, pressed && { opacity: 0.5 }]}>
                                <SymbolView
                                  name={{ ios: 'trash', android: 'delete_outline', web: 'delete_outline' }}
                                  size={16}
                                  tintColor="#ff453a"
                                />
                              </Pressable>
                              <SymbolView
                                name={
                                  isExpanded
                                    ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }
                                    : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }
                                }
                                size={18}
                                tintColor={theme.textSecondary}
                              />
                            </View>
                          </Pressable>

                          {/* Collapsible Details */}
                          {isExpanded && (
                            <View style={styles.mobileSeriesDetails}>
                              <View style={styles.mobileControlsRow}>
                                {/* Reps Counter */}
                                <View style={styles.mobileControlItem}>
                                  <ThemedText type="code" themeColor="textSecondary" style={{ marginBottom: 4 }}>
                                    REPETICIONES
                                  </ThemedText>
                                  <View style={styles.repsCounterContainer}>
                                    <Pressable
                                      onPress={() => handleUpdateReps(setNum, Math.max(1, currentRepsValue - 1))}
                                      style={({ pressed }) => [
                                        styles.repsCounterBtnLarge,
                                        pressed && styles.repsCounterBtnPressed,
                                      ]}>
                                      <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 18 }}>-</ThemedText>
                                    </Pressable>
                                    <ThemedText type="subtitle" style={styles.repsCounterValueLarge}>
                                      {currentRepsValue}
                                    </ThemedText>
                                    <Pressable
                                      onPress={() => handleUpdateReps(setNum, Math.min(150, currentRepsValue + 1))}
                                      style={({ pressed }) => [
                                        styles.repsCounterBtnLarge,
                                        pressed && styles.repsCounterBtnPressed,
                                      ]}>
                                      <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 18 }}>+</ThemedText>
                                    </Pressable>
                                  </View>
                                </View>

                                {/* Weight Counter (if configured) */}
                                {hasWeight && (
                                  <View style={styles.mobileControlItem}>
                                    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                                      <ThemedText type="code" themeColor="textSecondary" style={{ marginBottom: 4 }}>
                                        PESO
                                      </ThemedText>
                                      <ThemedText type="code" themeColor="textSecondary" style={{ fontSize: 10 }}>
                                        (KG)
                                      </ThemedText>
                                    </View>
                                    <View style={styles.repsCounterContainer}>
                                      <Pressable
                                        onPress={() => handleUpdateWeight(setNum, Math.max(0, currentWeightValue - 1))}
                                        style={({ pressed }) => [
                                          styles.repsCounterBtnLarge,
                                          pressed && styles.repsCounterBtnPressed,
                                        ]}>
                                        <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 18 }}>-</ThemedText>
                                      </Pressable>
                                      <ThemedText type="subtitle" style={styles.repsCounterValueLarge}>
                                        {currentWeightValue}
                                      </ThemedText>
                                      <Pressable
                                        onPress={() => handleUpdateWeight(setNum, Math.min(1000, currentWeightValue + 1))}
                                        style={({ pressed }) => [
                                          styles.repsCounterBtnLarge,
                                          pressed && styles.repsCounterBtnPressed,
                                        ]}>
                                        <ThemedText type="smallBold" style={{ color: theme.text, fontSize: 18 }}>+</ThemedText>
                                      </Pressable>
                                    </View>
                                  </View>
                                )}
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  {/* Add extra set button */}
                  <Pressable
                    onPress={handleAddExtraSet}
                    style={({ pressed }) => [styles.addExtraSetBtn, pressed && styles.pressed]}>
                    <SymbolView
                      name={{ ios: 'plus.circle', android: 'add_circle_outline', web: 'add_circle_outline' }}
                      size={16}
                      tintColor="#3c87f7"
                    />
                    <ThemedText type="small" style={{ color: '#3c87f7', fontWeight: '600' }}>
                      Agregar Serie
                    </ThemedText>
                  </Pressable>
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
                            Ir a Siguiente Ejercicio
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
              <Pressable
                onPress={() => setIsAddExerciseOpen(true)}
                style={({ pressed }) => [styles.addExerciseBtn, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                  size={18}
                  tintColor="#3c87f7"
                />
                <ThemedText type="smallBold" style={{ color: '#3c87f7' }}>
                  Agregar ejercicio a la sesión
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsExerciseListOpen(false);
                  router.push(`/(tabs)/workout?tab=routines&expandId=${metaGroupId}`);
                }}
                style={({ pressed }) => [styles.addExerciseBtn, { borderTopWidth: 0 }, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'pencil.circle.fill', android: 'edit', web: 'edit' }}
                  size={18}
                  tintColor="#ff9500"
                />
                <ThemedText type="smallBold" style={{ color: '#ff9500' }}>
                  Editar rutina
                </ThemedText>
              </Pressable>
            </ThemedView>
          </View>
        </Modal>

        {/* Add Exercise Modal */}
        <Modal
          visible={isAddExerciseOpen}
          transparent
          animationType="slide"
          onRequestClose={() => { setIsAddExerciseOpen(false); setExerciseSearch(''); }}>
          <View style={styles.drawerOverlay}>
            <ThemedView type="backgroundElement" style={styles.drawerContent}>
              <View style={styles.drawerHeader}>
                <View>
                  <ThemedText type="smallBold" style={styles.drawerTitle}>
                    Agregar ejercicio
                  </ThemedText>
                  <ThemedText type="code" themeColor="textSecondary">
                    Solo para esta sesión
                  </ThemedText>
                </View>
                <Pressable
                  onPress={() => { setIsAddExerciseOpen(false); setExerciseSearch(''); }}
                  style={({ pressed }) => [styles.closeDrawerBtn, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
              </View>

              <TextInput
                value={exerciseSearch}
                onChangeText={setExerciseSearch}
                placeholder="Buscar ejercicio..."
                placeholderTextColor={theme.textSecondary}
                style={[styles.exerciseSearchInput, { color: theme.text, borderColor: theme.textSecondary }]}
              />

              <ScrollView contentContainerStyle={styles.drawerScroll}>
                {filteredExercises.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center', paddingVertical: 16 }}>
                    {allExercises.length === 0 ? 'Cargando ejercicios...' : 'No se encontraron ejercicios'}
                  </ThemedText>
                ) : (
                  filteredExercises.map(ex => (
                    <Pressable
                      key={ex.id}
                      onPress={() => handleAddAdhocExercise(ex)}
                      style={({ pressed }) => [styles.drawerItem, pressed && styles.pressed]}>
                      <View style={{ flex: 1 }}>
                        <ThemedText type="smallBold">{ex.name}</ThemedText>
                        {ex.muscle_group ? (
                          <ThemedText type="code" themeColor="textSecondary">{ex.muscle_group}</ThemedText>
                        ) : null}
                        <ThemedText type="code" themeColor="textSecondary">
                          {ex.is_constant === 1 ? `${ex.default_sets}×${ex.default_reps} reps` : 'Series variables'}
                        </ThemedText>
                      </View>
                      <SymbolView
                        name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                        size={20}
                        tintColor="#3c87f7"
                      />
                    </Pressable>
                  ))
                )}
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
  mobileSeriesCard: {
    borderRadius: Spacing.two,
    backgroundColor: 'rgba(128,128,128,0.06)',
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  mobileSeriesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  mobileSeriesHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mobileSummaryText: {
    marginLeft: Spacing.one,
    fontSize: 12,
  },
  mobileSeriesDetails: {
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.15)',
    paddingTop: Spacing.two,
  },
  mobileControlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    gap: Spacing.two,
  },
  mobileControlItem: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  repsCounterBtnLarge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(128,128,128,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  repsCounterValueLarge: {
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 32,
    textAlign: 'center',
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
  addExtraSetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  addExerciseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one + Spacing.half,
    paddingVertical: Spacing.two + Spacing.half,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
  },
  exerciseSearchInput: {
    marginHorizontal: Spacing.two,
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    fontSize: 14,
  },
  deleteSetBtn: {
    padding: Spacing.one,
    borderRadius: Spacing.one,
  },
  adhocBadge: {
    backgroundColor: 'rgba(60, 135, 247, 0.15)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  adhocBadgeText: {
    fontSize: 10,
    color: '#3c87f7',
    fontWeight: 'bold',
  },
});
