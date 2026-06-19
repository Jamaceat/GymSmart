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
  GestureResponderEvent,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withDelay,
  Easing,
  SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/components/ui/alert-provider';
import { DatePickerModal } from '@/components/ui/date-picker-modal';
import { ExerciseHistoryModal } from '@/components/ui/exercise-history-modal';
import { WaterFill } from '@/components/ui/water-fill';
import { WATER_FILL_CONSTANTS } from '@/constants/water-fill';
import {
  getExerciseStatsAllTime,
  getExerciseStatsForRange,
  getExerciseProgressHistory,
  getExercises,
  Exercise,
  ExerciseStatItem,
  ExerciseProgressHistoryItem,
} from '@/database/database';

type FilterType = 'all' | 'today' | 'week' | 'month' | 'custom';

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
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  
  // Applied date filters for queries
  const [appliedRange, setAppliedRange] = useState<{ start: string; end: string } | null>(null);
  
  // Loaded stats data
  const [stats, setStats] = useState<ExerciseStatItem[]>([]);
  const [allTimeStats, setAllTimeStats] = useState<ExerciseStatItem[]>([]);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [showUnperformed, setShowUnperformed] = useState(false);
  const [completedRoutines, setCompletedRoutines] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown / progression chart states
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<ExerciseProgressHistoryItem[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number | null>(null);

  // Modal for exercise history details
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedExerciseForHistory, setSelectedExerciseForHistory] = useState<{
    id: number | null;
    name: string;
  } | null>(null);

  // Water filling animation states
  const [pressingKey, setPressingKey] = useState<string | null>(null);
  const [pressLocation, setPressLocation] = useState<{ x: number; y: number } | null>(null);
  const fillProgress = useSharedValue(0);

  const handlePressIn = (key: string, event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    setPressLocation({ x: locationX, y: locationY });
    setPressingKey(key);
    fillProgress.value = 0;
    fillProgress.value = withTiming(1, { duration: WATER_FILL_CONSTANTS.FILL_DURATION_MS });
  };

  const handlePressOut = () => {
    setPressingKey(null);
    fillProgress.value = withTiming(0, { duration: WATER_FILL_CONSTANTS.DRAIN_DURATION_MS });
  };

  const handleLongPress = (exerciseId: number | null, exerciseName: string) => {
    setSelectedExerciseForHistory({ id: exerciseId, name: exerciseName });
    setHistoryModalVisible(true);
    setPressingKey(null);
    fillProgress.value = 0;
  };

  // Reset expanded state and search query on filter change
  useEffect(() => {
    setExpandedKey(null);
    setHistoryData([]);
    setSelectedHistoryIndex(null);
    setSearchQuery('');
  }, [filterType, appliedRange]);

  const handleToggleExpand = async (exerciseId: number | null, exerciseName: string) => {
    const key = `${exerciseId}-${exerciseName}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      setHistoryData([]);
      setSelectedHistoryIndex(null);
    } else {
      setExpandedKey(key);
      setHistoryData([]);
      setSelectedHistoryIndex(null);
      setIsHistoryLoading(true);
      try {
        const hist = await getExerciseProgressHistory(db, exerciseId, exerciseName);
        setHistoryData(hist);
        if (hist.length > 0) {
          setSelectedHistoryIndex(hist.length - 1);
        }
      } catch (err) {
        console.error('Error fetching progress history:', err);
      } finally {
        setIsHistoryLoading(false);
      }
    }
  };

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
    } else if (filterType === 'today') {
      const todayStr = formatDate(new Date());
      setAppliedRange({ start: todayStr, end: todayStr });
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
      let allTimeData: ExerciseStatItem[] = [];
      let routinesCount = 0;

      if (appliedRange === null) {
        // All-time stats
        data = await getExerciseStatsAllTime(db);
        allTimeData = data;
        
        const res = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(id) as count FROM scheduled_routines WHERE is_completed = 1'
        );
        routinesCount = res?.count ?? 0;
      } else {
        // Range stats
        data = await getExerciseStatsForRange(db, appliedRange.start, appliedRange.end);
        allTimeData = await getExerciseStatsAllTime(db);
        
        const res = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(id) as count FROM scheduled_routines WHERE is_completed = 1 AND scheduled_date BETWEEN ? AND ?',
          [appliedRange.start, appliedRange.end]
        );
        routinesCount = res?.count ?? 0;
      }

      const exercisesList = await getExercises(db);
      setAllExercises(exercisesList);
      setAllTimeStats(allTimeData);
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

  const displayedStats = React.useMemo(() => {
    let combined = [...stats];

    if (showUnperformed) {
      allExercises.forEach((ex) => {
        const isAlreadyInStats = stats.some(
          (s) => s.exercise_id === ex.id || s.exercise_name.toLowerCase() === ex.name.toLowerCase()
        );

        if (!isAlreadyInStats) {
          const allTimeMatch = allTimeStats.find(
            (s) => s.exercise_id === ex.id || s.exercise_name.toLowerCase() === ex.name.toLowerCase()
          );
          const maxReps = allTimeMatch ? allTimeMatch.historical_max_reps : 0;

          combined.push({
            exercise_id: ex.id ?? null,
            exercise_name: ex.name,
            total_reps: 0,
            times_done: 0,
            historical_max_reps: maxReps,
          });
        }
      });
    }

    return combined;
  }, [stats, allExercises, allTimeStats, showUnperformed]);

  const filteredStats = displayedStats.filter((item) =>
    item.exercise_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          {(['all', 'today', 'week', 'month', 'custom'] as FilterType[]).map((type) => {
            const isActive = filterType === type;
            const labels: Record<FilterType, string> = {
              all: 'Histórico',
              today: 'Hoy',
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
              Rango de Fechas
            </ThemedText>
            
            <View style={styles.customInputRow}>
              <View style={styles.inputField}>
                <ThemedText type="code" themeColor="textSecondary">DESDE</ThemedText>
                <Pressable
                  onPress={() => setShowStartPicker(true)}
                  style={({ pressed }) => [
                    styles.dateInputBtn,
                    {
                      borderColor: theme.backgroundSelected,
                      backgroundColor: theme.background,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: startDateInput ? theme.text : theme.textSecondary,
                      flex: 1,
                    }}
                  >
                    {startDateInput || 'AAAA-MM-DD'}
                  </ThemedText>
                  <SymbolView
                    name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
                    size={16}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              </View>

              <View style={styles.inputField}>
                <ThemedText type="code" themeColor="textSecondary">HASTA</ThemedText>
                <Pressable
                  onPress={() => setShowEndPicker(true)}
                  style={({ pressed }) => [
                    styles.dateInputBtn,
                    {
                      borderColor: theme.backgroundSelected,
                      backgroundColor: theme.background,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{
                      color: endDateInput ? theme.text : theme.textSecondary,
                      flex: 1,
                    }}
                  >
                    {endDateInput || 'AAAA-MM-DD'}
                  </ThemedText>
                  <SymbolView
                    name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
                    size={16}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
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

            <DatePickerModal
              visible={showStartPicker}
              onClose={() => setShowStartPicker(false)}
              value={startDateInput}
              onSelect={setStartDateInput}
              title="Fecha de Inicio (Desde)"
            />

            <DatePickerModal
              visible={showEndPicker}
              onClose={() => setShowEndPicker(false)}
              value={endDateInput}
              onSelect={setEndDateInput}
              title="Fecha de Fin (Hasta)"
            />
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
                : filterType === 'today'
                ? 'No se encontraron rutinas terminadas hoy.'
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
            <View style={styles.sectionHeaderRow}>
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Volumen de Trabajo por Ejercicio
              </ThemedText>
              <View style={styles.toggleContainer}>
                <ThemedText type="small" themeColor="textSecondary">
                  Mostrar no realizados
                </ThemedText>
                <Switch
                  value={showUnperformed}
                  onValueChange={setShowUnperformed}
                  trackColor={{ false: '#767577', true: '#3c87f7' }}
                  thumbColor={showUnperformed ? '#ffffff' : '#f4f3f4'}
                  style={{ transform: Platform.OS === 'ios' ? [{ scaleX: 0.8 }, { scaleY: 0.8 }] : [] }}
                />
              </View>
            </View>

            {/* Search Bar */}
            <View style={[styles.searchBarContainer, { backgroundColor: theme.backgroundElement }]}>
              <SymbolView
                name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                size={16}
                tintColor={theme.textSecondary}
              />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Buscar ejercicio..."
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

            {/* List of exercise volume rankings */}
            <View style={styles.statsList}>
              {filteredStats.length > 0 ? (
                filteredStats.map((item, index) => {
                  const originalIndex = stats.findIndex(s => s.exercise_id === item.exercise_id && s.exercise_name === item.exercise_name);
                  const actualIndex = originalIndex !== -1 ? originalIndex : index;
                  const rankColor = getRankStyle(actualIndex);
                  const percentOfMax = item.historical_max_reps > 0
                    ? Math.min(100, (item.total_reps / item.historical_max_reps) * 100)
                    : 0;

                  const key = `${item.exercise_id}-${item.exercise_name}`;
                  const isExpanded = expandedKey === key;

                  // For chart scaling: find the maximum reps in historyData
                  const maxHistoryReps = historyData.length > 0
                    ? Math.max(...historyData.map(h => h.total_reps), 10)
                    : 10;

                  return (
                    <ThemedView key={index} type="backgroundElement" style={styles.rankCard}>
                      <Pressable
                        onPress={() => handleToggleExpand(item.exercise_id, item.exercise_name)}
                        onPressIn={(event) => handlePressIn(key, event)}
                        onPressOut={handlePressOut}
                        delayLongPress={WATER_FILL_CONSTANTS.FILL_DURATION_MS}
                        onLongPress={() => handleLongPress(item.exercise_id, item.exercise_name)}
                        style={({ pressed }) => [
                          styles.rankCardHeaderPressable,
                          pressed && styles.pressed,
                        ]}
                      >
                        {pressingKey === key && (
                          <WaterFill progress={fillProgress} pressLocation={pressLocation} />
                        )}

                        <View style={styles.rankCardHeader} pointerEvents="none">
                          <View style={styles.rankCardLeft}>
                            {/* Position badge */}
                            <View style={[styles.rankBadge, { backgroundColor: rankColor.backgroundColor }]}>
                              <ThemedText style={{ color: rankColor.text, fontWeight: 'bold', fontSize: 12 }}>
                                {actualIndex + 1}°
                              </ThemedText>
                            </View>
                            
                            <View style={{ flex: 1 }}>
                              <ThemedText type="default" style={styles.exerciseName} numberOfLines={1}>
                                {item.exercise_name}
                              </ThemedText>
                              <ThemedText type="code" themeColor="textSecondary">
                                Rango: {item.times_done} {item.times_done === 1 ? 'vez' : 'veces'} | Máx: {item.historical_max_reps} reps
                              </ThemedText>
                            </View>
                          </View>

                          <View style={styles.rankCardRightRow}>
                            <View style={styles.rankCardRight}>
                              <ThemedText type="subtitle" style={styles.repsText}>
                                {item.total_reps}
                              </ThemedText>
                              <ThemedText type="code" themeColor="textSecondary">reps</ThemedText>
                            </View>
                            <SymbolView
                              name={isExpanded ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                              size={18}
                              tintColor={theme.textSecondary}
                              style={{ marginLeft: Spacing.two }}
                            />
                          </View>
                        </View>

                        {/* Work Volume Progress Bar (relative comparison) */}
                        <View style={styles.progressContainer} pointerEvents="none">
                          <View
                            style={[
                              styles.progressBar,
                              {
                                width: `${item.total_reps > 0 ? Math.max(5, percentOfMax) : 0}%`,
                                backgroundColor: actualIndex === 0 ? '#FFD700' : '#3c87f7',
                              },
                            ]}
                          />
                        </View>
                      </Pressable>

                      {/* Collapsible area for progression chart */}
                      {isExpanded && (
                        <View style={styles.expandedContent}>
                          <ThemedText type="smallBold" style={styles.chartTitle}>
                            Progreso de Repeticiones por Rutina
                          </ThemedText>
                          
                          {isHistoryLoading ? (
                            <View style={styles.chartLoadingContainer}>
                              <ActivityIndicator size="small" color="#3c87f7" />
                              <ThemedText type="code" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
                                Cargando historial...
                              </ThemedText>
                            </View>
                          ) : historyData.length === 0 ? (
                            <View style={styles.chartEmptyContainer}>
                              <ThemedText type="code" themeColor="textSecondary">
                                No hay suficientes datos de entrenamiento para este ejercicio.
                              </ThemedText>
                            </View>
                          ) : (
                            <View style={styles.chartWrapper}>
                              {/* Chart Area */}
                              <View style={[styles.chartContainer, { backgroundColor: theme.background }]}>
                                {/* Background Grid Lines */}
                                <View style={styles.gridContainer}>
                                  <View style={[styles.gridLine, { borderColor: theme.backgroundElement }]} />
                                  <View style={[styles.gridLine, { borderColor: theme.backgroundElement }]} />
                                  <View style={[styles.gridLine, { borderColor: theme.backgroundElement }]} />
                                </View>

                                <ScrollView
                                  horizontal
                                  showsHorizontalScrollIndicator={false}
                                  contentContainerStyle={styles.chartScrollContent}
                                >
                                  {historyData.map((histItem, idx) => {
                                    const isSelected = selectedHistoryIndex === idx;
                                    const barHeight = maxHistoryReps > 0 ? (histItem.total_reps / maxHistoryReps) * 100 : 0;
                                    
                                    // Format YYYY-MM-DD to DD/MM
                                    const dateParts = histItem.completed_date.split('-');
                                    const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}` : histItem.completed_date;

                                    return (
                                      <Pressable
                                        key={idx}
                                        onPress={() => setSelectedHistoryIndex(idx)}
                                        style={styles.chartBarWrapper}
                                      >
                                        <ThemedText
                                          type="code"
                                          style={[
                                            styles.chartBarRepsLabel,
                                            { color: isSelected ? '#3c87f7' : theme.textSecondary }
                                          ]}
                                        >
                                          {histItem.total_reps}
                                        </ThemedText>

                                        <View style={styles.chartBarTrack}>
                                          <View
                                            style={[
                                              styles.chartBarFill,
                                              {
                                                height: `${Math.max(5, barHeight)}%`,
                                                backgroundColor: isSelected ? '#3c87f7' : '#5ba2f4',
                                                opacity: isSelected ? 1 : 0.6,
                                              }
                                            ]}
                                          />
                                        </View>

                                        <ThemedText
                                          type="code"
                                          style={[
                                            styles.chartBarDateLabel,
                                            { color: isSelected ? theme.text : theme.textSecondary, fontWeight: isSelected ? 'bold' : 'normal' }
                                          ]}
                                        >
                                          {formattedDate}
                                        </ThemedText>
                                      </Pressable>
                                    );
                                  })}
                                </ScrollView>
                              </View>

                              {/* Detail Panel */}
                              {selectedHistoryIndex !== null && historyData[selectedHistoryIndex] && (
                                <View style={[styles.detailBox, { backgroundColor: theme.backgroundSelected }]}>
                                  <View style={styles.detailRow}>
                                    <SymbolView
                                      name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
                                      size={14}
                                      tintColor={theme.textSecondary}
                                    />
                                    <ThemedText type="smallBold" style={{ marginLeft: Spacing.one }}>
                                      {historyData[selectedHistoryIndex].completed_date}
                                    </ThemedText>
                                  </View>
                                  <View style={styles.detailRow}>
                                    <SymbolView
                                      name={{ ios: 'dumbbell', android: 'fitness_center', web: 'fitness_center' }}
                                      size={14}
                                      tintColor={theme.textSecondary}
                                    />
                                    <ThemedText type="small" style={{ marginLeft: Spacing.one, flex: 1 }} numberOfLines={1}>
                                      Rutina: {historyData[selectedHistoryIndex].routine_name}
                                    </ThemedText>
                                  </View>
                                  <View style={styles.detailRow}>
                                    <SymbolView
                                      name={{ ios: 'chart.bar.fill', android: 'bar_chart', web: 'bar_chart' }}
                                      size={14}
                                      tintColor="#3c87f7"
                                    />
                                    <ThemedText type="smallBold" style={{ marginLeft: Spacing.one, color: '#3c87f7' }}>
                                      Volumen: {historyData[selectedHistoryIndex].total_reps} repeticiones totales
                                    </ThemedText>
                                  </View>
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                    </ThemedView>
                  );
                })
              ) : (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.noExercisesText}>
                  No se encontraron ejercicios para esta búsqueda.
                </ThemedText>
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      {selectedExerciseForHistory && (
        <ExerciseHistoryModal
          visible={historyModalVisible}
          onClose={() => {
            setHistoryModalVisible(false);
            setSelectedExerciseForHistory(null);
          }}
          exerciseId={selectedExerciseForHistory.id}
          exerciseName={selectedExerciseForHistory.name}
        />
      )}
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
  dateInputBtn: {
    height: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
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
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.three,
    marginBottom: Spacing.half,
  },
  sectionTitle: {
    fontSize: 16,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  statsList: {
    gap: Spacing.two,
  },
  rankCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  rankCardHeaderPressable: {
    padding: Spacing.three,
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
  rankCardRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
  expandedContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    paddingTop: Spacing.two,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.one,
  },
  chartLoadingContainer: {
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmptyContainer: {
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.7,
  },
  chartWrapper: {
    gap: Spacing.two,
  },
  chartContainer: {
    height: 140,
    borderRadius: Spacing.two,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  gridContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 20,
    bottom: 24,
    justifyContent: 'space-between',
  },
  gridLine: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.1,
  },
  chartScrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.one,
    gap: Spacing.three,
  },
  chartBarWrapper: {
    alignItems: 'center',
    gap: Spacing.one,
    width: 36,
  },
  chartBarRepsLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
  chartBarTrack: {
    height: 75,
    width: 14,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 7,
    overflow: 'hidden',
  },
  chartBarFill: {
    width: '100%',
    borderRadius: 7,
  },
  chartBarDateLabel: {
    fontSize: 9,
  },
  detailBox: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    gap: Spacing.one,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    marginBottom: Spacing.two,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  noExercisesText: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
