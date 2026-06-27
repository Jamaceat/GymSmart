import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Modal,
  Pressable,
  View,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SQLiteDatabase, useSQLiteContext } from 'expo-sqlite';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getExerciseProgressHistory,
  ExerciseProgressHistoryItem,
} from '@/database/database';
import { useAlert } from '@/components/ui/alert-provider';

type PeriodType = 'week' | 'month' | 'quarter' | 'semester' | 'year';

interface ExerciseHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  exerciseId: number | null;
  exerciseName: string;
}

interface GroupedDataPoint {
  key: string;
  label: string;
  totalReps: number;
  maxWeight: number | null;
  weights: number[];
  details: {
    periodText: string;
    routineCount: number;
    avgRepsPerRoutine: number;
  };
}

// Helper to format Monday start of week
const getStartOfWeekStr = (dateStr: string) => {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(date.setDate(diff));
  
  const year = monday.getFullYear();
  const month = String(monday.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(monday.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
};

const getScaledHeight = (weight: number | null | undefined, maxWeight: number): number => {
  if (weight === null || weight === undefined || weight <= 0 || maxWeight <= 0) {
    return 0;
  }
  const threshold = 0.9 * maxWeight;
  if (weight <= threshold) {
    return (weight / threshold) * 70;
  } else {
    const range = maxWeight - threshold;
    return range > 0
      ? 70 + ((weight - threshold) / range) * 30
      : 70;
  }
};

export function ExerciseHistoryModal({
  visible,
  onClose,
  exerciseId,
  exerciseName,
}: ExerciseHistoryModalProps) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { alert } = useAlert();
  const { width, height } = useWindowDimensions();
  const isTablet = width > 768;

  const showInfoAlert = () => {
    alert(
      'Información de Gráficos',
      '• Escala Amplificada:\nLas gráficas de repeticiones y peso usan una escala no lineal para resaltar progresos en tus rangos más altos (el 30% superior del gráfico hace zoom, por ejemplo, para que se note la diferencia de 57 a 58 repeticiones o kg).\n\n• Capas de Intensidad:\nEl gráfico de peso muestra todos los pesos usados en la sesión encimados en la misma barra. El peso máximo se ve al fondo con menor opacidad, y los pesos más bajos se muestran al frente con mayor opacidad.'
    );
  };

  const [rawHistory, setRawHistory] = useState<ExerciseProgressHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activePeriod, setActivePeriod] = useState<PeriodType>('week');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Fetch data from database when modal becomes visible or exercise changes
  useEffect(() => {
    if (visible && exerciseName) {
      const loadHistory = async () => {
        setIsLoading(true);
        setSelectedIndex(null);
        try {
          const data = await getExerciseProgressHistory(db, exerciseId, exerciseName);
          setRawHistory(data);
        } catch (e) {
          console.error('Error fetching exercise progress history for modal:', e);
        } finally {
          setIsLoading(false);
        }
      };
      loadHistory();
    }
  }, [visible, exerciseId, exerciseName, db]);

  // Aggregate and group raw items based on the active period
  const groupedData = useMemo<GroupedDataPoint[]>(() => {
    if (rawHistory.length === 0) return [];

    const groups: Record<
      string,
      {
        label: string;
        reps: number;
        maxWeight: number | null;
        weights: Set<number>;
        routineNames: Set<string>;
        periodText: string;
      }
    > = {};

    rawHistory.forEach((item) => {
      const date = new Date(item.completed_date + 'T00:00:00');
      const yearStr = String(date.getFullYear());
      const yearShort = yearStr.slice(-2);
      let key = '';
      let label = '';
      let periodText = '';

      if (activePeriod === 'week') {
        const startOfWeek = getStartOfWeekStr(item.completed_date);
        key = startOfWeek;
        const mondayDate = new Date(startOfWeek + 'T00:00:00');
        const day = mondayDate.getDate();
        const monthNames = [
          'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
          'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
        ];
        const monthLabel = monthNames[mondayDate.getMonth()];
        label = `${day} ${monthLabel}`;
        periodText = `Semana del Lunes ${day} de ${monthLabel}, ${mondayDate.getFullYear()}`;
      } else if (activePeriod === 'month') {
        const monthIndex = date.getMonth();
        const monthNames = [
          'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ];
        const monthShortNames = [
          'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
          'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
        ];
        key = `${yearStr}-${String(monthIndex + 1).padStart(2, '0')}`;
        label = `${monthShortNames[monthIndex]} ${yearShort}`;
        periodText = `${monthNames[monthIndex]} del ${yearStr}`;
      } else if (activePeriod === 'quarter') {
        const q = Math.floor(date.getMonth() / 3) + 1;
        key = `${yearStr}-Q${q}`;
        label = `T${q} ${yearShort}`;
        periodText = `${q}º Trimestre de ${yearStr}`;
      } else if (activePeriod === 'semester') {
        const s = date.getMonth() < 6 ? 1 : 2;
        key = `${yearStr}-S${s}`;
        label = `S${s} ${yearShort}`;
        periodText = `${s}º Semestre de ${yearStr}`;
      } else if (activePeriod === 'year') {
        key = yearStr;
        label = yearStr;
        periodText = `Año ${yearStr}`;
      }

      if (!groups[key]) {
        groups[key] = {
          label,
          reps: 0,
          maxWeight: null,
          weights: new Set(),
          routineNames: new Set(),
          periodText,
        };
      }
      groups[key].reps += item.total_reps;
      if (item.max_weight !== null && item.max_weight !== undefined) {
        if (groups[key].maxWeight === null || item.max_weight > groups[key].maxWeight!) {
          groups[key].maxWeight = item.max_weight;
        }
      }
      if (item.all_weights) {
        item.all_weights.split(',').forEach((wStr) => {
          const w = parseFloat(wStr);
          if (!isNaN(w) && w > 0) {
            groups[key].weights.add(w);
          }
        });
      }
      groups[key].routineNames.add(item.routine_name);
    });

    const result = Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => {
        const g = groups[key];
        return {
          key,
          label: g.label,
          totalReps: g.reps,
          maxWeight: g.maxWeight,
          weights: Array.from(g.weights).sort((a, b) => a - b),
          details: {
            periodText: g.periodText,
            routineCount: g.routineNames.size,
            avgRepsPerRoutine: Math.round(g.reps / Math.max(1, g.routineNames.size)),
          },
        };
      });

    return result;
  }, [rawHistory, activePeriod]);

  // Set default selection to the last index of groupedData
  useEffect(() => {
    if (groupedData.length > 0) {
      setSelectedIndex(groupedData.length - 1);
    } else {
      setSelectedIndex(null);
    }
  }, [groupedData]);

  // Find max reps in grouped data for chart scaling
  const maxGroupReps = useMemo(() => {
    if (groupedData.length === 0) return 10;
    return Math.max(...groupedData.map((d) => d.totalReps), 10);
  }, [groupedData]);

  // Find max weight in grouped data for chart scaling
  const maxGroupWeight = useMemo(() => {
    if (groupedData.length === 0) return 10;
    const weights = groupedData.map((d) => d.maxWeight ?? 0);
    return Math.max(...weights, 10);
  }, [groupedData]);

  const periods: { value: PeriodType; label: string }[] = [
    { value: 'week', label: 'Semana' },
    { value: 'month', label: 'Mes' },
    { value: 'quarter', label: 'Trimestre' },
    { value: 'semester', label: 'Semestre' },
    { value: 'year', label: 'Año' },
  ];

  const selectedData = selectedIndex !== null ? groupedData[selectedIndex] : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={[styles.content, { maxHeight: height * 0.85 }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <SymbolView
                name={{ ios: 'chart.bar.xaxis', android: 'bar_chart', web: 'bar_chart' }}
                size={22}
                tintColor="#3c87f7"
              />
              <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
                {exerciseName}
              </ThemedText>
              <Pressable onPress={showInfoAlert} style={{ padding: 4 }}>
                <SymbolView
                  name={{ ios: 'info.circle', android: 'info', web: 'info' }}
                  size={18}
                  tintColor={theme.textSecondary}
                />
              </Pressable>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <SymbolView
                name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                size={24}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
            Progreso acumulado de repeticiones totales y peso máximo por periodo.
          </ThemedText>

          {/* Loader or Content */}
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3c87f7" />
              <ThemedText style={{ marginTop: Spacing.two }} type="small">
                Cargando historial de ejercicio...
              </ThemedText>
            </View>
          ) : rawHistory.length === 0 ? (
            <View style={styles.emptyContainer}>
              <SymbolView
                name={{ ios: 'doc.richtext', android: 'description', web: 'description' }}
                size={40}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="smallBold" themeColor="textSecondary">
                Sin datos de entrenamiento
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                Completa este ejercicio en tus rutinas para comenzar a ver su progreso histórico acumulado.
              </ThemedText>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={styles.chartSection}
            >
              {/* Reps Chart Section Header */}
              <ThemedText type="smallBold" style={{ color: '#3c87f7', marginTop: Spacing.half }}>
                Volumen Total (Repeticiones)
              </ThemedText>

              {/* Aesthetic Chart Card */}
              <ThemedView type="background" style={styles.chartCard}>
                {/* Y-Axis Guidelines Background */}
                <View style={styles.chartGridLines}>
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chartScroll}
                >
                  {groupedData.map((dataPoint, idx) => {
                    const isSelected = selectedIndex === idx;
                    const barHeightPercent = getScaledHeight(dataPoint.totalReps, maxGroupReps);

                    return (
                      <Pressable
                        key={dataPoint.key}
                        onPress={() => setSelectedIndex(idx)}
                        style={styles.chartBarCol}
                      >
                        {/* Reps label on top of bar */}
                        <ThemedText
                          type="code"
                          style={[
                            styles.barValText,
                            {
                              color: isSelected ? '#3c87f7' : theme.textSecondary,
                              fontWeight: isSelected ? 'bold' : 'normal',
                            },
                          ]}
                        >
                          {dataPoint.totalReps}
                        </ThemedText>

                        {/* Bar Track and Fill */}
                        <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                height: `${Math.max(6, barHeightPercent)}%`,
                                backgroundColor: isSelected ? '#3c87f7' : '#5ba2f4',
                                shadowColor: isSelected ? '#3c87f7' : 'transparent',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: isSelected ? 0.4 : 0,
                                shadowRadius: 4,
                                elevation: isSelected ? 4 : 0,
                              },
                            ]}
                          />
                        </View>

                        {/* Date label at bottom */}
                        <ThemedText
                          type="code"
                          style={[
                            styles.barLabelText,
                            {
                              color: isSelected ? theme.text : theme.textSecondary,
                              fontWeight: isSelected ? 'bold' : 'normal',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {dataPoint.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </ThemedView>

              {/* Weight Chart Section Header */}
              <ThemedText type="smallBold" style={{ color: '#ff9500', marginTop: Spacing.one }}>
                Intensidad (Peso Máximo)
              </ThemedText>

              {/* Aesthetic Weight Chart Card */}
              <ThemedView type="background" style={styles.chartCard}>
                {/* Y-Axis Guidelines Background */}
                <View style={styles.chartGridLines}>
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                  <View style={[styles.gridLine, { borderColor: theme.backgroundSelected }]} />
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chartScroll}
                >
                  {groupedData.map((dataPoint, idx) => {
                    const isSelected = selectedIndex === idx;
                    const barHeightPercent = maxGroupWeight > 0 && dataPoint.maxWeight !== null
                      ? (dataPoint.maxWeight / maxGroupWeight) * 100
                      : 0;

                    return (
                      <Pressable
                        key={dataPoint.key}
                        onPress={() => setSelectedIndex(idx)}
                        style={styles.chartBarCol}
                      >
                        {/* Weight label on top of bar */}
                        <ThemedText
                          type="code"
                          style={[
                            styles.barValText,
                            {
                              color: isSelected ? '#ff9500' : theme.textSecondary,
                              fontWeight: isSelected ? 'bold' : 'normal',
                            },
                          ]}
                        >
                          {dataPoint.maxWeight !== null ? `${dataPoint.maxWeight} kg` : '-'}
                        </ThemedText>

                        {/* Bar Track and Layered Fills */}
                        <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
                          {dataPoint.weights.length > 0 ? (
                            dataPoint.weights.slice().sort((a, b) => b - a).map((w, wIdx) => {
                              const singleBarHeightPercent = getScaledHeight(w, maxGroupWeight);
                              const numWeights = dataPoint.weights.length;
                              const opacity = numWeights > 1 
                                ? 0.3 + (wIdx / (numWeights - 1)) * 0.7 
                                : 1.0;

                              return (
                                <View
                                  key={wIdx}
                                  style={[
                                    styles.barFill,
                                    {
                                      position: 'absolute',
                                      bottom: 0,
                                      left: 0,
                                      right: 0,
                                      height: `${Math.max(6, singleBarHeightPercent)}%`,
                                      backgroundColor: isSelected ? '#ff9500' : '#ffb03a',
                                      opacity: opacity,
                                    },
                                  ]}
                                />
                              );
                            })
                          ) : (
                            <View style={[styles.barFill, { height: 0 }]} />
                          )}
                        </View>

                        {/* Date label at bottom */}
                        <ThemedText
                          type="code"
                          style={[
                            styles.barLabelText,
                            {
                              color: isSelected ? theme.text : theme.textSecondary,
                              fontWeight: isSelected ? 'bold' : 'normal',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {dataPoint.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </ThemedView>

              {/* Aggregated Detail Info Panel */}
              {selectedData ? (() => {
                const previousData = (selectedIndex !== null && selectedIndex > 0) ? groupedData[selectedIndex - 1] : null;

                // Reps progression trend
                let repsTrendText = '';
                let repsTrendColor: string = theme.textSecondary;
                if (previousData) {
                  const diff = selectedData.totalReps - previousData.totalReps;
                  if (diff > 0) {
                    repsTrendText = ` (+${diff})`;
                    repsTrendColor = '#34c759';
                  } else if (diff < 0) {
                    repsTrendText = ` (${diff})`;
                    repsTrendColor = '#ff453a';
                  } else {
                    repsTrendText = ' (=)';
                  }
                }

                // Weight progression trend
                let weightTrendText = '';
                let weightTrendColor: string = theme.textSecondary;
                const hasWeight = selectedData.maxWeight !== null && selectedData.maxWeight !== undefined && selectedData.maxWeight > 0;
                if (selectedData.maxWeight !== null && selectedData.maxWeight !== undefined && selectedData.maxWeight > 0 &&
                    previousData && previousData.maxWeight !== null && previousData.maxWeight !== undefined && previousData.maxWeight > 0) {
                  const diff = selectedData.maxWeight - previousData.maxWeight;
                  if (diff > 0) {
                    weightTrendText = ` (+${diff} kg)`;
                    weightTrendColor = '#34c759';
                  } else if (diff < 0) {
                    weightTrendText = ` (${diff} kg)`;
                    weightTrendColor = '#ff453a';
                  } else {
                    weightTrendText = ' (=)';
                  }
                }

                return (
                  <ThemedView type="background" style={styles.detailCard}>
                    <View style={styles.detailHeader}>
                      <SymbolView
                        name={{ ios: 'calendar.circle.fill', android: 'calendar_month', web: 'calendar_month' }}
                        size={18}
                        tintColor="#3c87f7"
                      />
                      <ThemedText type="smallBold" style={{ marginLeft: Spacing.one }}>
                        {selectedData.details.periodText}
                      </ThemedText>
                    </View>

                    <View style={styles.detailGrid}>
                      <View style={styles.detailGridItem}>
                        <ThemedText type="code" themeColor="textSecondary">
                          VOLUMEN TOTAL
                        </ThemedText>
                        <ThemedText type="subtitle" style={styles.detailValue}>
                          {selectedData.totalReps} <ThemedText type="small">reps</ThemedText>
                          {repsTrendText ? (
                            <ThemedText type="smallBold" style={{ color: repsTrendColor, fontSize: 11 }}>
                              {repsTrendText}
                            </ThemedText>
                          ) : null}
                        </ThemedText>
                      </View>

                      <View style={styles.detailGridItem}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <ThemedText type="code" themeColor="textSecondary">
                            RUTINAS HECHAS
                          </ThemedText>
                        </View>
                        <ThemedText type="subtitle" style={styles.detailValue}>
                          {selectedData.details.routineCount}
                        </ThemedText>
                      </View>

                      <View style={styles.detailGridItem}>
                        <ThemedText type="code" themeColor="textSecondary">
                          PROMEDIO / RUTINA
                        </ThemedText>
                        <ThemedText type="subtitle" style={styles.detailValue}>
                          {selectedData.details.avgRepsPerRoutine} <ThemedText type="small">reps</ThemedText>
                        </ThemedText>
                      </View>
                    </View>

                    {selectedData.maxWeight !== null && selectedData.maxWeight !== undefined && selectedData.maxWeight > 0 && (
                      <View style={{ marginTop: Spacing.one, borderTopWidth: 1, borderColor: 'rgba(128,128,128,0.1)', paddingTop: Spacing.one, gap: 4 }}>
                        <View style={styles.detailHeader}>
                          <SymbolView
                            name={{ ios: 'scalemass.fill', android: 'scale', web: 'scale' }}
                            size={16}
                            tintColor="#ff9500"
                          />
                          <ThemedText type="smallBold" style={{ marginLeft: Spacing.one, color: '#ff9500' }}>
                            PESO MÁXIMO DEL PERIODO: {selectedData.maxWeight} kg
                            {weightTrendText ? (
                              <ThemedText type="smallBold" style={{ color: weightTrendColor }}>
                                {weightTrendText}
                              </ThemedText>
                            ) : null}
                          </ThemedText>
                        </View>
                        {selectedData.weights && selectedData.weights.length > 0 && (
                          <ThemedText type="code" style={{ color: theme.textSecondary, marginLeft: 22 }}>
                            Pesos usados: {selectedData.weights.map(w => `${w} kg`).join(', ')}
                          </ThemedText>
                        )}
                      </View>
                    )}
                  </ThemedView>
                );
              })() : (
                <View style={styles.noSelectionBox}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Selecciona una barra del gráfico para ver detalles del periodo.
                  </ThemedText>
                </View>
              )}
            </ScrollView>
          )}

          {/* Timeframe selector at the bottom */}
          <View style={styles.selectorWrapper}>
            <ThemedText type="code" themeColor="textSecondary" style={styles.selectorTitle}>
              COMPARAR POR UNIDAD DE TIEMPO
            </ThemedText>
            
            <View style={[styles.selectorContainer, { backgroundColor: theme.background }]}>
              {periods.map((p) => {
                const isActive = activePeriod === p.value;
                return (
                  <Pressable
                    key={p.value}
                    onPress={() => setActivePeriod(p.value)}
                    style={({ pressed }) => [
                      styles.selectorTab,
                      isActive && { backgroundColor: '#3c87f7' },
                      pressed && styles.pressed,
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[
                        styles.selectorTabText,
                        { color: isActive ? '#ffffff' : theme.textSecondary },
                      ]}
                    >
                      {p.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  content: {
    width: '100%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    padding: Spacing.three + Spacing.half,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 10,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
    flex: 1,
    marginRight: Spacing.two,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: Spacing.half,
  },
  subtitle: {
    marginBottom: Spacing.one,
  },
  loadingContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    height: 250,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  chartSection: {
    gap: Spacing.two + Spacing.half,
  },
  chartCard: {
    height: 180,
    borderRadius: Spacing.three,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.1)',
  },
  chartGridLines: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 25,
    bottom: 25,
    justifyContent: 'space-between',
  },
  gridLine: {
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.2,
  },
  chartScroll: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.three,
  },
  chartBarCol: {
    alignItems: 'center',
    gap: Spacing.one,
    width: 44,
  },
  barValText: {
    fontSize: 10,
    fontWeight: '600',
  },
  barTrack: {
    height: 100,
    width: 18,
    borderRadius: 9,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 9,
  },
  barLabelText: {
    fontSize: 10,
    textAlign: 'center',
    width: 55,
  },
  detailCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.1)',
    gap: Spacing.two,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  detailGridItem: {
    flex: 1,
    gap: Spacing.half,
  },
  detailValue: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  noSelectionBox: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(128, 128, 128, 0.2)',
    borderRadius: Spacing.three,
  },
  selectorWrapper: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  selectorTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  selectorContainer: {
    flexDirection: 'row',
    borderRadius: Spacing.two,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  selectorTab: {
    flex: 1,
    paddingVertical: Spacing.one + Spacing.half,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Spacing.one + Spacing.half,
  },
  selectorTabText: {
    fontSize: 11,
  },
  pressed: {
    opacity: 0.85,
  },
});
