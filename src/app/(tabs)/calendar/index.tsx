import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Modal,
  Dimensions,
  Platform,
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
  const [expandedRoutineDetails, setExpandedRoutineDetails] = useState<MetaGroup | null>(null);
  
  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Confirmation Modal State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);

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

      setScheduledRoutines(weeklyRoutines);
      setAllRoutines(routinesList);

      // If there is an expanded routine detail, refresh it as well
      if (expandedRoutineId !== null) {
        await refreshExpandedRoutineDetails(expandedRoutineId);
      }
    } catch (error) {
      console.error('Error loading calendar data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [db, currentWeekStart]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Helper to load complete routine metadata with exercise details
  const refreshExpandedRoutineDetails = async (metaGroupId: number) => {
    try {
      const routineData = await getMetaGroupWithGroups(db, metaGroupId);
      if (routineData && routineData.groups) {
        const groupsWithExercises = await Promise.all(
          routineData.groups.map(async (g) => {
            const fullGroup = await getGroupWithExercises(db, g.id!);
            return fullGroup || g;
          })
        );
        setExpandedRoutineDetails({ ...routineData, groups: groupsWithExercises });
      } else {
        setExpandedRoutineDetails(routineData);
      }
    } catch (error) {
      console.error('Error fetching expanded routine details:', error);
    }
  };

  // Toggle routine card expansion to show exercises
  const handleToggleExpandRoutine = async (scheduledId: number, metaGroupId: number) => {
    if (expandedRoutineId === scheduledId) {
      setExpandedRoutineId(null);
      setExpandedRoutineDetails(null);
    } else {
      setExpandedRoutineId(scheduledId);
      await refreshExpandedRoutineDetails(metaGroupId);
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
  const handleUnscheduleRoutine = (scheduledId: number, name: string) => {
    setItemToDelete({ id: scheduledId, name });
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
      await deleteScheduledRoutine(db, itemToDelete.id);
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
                      onPress={() => handleToggleExpandRoutine(sr.id, sr.meta_group_id)}
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
                              params: { metaGroupId: sr.meta_group_id, date: selectedDateStr }
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
                          onPress={() => handleUnscheduleRoutine(sr.id, sr.meta_group_name)}
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
                                      {group.exercises.map((ex) => (
                                        <View key={ex.id} style={styles.exerciseItem}>
                                          <ThemedText type="small" style={styles.exerciseName}>
                                            • {ex.name}
                                          </ThemedText>
                                          <ThemedText type="small" themeColor="textSecondary">
                                            {ex.is_constant === 1
                                              ? `${ex.default_sets} x ${ex.default_reps} reps`
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

                              <Pressable
                                onPress={() => {
                                  router.push({
                                    pathname: '/workout/session' as any,
                                    params: { metaGroupId: sr.meta_group_id, date: selectedDateStr }
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
            onPress={() => setIsAddModalOpen(true)}
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
          onRequestClose={() => setIsAddModalOpen(false)}>
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <ThemedText type="smallBold" style={styles.modalTitle}>
                  Seleccionar Rutina
                </ThemedText>
                <Pressable
                  onPress={() => setIsAddModalOpen(false)}
                  style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}>
                  <SymbolView
                    name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
              </View>

              <ScrollView contentContainerStyle={styles.modalList}>
                {allRoutines.length > 0 ? (
                  allRoutines.map((routine) => (
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
                    No hay rutinas creadas. Agrégalas primero en el módulo de Entrenamiento.
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
        message={`¿Estás seguro de que deseas quitar "${itemToDelete?.name}" de este día?`}
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
});
