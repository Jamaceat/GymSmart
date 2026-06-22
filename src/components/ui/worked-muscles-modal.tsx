import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Modal,
  Pressable,
  View,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AnatomySvg } from './anatomy-svg';
import { getWorkedMusclesForRange, WorkedMuscle } from '@/database/database';
import { getMuscleName } from '@/constants/muscle-groups';

interface WorkedMusclesModalProps {
  visible: boolean;
  onClose: () => void;
  dateRange: { start: string; end: string } | null;
  filterLabel: string;
}

export function WorkedMusclesModal({
  visible,
  onClose,
  dateRange,
  filterLabel,
}: WorkedMusclesModalProps) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [workedMuscles, setWorkedMuscles] = useState<WorkedMuscle[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      const loadWorkedMuscles = async () => {
        setIsLoading(true);
        try {
          const data = await getWorkedMusclesForRange(
            db,
            dateRange?.start ?? null,
            dateRange?.end ?? null
          );
          setWorkedMuscles(data);
        } catch (e) {
          console.error('Error loading worked muscles:', e);
        } finally {
          setIsLoading(false);
        }
      };
      loadWorkedMuscles();
    }
  }, [visible, dateRange, db]);

  // Calculate dynamic dimensions for side-by-side SVG views
  const isTablet = width > 768;
  const paddingSize = Spacing.four * 2;
  const availableWidth = width - paddingSize;
  const svgWidth = Math.min(220, Math.max(120, isTablet ? 200 : availableWidth / 2 - 12));
  const svgHeight = svgWidth * 2;

  // Group muscles by intensity for textual list
  const primaryMuscles = workedMuscles.filter((m) => m.intensity === 'primary');
  const secondaryMuscles = workedMuscles.filter((m) => m.intensity === 'secondary');
  const stabilizerMuscles = workedMuscles.filter((m) => m.intensity === 'stabilizer');

  const rangeText = dateRange
    ? `${dateRange.start} al ${dateRange.end}`
    : 'Todo el historial';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <ThemedView style={styles.modalContainer}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleContainer}>
              <ThemedText type="subtitle" style={styles.headerTitle}>
                Anatomía de Trabajo
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Periodo: {filterLabel} ({rangeText})
              </ThemedText>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <SymbolView
                name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                size={28}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3c87f7" />
              <ThemedText style={{ marginTop: Spacing.two }} type="small">
                Cargando mapa muscular...
              </ThemedText>
            </View>
          ) : workedMuscles.length === 0 ? (
            <View style={styles.emptyContainer}>
              <SymbolView
                name={{ ios: 'figure.strengthtraining.traditional', android: 'accessibility_new', web: 'accessibility_new' }}
                size={64}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>
                Sin músculos registrados
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ textAlign: 'center' }}>
                Completa ejercicios en tus rutinas programadas durante este periodo para visualizar el trabajo muscular.
              </ThemedText>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {/* Interactive side-by-side diagrams */}
              <View style={[styles.diagramsCard, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.diagramCol}>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.viewLabel}>
                    VISTA FRONTAL
                  </ThemedText>
                  <AnatomySvg
                    view="front"
                    selectedMuscles={workedMuscles}
                    width={svgWidth}
                    height={svgHeight}
                  />
                </View>
                <View style={styles.diagramCol}>
                  <ThemedText type="code" themeColor="textSecondary" style={styles.viewLabel}>
                    VISTA POSTERIOR
                  </ThemedText>
                  <AnatomySvg
                    view="back"
                    selectedMuscles={workedMuscles}
                    width={svgWidth}
                    height={svgHeight}
                  />
                </View>
              </View>

              {/* Intensity Legend */}
              <View style={styles.legendContainer}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#3c87f7' }]} />
                  <ThemedText type="code" style={styles.legendText}>Primario</ThemedText>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#34c759' }]} />
                  <ThemedText type="code" style={styles.legendText}>Secundario</ThemedText>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#ff9500' }]} />
                  <ThemedText type="code" style={styles.legendText}>Estabilizador</ThemedText>
                </View>
              </View>

              {/* Text Breakdown Section */}
              <View style={styles.breakdownSection}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Detalle de Músculos Estimulados
                </ThemedText>

                {/* Primary */}
                {primaryMuscles.length > 0 && (
                  <View style={styles.groupContainer}>
                    <View style={styles.groupHeader}>
                      <View style={[styles.intensityIndicator, { backgroundColor: '#3c87f7' }]} />
                      <ThemedText type="smallBold">Primarios / Enfoque Principal</ThemedText>
                    </View>
                    <View style={styles.pillsContainer}>
                      {primaryMuscles.map((m) => (
                        <View key={m.muscle_id} style={[styles.pill, { backgroundColor: 'rgba(60,135,247,0.1)', borderColor: '#3c87f7' }]}>
                          <ThemedText type="code" style={{ color: '#3c87f7', fontWeight: 'bold' }}>
                            {getMuscleName(m.muscle_id)}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Secondary */}
                {secondaryMuscles.length > 0 && (
                  <View style={styles.groupContainer}>
                    <View style={styles.groupHeader}>
                      <View style={[styles.intensityIndicator, { backgroundColor: '#34c759' }]} />
                      <ThemedText type="smallBold">Secundarios / Sinergistas</ThemedText>
                    </View>
                    <View style={styles.pillsContainer}>
                      {secondaryMuscles.map((m) => (
                        <View key={m.muscle_id} style={[styles.pill, { backgroundColor: 'rgba(52,199,89,0.1)', borderColor: '#34c759' }]}>
                          <ThemedText type="code" style={{ color: '#34c759', fontWeight: 'bold' }}>
                            {getMuscleName(m.muscle_id)}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Stabilizer */}
                {stabilizerMuscles.length > 0 && (
                  <View style={styles.groupContainer}>
                    <View style={styles.groupHeader}>
                      <View style={[styles.intensityIndicator, { backgroundColor: '#ff9500' }]} />
                      <ThemedText type="smallBold">Estabilizadores / Soporte</ThemedText>
                    </View>
                    <View style={styles.pillsContainer}>
                      {stabilizerMuscles.map((m) => (
                        <View key={m.muscle_id} style={[styles.pill, { backgroundColor: 'rgba(255,149,0,0.1)', borderColor: '#ff9500' }]}>
                          <ThemedText type="code" style={{ color: '#ff9500', fontWeight: 'bold' }}>
                            {getMuscleName(m.muscle_id)}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.1)',
  },
  headerTitleContainer: {
    flex: 1,
    gap: Spacing.half,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: Spacing.one,
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
    paddingHorizontal: Spacing.five,
    gap: Spacing.three,
  },
  scrollContent: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  diagramsCard: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingVertical: Spacing.four,
    borderRadius: Spacing.four,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  diagramCol: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  viewLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
    paddingVertical: Spacing.one,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  breakdownSection: {
    gap: Spacing.three,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: Spacing.half,
  },
  groupContainer: {
    gap: Spacing.two,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  intensityIndicator: {
    width: 6,
    height: 16,
    borderRadius: 3,
  },
  pillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + Spacing.half,
  },
  pill: {
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
