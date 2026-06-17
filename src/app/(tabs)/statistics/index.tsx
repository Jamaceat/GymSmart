import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  View,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/components/ui/alert-provider';
import {
  getExerciseStatsAllTime,
  getExerciseStatsForRange,
  ExerciseStatItem,
} from '@/database/database';

type FilterType = 'all' | 'week' | 'month' | 'custom';

export default function StatisticsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { alert } = useAlert();
  const { width } = useWindowDimensions();
  const isTablet = width > 768;

  // Filter type selection
  const [filterType, setFilterType] = useState<FilterType>('all');
  
  // Custom date range inputs
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  
  // Applied date filters for queries
  const [appliedRange, setAppliedRange] = useState<{ start: string; end: string } | null>(null);
  
  // Loaded stats data
  const [stats, setStats] = useState<ExerciseStatItem[]>([]);
  const [completedRoutines, setCompletedRoutines] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Formatting date helper: YYYY-MM-DD
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Helper to calculate date ranges
  const getWeekRange = () => {
    const now = new Date();
    const day = now.getDay();
    // Monday of current week (day === 0 is Sunday, so adjust)
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    return {
      start: formatDate(monday),
      end: formatDate(sunday),
    };
  };

  const getMonthRange = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      start: formatDate(firstDay),
      end: formatDate(lastDay),
    };
  };

  // Populate custom date inputs with defaults (this month) on mount
  useEffect(() => {
    const range = getMonthRange();
    setStartDateInput(range.start);
    setEndDateInput(range.end);
  }, []);

  // Sync date filter boundaries based on active pill
  useEffect(() => {
    if (filterType === 'all') {
      setAppliedRange(null);
    } else if (filterType === 'week') {
      const range = getWeekRange();
      setAppliedRange(range);
    } else if (filterType === 'month') {
      const range = getMonthRange();
      setAppliedRange(range);
    } else if (filterType === 'custom') {
      // Keep inputs or apply whatever is in input if valid
    }
  }, [filterType]);

  // Load statistics from database
  const loadStatistics = useCallback(async () => {
    try {
      setIsLoading(true);
      let data: ExerciseStatItem[] = [];
      let routinesCount = 0;

      if (appliedRange === null) {
        // All-time stats
        data = await getExerciseStatsAllTime(db);
        
        const res = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(id) as count FROM scheduled_routines WHERE is_completed = 1'
        );
        routinesCount = res?.count ?? 0;
      } else {
        // Range stats
        data = await getExerciseStatsForRange(db, appliedRange.start, appliedRange.end);
        
        const res = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(id) as count FROM scheduled_routines WHERE is_completed = 1 AND scheduled_date BETWEEN ? AND ?',
          [appliedRange.start, appliedRange.end]
        );
        routinesCount = res?.count ?? 0;
      }

      setStats(data);
      setCompletedRoutines(routinesCount);
    } catch (e) {
      console.error('Error fetching statistics:', e);
      alert('Error', 'No se pudieron cargar las estadísticas.');
    } finally {
      setIsLoading(false);
    }
  }, [db, appliedRange]);

  // Trigger load when screen is focused or when filter boundaries or type changes
  useFocusEffect(
    useCallback(() => {
      if (filterType !== 'custom' || appliedRange !== null) {
        loadStatistics();
      }
    }, [filterType, appliedRange, loadStatistics])
  );

  // Handle manual range query submit
  const handleApplyCustomFilter = () => {
    // Regex validation YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDateInput.trim()) || !dateRegex.test(endDateInput.trim())) {
      alert('Validación', 'El formato de fecha debe ser AAAA-MM-DD (Ej. 2026-06-16).');
      return;
    }

    const startVal = new Date(startDateInput.trim()).getTime();
    const endVal = new Date(endDateInput.trim()).getTime();

    if (isNaN(startVal) || isNaN(endVal)) {
      alert('Validación', 'Una de las fechas ingresadas no es válida.');
      return;
    }

    if (startVal > endVal) {
      alert('Validación', 'La fecha de inicio no puede ser posterior a la fecha de fin.');
      return;
    }

    setAppliedRange({
      start: startDateInput.trim(),
      end: endDateInput.trim(),
    });
  };

  // Summarize stats
  const totalReps = stats.reduce((acc, item) => acc + item.total_reps, 0);
  const distinctExercises = stats.length;
  const maxReps = stats.length > 0 ? stats[0].total_reps : 1;

  // Rank badge background styling helper
  const getRankStyle = (index: number) => {
    if (index === 0) return { backgroundColor: '#FFD700', text: '#000000' }; // Gold
    if (index === 1) return { backgroundColor: '#C0C0C0', text: '#000000' }; // Silver
    if (index === 2) return { backgroundColor: '#CD7F32', text: '#FFFFFF' }; // Bronze
    return { backgroundColor: theme.backgroundSelected, text: theme.text };
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* Header Title */}
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.headerTitle}>
            Estadísticas
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Monitorea tu volumen y consistencia de entrenamiento
          </ThemedText>
        </View>

        {/* Segmented Filter Pills */}
        <View style={styles.filterRow}>
          {(['all', 'week', 'month', 'custom'] as FilterType[]).map((type) => {
            const isActive = filterType === type;
            const labels: Record<FilterType, string> = {
              all: 'Histórico',
              week: 'Esta Semana',
              month: 'Este Mes',
              custom: 'Personalizado',
            };

            return (
              <Pressable
                key={type}
                onPress={() => setFilterType(type)}
                style={({ pressed }) => [
                  styles.filterPill,
                  isActive
                    ? { backgroundColor: '#3c87f7' }
                    : { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}>
                <ThemedText
                  type="smallBold"
                  style={{ color: isActive ? '#ffffff' : theme.textSecondary }}>
                  {labels[type]}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        {/* Custom Range Input Area */}
        {filterType === 'custom' && (
          <ThemedView type="backgroundElement" style={styles.customFilterCard}>
            <ThemedText type="smallBold" style={{ marginBottom: Spacing.one }}>
              Rango de Fechas (AAAA-MM-DD)
            </ThemedText>
            
            <View style={styles.customInputRow}>
              <View style={styles.inputField}>
                <ThemedText type="code" themeColor="textSecondary">DESDE</ThemedText>
                <TextInput
                  style={[styles.dateInput, { color: theme.text, backgroundColor: theme.background }]}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  value={startDateInput}
                  onChangeText={setStartDateInput}
                />
              </View>

              <View style={styles.inputField}>
                <ThemedText type="code" themeColor="textSecondary">HASTA</ThemedText>
                <TextInput
                  style={[styles.dateInput, { color: theme.text, backgroundColor: theme.background }]}
                  placeholder="AAAA-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  value={endDateInput}
                  onChangeText={setEndDateInput}
                />
              </View>

              <Pressable
                onPress={handleApplyCustomFilter}
                style={({ pressed }) => [
                  styles.filterSubmitBtn,
                  { backgroundColor: theme.text },
                  pressed && styles.pressed,
                ]}>
                <SymbolView
                  name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                  size={16}
                  tintColor={theme.background}
                />
              </Pressable>
            </View>
          </ThemedView>
        )}

        {/* Main Content Area */}
        {isLoading && stats.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#3c87f7" />
            <ThemedText style={{ marginTop: Spacing.two }} type="small">
              Cargando estadísticas...
            </ThemedText>
          </View>
        ) : stats.length === 0 ? (
          <ScrollView contentContainerStyle={styles.emptyContainer} showsVerticalScrollIndicator={false}>
            <SymbolView
              name={{ ios: 'chart.bar.xaxis', android: 'bar_chart', web: 'bar_chart' }}
              size={48}
              tintColor={theme.textSecondary}
            />
            <ThemedText style={styles.emptyTitle} type="smallBold">
              Sin datos registrados
            </ThemedText>
            <ThemedText style={styles.emptySubtitle} type="small" themeColor="textSecondary">
              {filterType === 'custom' && appliedRange === null
                ? 'Ingresa un rango de fechas y presiona buscar para cargar las estadísticas.'
                : 'No se encontraron rutinas terminadas en este periodo de tiempo.'}
            </ThemedText>
          </ScrollView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            style={[styles.mainScroll, { opacity: isLoading ? 0.7 : 1 }]}>
            
            {/* Key Metrics Summary Dashboard */}
            <View style={[styles.metricsGrid, isTablet && styles.metricsGridTablet]}>
              <ThemedView type="backgroundElement" style={styles.metricCard}>
                <View style={styles.metricHeader}>
                  <ThemedText type="code" themeColor="textSecondary">VOLUMEN TOTAL</ThemedText>
                  <SymbolView name={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }} size={16} tintColor="#3c87f7" />
                </View>
                <ThemedText type="subtitle" style={styles.metricNumber}>
                  {totalReps}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">repeticiones</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.metricCard}>
                <View style={styles.metricHeader}>
                  <ThemedText type="code" themeColor="textSecondary">EJERCICIOS</ThemedText>
                  <SymbolView name={{ ios: 'figure.strengthtraining.traditional', android: 'accessibility_new', web: 'accessibility_new' }} size={16} tintColor="#34c759" />
                </View>
                <ThemedText type="subtitle" style={styles.metricNumber}>
                  {distinctExercises}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">distintos realizados</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.metricCard}>
                <View style={styles.metricHeader}>
                  <ThemedText type="code" themeColor="textSecondary">RUTINAS HECHAS</ThemedText>
                  <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} size={16} tintColor="#ff9500" />
                </View>
                <ThemedText type="subtitle" style={styles.metricNumber}>
                  {completedRoutines}
                </ThemedText>
                <ThemedText type="code" themeColor="textSecondary">completadas</ThemedText>
              </ThemedView>
            </View>

            {/* Ranking Header */}
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Volumen de Trabajo por Ejercicio
            </ThemedText>

            {/* List of exercise volume rankings */}
            <View style={styles.statsList}>
              {stats.map((item, index) => {
                const rankColor = getRankStyle(index);
                const percentOfMax = maxReps > 0 ? (item.total_reps / maxReps) * 100 : 0;

                return (
                  <ThemedView key={index} type="backgroundElement" style={styles.rankCard}>
                    <View style={styles.rankCardHeader}>
                      <View style={styles.rankCardLeft}>
                        {/* Position badge */}
                        <View style={[styles.rankBadge, { backgroundColor: rankColor.backgroundColor }]}>
                          <ThemedText style={{ color: rankColor.text, fontWeight: 'bold', fontSize: 12 }}>
                            {index + 1}°
                          </ThemedText>
                        </View>
                        
                        <View style={{ flex: 1 }}>
                          <ThemedText type="default" style={styles.exerciseName} numberOfLines={1}>
                            {item.exercise_name}
                          </ThemedText>
                          <ThemedText type="code" themeColor="textSecondary">
                            Realizado: {item.times_done} {item.times_done === 1 ? 'vez' : 'veces'}
                          </ThemedText>
                        </View>
                      </View>

                      <View style={styles.rankCardRight}>
                        <ThemedText type="subtitle" style={styles.repsText}>
                          {item.total_reps}
                        </ThemedText>
                        <ThemedText type="code" themeColor="textSecondary">reps</ThemedText>
                      </View>
                    </View>

                    {/* Work Volume Progress Bar (relative comparison) */}
                    <View style={styles.progressContainer}>
                      <View
                        style={[
                          styles.progressBar,
                          {
                            width: `${Math.max(5, percentOfMax)}%`,
                            backgroundColor: index === 0 ? '#FFD700' : '#3c87f7',
                          },
                        ]}
                      />
                    </View>
                  </ThemedView>
                );
              })}
            </View>
          </ScrollView>
        )}
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
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
  },
  header: {
    marginTop: Spacing.four,
    marginBottom: Spacing.three,
    gap: Spacing.half,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.three,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customFilterCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginBottom: Spacing.three,
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  inputField: {
    flex: 1,
    gap: Spacing.half,
  },
  dateInput: {
    height: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
  },
  filterSubmitBtn: {
    height: 44,
    width: 44,
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
    minHeight: 250,
  },
  emptyTitle: {
    fontSize: 18,
    marginTop: Spacing.one,
  },
  emptySubtitle: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
  },
  metricsGridTablet: {
    gap: Spacing.four,
  },
  metricCard: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: Spacing.half,
  },
  sectionTitle: {
    fontSize: 16,
    marginTop: Spacing.three,
    marginBottom: Spacing.half,
  },
  statsList: {
    gap: Spacing.two,
  },
  rankCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  rankCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rankCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  rankCardRight: {
    alignItems: 'flex-end',
  },
  repsText: {
    fontSize: 20,
    fontWeight: 'bold',
    lineHeight: 24,
  },
  progressContainer: {
    height: 6,
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  pressed: {
    opacity: 0.8,
  },
});
