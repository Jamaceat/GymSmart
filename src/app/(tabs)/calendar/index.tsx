import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useRouter, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useAlert } from '@/components/ui/alert-provider';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth, BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getMetaGroups,
  getMetaGroupWithGroups,
  getGroupWithExercises,
  getScheduledRoutinesForRange,
  insertScheduledRoutine,
  deleteScheduledRoutine,
  MetaGroup,
  ScheduledRoutine,
  ExerciseGroup,
} from '@/database/database';

// Helper: Get Monday of the week for a given date
const getMonday = (d: Date): Date => {
  const date = new Date(d);
  const day = date.getDay();
  // Adjust when day is Sunday (getDay() returns 0)
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

// Helper: Format date as YYYY-MM-DD
const formatDateString = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper: Get month name in Spanish
const getSpanishMonthName = (monthIndex: number): string => {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return months[monthIndex];
};

export default function CalendarScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const { alert } = useAlert();

  // Calendar State
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  
  // Data State
  const [scheduledRoutines, setScheduledRoutines] = useState<ScheduledRoutine[]>([]);
  const [allRoutines, setAllRoutines] = useState<MetaGroup[]>([]);
  const [expandedRoutineId, setExpandedRoutineId] = useState<number | null>(null);
  const [expandedRoutineDetails, setExpandedRoutineDetails] = useState<(MetaGroup & { summary?: { name: string; totalReps: number; setsCount: number }[] }) | null>(null);
  
  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Confirmation Modal State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    id: number;
    metaGroupId: number;
    date: string;
    name: string;
    isCompleted: boolean;
  } | null>(null);

  // Generate 7 days of the current week (Monday to Sunday)
  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart);
    d.setDate(currentWeekStart.getDate() + i);
    return d;
  });

  // Load routines scheduled for the current week and all available routines for the selector
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const startStr = formatDateString(daysOfWeek[0]);
      const endStr = formatDateString(daysOfWeek[6]);

      const weeklyRoutines = await getScheduledRoutinesForRange(db, startStr, endStr);
      const routinesList = await getMetaGroups(db);

      // Also fetch completed routines from audits to handle cases where routines were completed but then deleted/unscheduled
      const auditsRaw = await db.getAllAsync<{ routine_id: number; routine_name: string; completed_date: string }>(
        `SELECT DISTINCT routine_id, routine_name, completed_date 
         FROM exercise_completion_audits 
         WHERE completed_date BETWEEN ? AND ?`,
        [startStr, endStr]
      );

      const mergedRoutines = [...weeklyRoutines];

      auditsRaw.forEach(audit => {
        const exists = mergedRoutines.some(
          r => r.meta_group_id === audit.routine_id && r.scheduled_date === audit.completed_date
        );
        if (!exists) {
          mergedRoutines.push({
            id: -audit.routine_id, // unique negative ID for synthesized items
            meta_group_id: audit.routine_id,
            meta_group_name: audit.routine_name,
            scheduled_date: audit.completed_date,
            is_completed: 1,
          });
        }
      });

      mergedRoutines.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

      setScheduledRoutines(mergedRoutines);
      setAllRoutines(routinesList);

      // If there is an expanded routine detail, refresh it as well
      if (expandedRoutineId !== null) {
        const currentExpanded = mergedRoutines.find(r => r.id === expandedRoutineId);
        if (currentExpanded) {
          await refreshExpandedRoutineDetails(currentExpanded.meta_group_id, currentExpanded.scheduled_date, currentExpanded.id);
        } else {
          setExpandedRoutineId(null);
          setExpandedRoutineDetails(null);
        }
      }
    } catch (error) {
      console.error('Error loading calendar data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [db, currentWeekStart, expandedRoutineId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Helper to load complete routine metadata with exercise details
  const refreshExpandedRoutineDetails = async (metaGroupId: number, dateStr: string, scheduledRoutineId?: number) => {
    try {
      // 1. Fetch audits for this routine on this date
      const audits = await db.getAllAsync<{
        id: number;
        exercise_id: number | null;
        exercise_name: string;
        set_index: number;
        repetitions: number;
        seconds_taken: number | null;
        routine_id: number;
        routine_name: string;
        completed_date: string;
        group_name: string | null;
        meta_group_item_id: number | null;
      }>(
        scheduledRoutineId && scheduledRoutineId > 0
          ? `SELECT * FROM exercise_completion_audits 
             WHERE scheduled_routine_id = ? 
             ORDER BY id ASC`
          : `SELECT * FROM exercise_completion_audits 
             WHERE routine_id = ? AND completed_date = ? 
             ORDER BY id ASC`,
        scheduledRoutineId && scheduledRoutineId > 0
          ? [scheduledRoutineId]
          : [metaGroupId, dateStr]
      );

      // 2. Try to load the live routine template
      const routineData = await getMetaGroupWithGroups(db, metaGroupId);
      let liveGroups: ExerciseGroup[] = [];
      if (routineData && routineData.groups) {
        liveGroups = await Promise.all(
          routineData.groups.map(async (g) => {
            const fullGroup = await getGroupWithExercises(db, g.id!);
            return fullGroup ? { ...fullGroup, meta_group_item_id: g.meta_group_item_id } : g;
          })
        );
      }

      // 3. Resolve group_names if they are null (for backward compatibility / older logs)
      if (audits.length > 0) {
        for (const audit of audits) {
          if (!audit.group_name) {
            // Try matching with live groups first
            if (liveGroups.length > 0) {
              const matchingGroup = liveGroups.find(g => 
                g.exercises?.some(ex => ex && (ex.id === audit.exercise_id || ex.name === audit.exercise_name))
              );
              if (matchingGroup) {
                audit.group_name = matchingGroup.name;
                continue;
              }
            }
            // Otherwise, query database for this exercise's group
            if (audit.exercise_id) {
              const groupRow = await db.getFirstAsync<{ name: string }>(
                `SELECT eg.name FROM exercise_groups eg
                 JOIN group_exercises ge ON eg.id = ge.group_id
                 WHERE ge.exercise_id = ?
                 LIMIT 1`,
                [audit.exercise_id]
              );
              if (groupRow) {
                audit.group_name = groupRow.name;
              }
            }
          }
        }
      }

      // Calculate summary of completed exercises for the routine (grouped across groups)
      const summaryMap: Record<string, { name: string; totalReps: number; setsCount: number }> = {};
      if (audits.length > 0) {
        audits.forEach(audit => {
          const key = audit.exercise_id ? String(audit.exercise_id) : audit.exercise_name;
          if (!summaryMap[key]) {
            summaryMap[key] = {
              name: audit.exercise_name,
              totalReps: 0,
              setsCount: 0,
            };
          }
          summaryMap[key].totalReps += audit.repetitions;
          summaryMap[key].setsCount += 1;
        });
      }
      const summaryList = Object.values(summaryMap);

      if (liveGroups.length > 0) {
        // We have a live template! Let's merge live template + audits
        // Group audits by meta_group_item_id and exercise_id (or fallback for older logs)
        const auditsByExInstance: Record<string, typeof audits> = {};
        audits.forEach(audit => {
          const key = audit.meta_group_item_id && audit.exercise_id
            ? `${audit.meta_group_item_id}-${audit.exercise_id}`
            : (audit.exercise_id ? String(audit.exercise_id) : audit.exercise_name);
          if (!auditsByExInstance[key]) {
            auditsByExInstance[key] = [];
          }
          auditsByExInstance[key].push(audit);
        });

        // Track which audited exercises we've displayed using audit ID
        const displayedAuditIds = new Set<number>();

        const mergedGroups = liveGroups.map((group) => {
          const exercises = (group.exercises ?? []).filter(Boolean).map((ex) => {
            // Match audits: try matching specific instance first
            const instanceKey = group.meta_group_item_id && ex.id ? `${group.meta_group_item_id}-${ex.id}` : null;
            let exAudits = instanceKey ? auditsByExInstance[instanceKey] : null;

            // Fallback: match by exercise_id or name for older logs that don't have meta_group_item_id
            if (!exAudits || exAudits.length === 0) {
              const fallbackKey = ex.id ? String(ex.id) : ex.name;
              exAudits = auditsByExInstance[fallbackKey];
            }

            if (exAudits && exAudits.length > 0) {
              exAudits.forEach(a => {
                if (a.id) displayedAuditIds.add(a.id);
              });
              exAudits.sort((a, b) => a.set_index - b.set_index);
              const repsList = exAudits.map(a => a.repetitions);
              const allRepsSame = repsList.every(r => r === repsList[0]);
              const totalSets = exAudits.length;
              const repsDisplay = allRepsSame 
                ? `${totalSets} x ${repsList[0]} reps` 
                : `${repsList.reduce((sum, r) => sum + r, 0)} reps`;

              return {
                ...ex,
                repsDisplay,
                isAudit: true
              };
            }

            return ex; // return live exercise state as planned
          });

          return {
            ...group,
            exercises
          };
        });

        // Include any exercises that were completed historically but have since been removed from the template
        const extraAudits = audits.filter(audit => {
          return audit.id && !displayedAuditIds.has(audit.id);
        });

        if (extraAudits.length > 0) {
          // Group extra audits by exercise
          const extraAuditsByExercise: Record<string, typeof audits> = {};
          extraAudits.forEach(audit => {
            const exKey = audit.exercise_id ? String(audit.exercise_id) : audit.exercise_name;
            if (!extraAuditsByExercise[exKey]) {
              extraAuditsByExercise[exKey] = [];
            }
            extraAuditsByExercise[exKey].push(audit);
          });

          // For each extra exercise, append it to its respective group, or create/find group
          Object.entries(extraAuditsByExercise).forEach(([exKey, exAudits]) => {
            exAudits.sort((a, b) => a.set_index - b.set_index);
            const firstAudit = exAudits[0];
            const repsList = exAudits.map(a => a.repetitions);
            const allRepsSame = repsList.every(r => r === repsList[0]);
            const totalSets = exAudits.length;
            const repsDisplay = allRepsSame 
              ? `${totalSets} x ${repsList[0]} reps` 
              : `${repsList.reduce((sum, r) => sum + r, 0)} reps`;

            const reconstructedEx = {
              id: firstAudit.exercise_id ?? undefined,
              name: firstAudit.exercise_name,
              is_constant: 1,
              default_sets: totalSets,
              default_reps: repsList[0],
              series_config: null,
              video_url: null,
              initial_state: null,
              repsDisplay,
              isAudit: true
            };

            const gName = firstAudit.group_name || 'Otros';
            let targetGroup = mergedGroups.find(g => g.name === gName);
            if (!targetGroup) {
              targetGroup = {
                id: mergedGroups.length + 1000,
                name: gName,
                exercises: [],
                meta_group_item_id: mergedGroups.length + 1000,
              };
              mergedGroups.push(targetGroup);
            }
            if (targetGroup.exercises) {
              targetGroup.exercises.push(reconstructedEx);
            }
          });
        }

        setExpandedRoutineDetails({
          id: routineData?.id,
          name: routineData?.name || '',
          created_at: routineData?.created_at,
          groups: mergedGroups,
          summary: summaryList
        });
      } else {
        // No live template (deleted). Reconstruct purely from audits
        if (audits.length > 0) {
          const groupsMap: Record<string, Record<string, typeof audits>> = {};

          audits.forEach(audit => {
            const gName = audit.group_name || 'Otros';
            if (!groupsMap[gName]) {
              groupsMap[gName] = {};
            }
            
            const exKey = audit.exercise_id ? String(audit.exercise_id) : audit.exercise_name;
            if (!groupsMap[gName][exKey]) {
              groupsMap[gName][exKey] = [];
            }
            groupsMap[gName][exKey].push(audit);
          });

          const reconstructedGroups = Object.entries(groupsMap).map(([groupName, exercisesMap], gIdx) => {
            const exercises = Object.entries(exercisesMap).map(([exKey, exAudits]) => {
              exAudits.sort((a, b) => a.set_index - b.set_index);
              const firstAudit = exAudits[0];
              const repsList = exAudits.map(a => a.repetitions);
              const allRepsSame = repsList.every(r => r === repsList[0]);
              const totalSets = exAudits.length;
              const repsDisplay = allRepsSame 
                ? `${totalSets} x ${repsList[0]} reps` 
                : `${repsList.reduce((sum, r) => sum + r, 0)} reps`;

              return {
                id: firstAudit.exercise_id ?? undefined,
                name: firstAudit.exercise_name,
                is_constant: 1,
                default_sets: totalSets,
                default_reps: repsList[0],
                series_config: null,
                video_url: null,
                initial_state: null,
                repsDisplay,
                isAudit: true
              };
            });

            return {
              id: gIdx,
              name: groupName,
              exercises,
              meta_group_item_id: gIdx,
            };
          });

          setExpandedRoutineDetails({
            id: metaGroupId,
            name: audits[0]?.routine_name || 'Rutina Completada',
            groups: reconstructedGroups,
            isAudit: true,
            summary: summaryList
          } as any);
        } else {
          // No audits, no live template
          setExpandedRoutineDetails(null);
        }
      }
    } catch (error) {
      console.error('Error fetching expanded routine details:', error);
    }
  };

  // Toggle routine card expansion to show exercises
  const handleToggleExpandRoutine = async (scheduledId: number, metaGroupId: number, dateStr: string) => {
    if (expandedRoutineId === scheduledId) {
      setExpandedRoutineId(null);
      setExpandedRoutineDetails(null);
    } else {
      setExpandedRoutineId(scheduledId);
      await refreshExpandedRoutineDetails(metaGroupId, dateStr, scheduledId);
    }
  };

  // Navigate back/forward by one week
  const navigateWeek = (direction: 'prev' | 'next') => {
    const newStart = new Date(currentWeekStart);
    newStart.setDate(currentWeekStart.getDate() + (direction === 'prev' ? -7 : 7));
    setCurrentWeekStart(newStart);
  };

  // Reset calendar to the current week & select today
  const navigateToToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setCurrentWeekStart(getMonday(today));
    setSelectedDate(today);
  };

  // Add routine to the selected date
  const handleScheduleRoutine = async (metaGroupId: number) => {
    try {
      const dateStr = formatDateString(selectedDate);
      await insertScheduledRoutine(db, metaGroupId, dateStr);
      setIsAddModalOpen(false);
      loadData();
    } catch (error) {
      console.error('Error scheduling routine:', error);
      alert('Error', 'No se pudo programar la rutina.');
    }
  };

  // Remove routine assignment
  const handleUnscheduleRoutine = (
    scheduledId: number,
    metaGroupId: number,
    dateStr: string,
    name: string,
    isCompleted: boolean
  ) => {
    setItemToDelete({ id: scheduledId, metaGroupId, date: dateStr, name, isCompleted });
    setConfirmModalVisible(true);
  };

  const executeUnschedule = async () => {
    if (!itemToDelete) return;
    setConfirmModalVisible(false);
    try {
      if (expandedRoutineId === itemToDelete.id) {
        setExpandedRoutineId(null);
        setExpandedRoutineDetails(null);
      }
      await deleteScheduledRoutine(db, itemToDelete.id, itemToDelete.metaGroupId, itemToDelete.date);
      loadData();
    } catch (error) {
      console.error('Error deleting scheduled routine:', error);
      alert('Error', 'No se pudo quitar la rutina.');
    } finally {
      setItemToDelete(null);
    }
  };

  // Filter scheduled routines for the currently selected day
  const selectedDateStr = formatDateString(selectedDate);
  const routinesForSelectedDay = scheduledRoutines.filter(
    (sr) => sr.scheduled_date === selectedDateStr
  );

  const filteredRoutines = allRoutines.filter((routine) =>
    routine.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper to format the range of the current week (e.g. "Junio 2026")
  const getWeekHeaderLabel = () => {
    const startMonth = daysOfWeek[0].getMonth();
    const endMonth = daysOfWeek[6].getMonth();
    const startYear = daysOfWeek[0].getFullYear();
    const endYear = daysOfWeek[6].getFullYear();

    if (startMonth === endMonth) {
      return `${getSpanishMonthName(startMonth)} ${startYear}`;
    } else if (startYear === endYear) {
      return `${getSpanishMonthName(startMonth)} - ${getSpanishMonthName(endMonth)} ${startYear}`;
    } else {
      return `${getSpanishMonthName(startMonth)} ${startYear} - ${getSpanishMonthName(endMonth)} ${endYear}`;
    }
  };

  // Day names for header row
  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* Header Section */}
        <View style={styles.header}>
          <View>
            <ThemedText type="subtitle" style={styles.headerTitle}>
              Mi Agenda
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {getWeekHeaderLabel()}
            </ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={navigateToToday}
              style={({ pressed }) => [
                styles.todayButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'calendar.badge.clock', android: 'today', web: 'today' }}
                size={16}
                tintColor={theme.text}
              />
              <ThemedText type="smallBold">Hoy</ThemedText>
            </Pressable>
            <View style={styles.navGroup}>
              <Pressable
                onPress={() => navigateWeek('prev')}
                style={({ pressed }) => [
                  styles.navButton,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <SymbolView
                  name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                  size={16}
                  tintColor={theme.text}
                />
              </Pressable>
              <Pressable
                onPress={() => navigateWeek('next')}
                style={({ pressed }) => [
                  styles.navButton,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={16}
                  tintColor={theme.text}
                />
              </Pressable>
            </View>
          </View>
        </View>

        {/* Week View Row */}
        <View style={styles.weekRow}>
          {daysOfWeek.map((day, index) => {
            const dateStr = formatDateString(day);
            const isSelected = formatDateString(selectedDate) === dateStr;
            const dayRoutines = scheduledRoutines.filter((sr) => sr.scheduled_date === dateStr);
            const hasRoutines = dayRoutines.length > 0;
            const allCompleted = hasRoutines && dayRoutines.every((sr) => sr.is_completed === 1);
            const isToday = formatDateString(new Date()) === dateStr;

            return (
              <Pressable
                key={index}
                onPress={() => {
                  setSelectedDate(day);
                  setExpandedRoutineId(null);
                  setExpandedRoutineDetails(null);
                }}
                style={({ pressed }) => [
                  styles.dayCard,
                  isSelected
                    ? { backgroundColor: theme.text }
                    : allCompleted
                    ? { backgroundColor: theme.background === '#ffffff' ? '#eaf7ec' : '#142b1a' }
                    : { backgroundColor: theme.backgroundElement },
                  isToday && !isSelected && styles.todayCardOutline,
                  allCompleted && !isSelected && {
                    borderColor: theme.background === '#ffffff' ? '#a3e2ab' : '#1b5e20',
                    borderWidth: 1.2,
                  },
                  pressed && styles.pressed,
                ]}>
                <ThemedText
                  type="small"
                  themeColor={isSelected ? 'background' : 'textSecondary'}
                  style={[
                    styles.dayLabel,
                    allCompleted && !isSelected && { color: theme.background === '#ffffff' ? '#1e4620' : '#a3e2ab' }
                  ]}>
                  {dayLabels[index]}
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  themeColor={isSelected ? 'background' : 'text'}
                  style={[
                    styles.dayNumber,
                    allCompleted && !isSelected && { color: theme.background === '#ffffff' ? '#1e4620' : '#a3e2ab' }
                  ]}>
                  {day.getDate()}
                </ThemedText>
                {/* Dot indicator if day has routine scheduled */}
                <View style={styles.indicatorContainer}>
                  {hasRoutines && (
                    <View
                      style={[
                        styles.indicatorDot,
                        { 
                          backgroundColor: isSelected 
                            ? theme.background 
                            : allCompleted 
                            ? '#34c759' 
                            : '#3c87f7' 
                        },
                      ]}
                    />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Selected Day View Details */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          <View style={styles.dayDetailsHeader}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {selectedDate.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </ThemedText>
          </View>

          {routinesForSelectedDay.length > 0 ? (
            <View style={styles.routineList}>
              {routinesForSelectedDay.map((sr) => {
                const isExpanded = expandedRoutineId === sr.id;
                const isCompleted = sr.is_completed === 1;
                return (
                  <ThemedView 
                    key={sr.id} 
                    type="backgroundElement" 
                    style={[
                      styles.routineCard,
                      isCompleted && {
                        backgroundColor: theme.background === '#ffffff' ? '#eaf7ec' : '#142b1a',
                        borderColor: theme.background === '#ffffff' ? '#a3e2ab' : '#1b5e20',
                        borderWidth: 1.2,
                      }
                    ]}>
                    {/* Routine Card Header */}
                    <Pressable
                      onPress={() => handleToggleExpandRoutine(sr.id, sr.meta_group_id, sr.scheduled_date)}
                      style={styles.routineHeader}>
                      <View style={styles.routineHeaderLeft}>
                        <SymbolView
                          name={{
                            ios: isExpanded ? 'chevron.down' : 'chevron.right',
                            android: isExpanded ? 'expand_more' : 'chevron_right',
                            web: isExpanded ? 'expand_more' : 'chevron_right',
                          }}
                          size={18}
                          tintColor={isCompleted ? '#34c759' : theme.text}
                        />
                        <ThemedText 
                          type="smallBold" 
                          style={[
                            styles.routineName,
                            isCompleted && { color: theme.background === '#ffffff' ? '#1e4620' : '#a3e2ab' }
                          ]}>
                          {sr.meta_group_name}
                        </ThemedText>
                        {isCompleted && (
                          <View style={styles.completedBadge}>
                            <SymbolView
                              name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                              size={12}
                              tintColor="#34c759"
                            />
                            <ThemedText type="code" style={styles.completedText}>
                              Completada
                            </ThemedText>
                          </View>
                        )}
                      </View>
                      <View style={styles.routineHeaderRight}>
                        <Pressable
                          onPress={() => {
                            router.push({
                              pathname: '/workout/session' as any,
                              params: { 
                                metaGroupId: sr.meta_group_id, 
                                date: selectedDateStr,
                                scheduledRoutineId: sr.id
                              }
                            });
                          }}
                          style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}
                          accessibilityLabel="Comenzar rutina">
                          <SymbolView
                            name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                            size={20}
                            tintColor={isCompleted ? '#34c759' : '#3c87f7'}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => handleUnscheduleRoutine(
                            sr.id,
                            sr.meta_group_id,
                            sr.scheduled_date,
                            sr.meta_group_name,
                            sr.is_completed === 1
                          )}
                          style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
                          accessibilityLabel="Quitar rutina">
                          <SymbolView
                            name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                            size={18}
                            tintColor="#ff453a"
                          />
                        </Pressable>
                      </View>
                    </Pressable>

                    {/* Expanded Content (Groups and Exercises) */}
                    {isExpanded && expandedRoutineDetails && (() => {
                      const groupOccurrenceCounts: Record<number, number> = {};
                      const groupsWithOccurrence = (expandedRoutineDetails.groups ?? []).map(group => {
                        const gId = group.id!;
                        groupOccurrenceCounts[gId] = (groupOccurrenceCounts[gId] ?? 0) + 1;
                        return {
                          ...group,
                          occurrenceIndex: groupOccurrenceCounts[gId],
                        };
                      });

                      const getGroupBackgroundColor = (occurrenceIndex: number) => {
                        if (occurrenceIndex === 1) {
                          return theme.background;
                        }
                        return theme.background === '#ffffff' 
                          ? '#e6f0fa' 
                          : '#1a2636';
                      };

                      return (
                        <View style={styles.routineDetailsContainer}>
                          {groupsWithOccurrence.length > 0 ? (
                            <>
                              {groupsWithOccurrence.map((group, idx) => (
                                <View 
                                  key={group.meta_group_item_id ?? idx} 
                                  style={[
                                    styles.groupDetailBlock,
                                    {
                                      backgroundColor: getGroupBackgroundColor(group.occurrenceIndex),
                                      padding: Spacing.two,
                                      borderRadius: Spacing.two,
                                      marginBottom: Spacing.two,
                                    }
                                  ]}>
                                  <View style={styles.groupHeaderRow}>
                                    <ThemedText type="smallBold" style={styles.groupTitle} themeColor="textSecondary">
                                      {group.name}
                                    </ThemedText>
                                    {group.occurrenceIndex > 1 && (
                                      <View style={[styles.repeatBadge, { backgroundColor: theme.background === '#ffffff' ? '#3c87f7' : '#2260c0' }]}>
                                        <ThemedText type="smallBold" style={styles.repeatBadgeText}>
                                          {group.occurrenceIndex}x
                                        </ThemedText>
                                      </View>
                                    )}
                                  </View>
                                  {group.exercises && group.exercises.length > 0 ? (
                                    <View style={styles.exerciseList}>
                                      {group.exercises.filter(Boolean).map((ex) => (
                                        <View key={ex.id ? `${ex.id}` : ex.name || Math.random().toString()} style={styles.exerciseItem}>
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flex: 1 }}>
                                            {ex.isAudit && (
                                              <SymbolView
                                                name={{ ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }}
                                                size={14}
                                                tintColor="#34c759"
                                              />
                                            )}
                                            <ThemedText type="small" style={styles.exerciseName} numberOfLines={1}>
                                              {ex.isAudit ? ex.name || 'Ejercicio' : `• ${ex.name || 'Ejercicio'}`}
                                            </ThemedText>
                                          </View>
                                          <ThemedText type="small" themeColor="textSecondary">
                                            {ex.repsDisplay !== undefined
                                              ? ex.repsDisplay
                                              : ex.is_constant === 1
                                              ? `${ex.default_sets || 0} x ${ex.default_reps || 0} reps`
                                              : 'Series variables'}
                                          </ThemedText>
                                        </View>
                                      ))}
                                    </View>
                                  ) : (
                                    <ThemedText type="small" themeColor="textSecondary" style={styles.noExercises}>
                                      Sin ejercicios añadidos
                                    </ThemedText>
                                  )}
                                </View>
                              ))}

                              {/* Resumen de Ejercicios Realizados */}
                              {expandedRoutineDetails && expandedRoutineDetails.summary && expandedRoutineDetails.summary.length > 0 && (
                                <ThemedView type="background" style={styles.summaryBlock}>
                                  <ThemedText type="smallBold" style={styles.summaryTitle}>
                                    Resumen de Ejercicios Realizados (Volumen Total)
                                  </ThemedText>
                                  <View style={styles.summaryList}>
                                    {expandedRoutineDetails.summary.map((sumItem, sIdx) => (
                                      <View key={sIdx} style={styles.summaryItem}>
                                        <ThemedText type="small" style={styles.summaryName}>
                                          {sumItem.name}
                                        </ThemedText>
                                        <ThemedText type="smallBold" themeColor="textSecondary">
                                          {sumItem.setsCount} series • {sumItem.totalReps} reps totales
                                        </ThemedText>
                                      </View>
                                    ))}
                                  </View>
                                </ThemedView>
                              )}

                              <Pressable
                                onPress={() => {
                                  router.push({
                                    pathname: '/workout/session' as any,
                                    params: { 
                                      metaGroupId: sr.meta_group_id, 
                                      date: selectedDateStr,
                                      scheduledRoutineId: sr.id
                                    }
                                  });
                                }}
                                style={({ pressed }) => [
                                  styles.startRoutineButton,
                                  pressed && styles.pressed,
                                ]}>
                                <SymbolView
                                  name={{ ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' }}
                                  size={18}
                                  tintColor="#ffffff"
                                />
                                <ThemedText type="smallBold" style={styles.startRoutineButtonText}>
                                  Comenzar Entrenamiento
                                </ThemedText>
                              </Pressable>
                            </>
                          ) : (
                            <ThemedText type="small" themeColor="textSecondary" style={styles.noExercises}>
                              No hay grupos ni ejercicios añadidos a esta rutina.
                            </ThemedText>
                          )}
                        </View>
                      );
                    })()}
                  </ThemedView>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyStateContainer}>
              <SymbolView
                name={{ ios: 'calendar.badge.plus', android: 'event_busy', web: 'event_busy' }}
                size={48}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="default" themeColor="textSecondary" style={styles.emptyStateText}>
                No hay rutinas planificadas para hoy.
              </ThemedText>
            </View>
          )}

          {/* Action Button to schedule a routine */}
          <Pressable
            onPress={() => {
              setSearchQuery('');
              setIsAddModalOpen(true);
            }}
            style={({ pressed }) => [
              styles.scheduleButton,
              { backgroundColor: theme.text },
              pressed && styles.pressed,
            ]}>
            <SymbolView
              name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
              size={18}
              tintColor={theme.background}
            />
            <ThemedText type="smallBold" style={{ color: theme.background }}>
              Programar Rutina
            </ThemedText>
          </Pressable>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* Modal: Select routine to schedule */}
        <Modal
          visible={isAddModalOpen}
          transparent
          animationType="slide"
          onRequestClose={() => {
            setIsAddModalOpen(false);
            setSearchQuery('');
          }}>
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <ThemedText type="smallBold" style={styles.modalTitle}>
                  Seleccionar Rutina
                </ThemedText>
                <Pressable
                  onPress={() => {
                    setIsAddModalOpen(false);
                    setSearchQuery('');
                  }}
                  style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
              </View>

              {/* Search Bar */}
              <View style={[styles.searchBarContainer, { backgroundColor: theme.background }]}>
                <SymbolView
                  name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                  size={16}
                  tintColor={theme.textSecondary}
                />
                <TextInput
                  style={[styles.searchInput, { color: theme.text }]}
                  placeholder="Buscar rutina..."
                  placeholderTextColor={theme.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery('')}>
                    <SymbolView
                      name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                      size={16}
                      tintColor={theme.textSecondary}
                    />
                  </Pressable>
                )}
              </View>

              <ScrollView contentContainerStyle={styles.modalList}>
                {filteredRoutines.length > 0 ? (
                  filteredRoutines.map((routine) => (
                    <Pressable
                      key={routine.id}
                      onPress={() => handleScheduleRoutine(routine.id!)}
                      style={({ pressed }) => [
                        styles.modalItem,
                        { backgroundColor: theme.background },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="smallBold">{routine.name}</ThemedText>
                      <SymbolView
                        name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                        size={20}
                        tintColor="#3c87f7"
                      />
                    </Pressable>
                  ))
                ) : (
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.noRoutinesText}>
                    {allRoutines.length > 0
                      ? 'No se encontraron rutinas para esta búsqueda.'
                      : 'No hay rutinas creadas. Agrégalas primero en el módulo de Entrenamiento.'}
                  </ThemedText>
                )}
              </ScrollView>
            </ThemedView>
          </View>
        </Modal>
      </SafeAreaView>
      <ConfirmModal
        visible={confirmModalVisible}
        title="Quitar de la Agenda"
        message={
          itemToDelete?.isCompleted
            ? `¿Estás seguro de que deseas quitar "${itemToDelete?.name}" de este día? Esto también eliminará el historial de ejercicios completados para esta sesión.`
            : `¿Estás seguro de que deseas quitar "${itemToDelete?.name}" de este día?`
        }
        confirmText="Quitar"
        onConfirm={executeUnschedule}
        onCancel={() => {
          setConfirmModalVisible(false);
          setItemToDelete(null);
        }}
      />
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: 99,
    gap: Spacing.one,
  },
  navGroup: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.one,
    marginBottom: Spacing.three,
  },
  dayCard: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCardOutline: {
    borderWidth: 1.5,
    borderColor: '#3c87f7',
  },
  dayLabel: {
    fontSize: 12,
    marginBottom: Spacing.half,
  },
  dayNumber: {
    fontSize: 16,
  },
  indicatorContainer: {
    height: 6,
    justifyContent: 'center',
    marginTop: Spacing.half,
  },
  indicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  dayDetailsHeader: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
    paddingBottom: Spacing.one,
    marginBottom: Spacing.one,
  },
  routineList: {
    gap: Spacing.two,
  },
  routineCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  routineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
  },
  routineHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  routineName: {
    fontSize: 16,
  },
  deleteBtn: {
    padding: Spacing.half,
  },
  routineHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  playBtn: {
    padding: Spacing.half,
  },
  startRoutineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
    backgroundColor: '#3c87f7',
  },
  startRoutineButtonText: {
    color: '#ffffff',
  },
  routineDetailsContainer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.1)',
  },
  groupDetailBlock: {
    marginTop: Spacing.two,
  },
  groupTitle: {
    fontSize: 14,
    marginBottom: Spacing.one,
  },
  exerciseList: {
    paddingLeft: Spacing.two,
    gap: Spacing.one,
  },
  exerciseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.half,
  },
  exerciseName: {
    fontSize: 14,
  },
  noExercises: {
    paddingLeft: Spacing.two,
    fontStyle: 'italic',
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.five,
    gap: Spacing.two,
  },
  emptyStateText: {
    textAlign: 'center',
  },
  scheduleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.four,
    maxHeight: '60%',
    gap: Spacing.three,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
    paddingBottom: Spacing.two,
  },
  modalTitle: {
    fontSize: 18,
  },
  closeBtn: {
    padding: Spacing.half,
  },
  modalList: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  noRoutinesText: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  bottomSpacer: {
    height: Spacing.four,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.one,
  },
  repeatBadge: {
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.one,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatBadgeText: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    backgroundColor: 'rgba(52, 199, 89, 0.12)',
    paddingHorizontal: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    borderRadius: 99,
    marginLeft: Spacing.two,
  },
  completedText: {
    color: '#34c759',
    fontWeight: 'bold',
    fontSize: 10,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.2)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    gap: Spacing.two,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  summaryBlock: {
    padding: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.15)',
    marginTop: Spacing.one,
    marginBottom: Spacing.two,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: Spacing.one + Spacing.half,
    color: '#3c87f7',
  },
  summaryList: {
    gap: Spacing.one,
  },
  summaryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.half,
  },
  summaryName: {
    fontWeight: '600',
    flex: 1,
  },
});
