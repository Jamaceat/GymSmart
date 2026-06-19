import React, { useState } from 'react';
import { StyleSheet, Modal, Pressable, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MUSCLE_ZONES, getMuscleName, MuscleIntensity } from '@/constants/muscle-groups';
import { AnatomySvg } from './anatomy-svg';

interface MuscleVisualizerModalProps {
  visible: boolean;
  muscleId: string | null;
  selectedMuscles?: { muscle_id: string; intensity: MuscleIntensity }[];
  onClose: () => void;
}

const BACK_MUSCLES = new Set([
  'trapecio_superior',
  'trapecio_medio_inferior',
  'dorsales',
  'deltoides_posterior',
  'triceps',
  'lumbares',
  'gluteo_medio',
  'gluteo_mayor',
  'isquiotibiales',
]);

function getMuscleZoneName(muscleId: string | null): string {
  if (!muscleId) return '';
  const zone = MUSCLE_ZONES.find((z) => z.muscles.some((m) => m.id === muscleId));
  return zone ? zone.zone : '';
}

export function MuscleVisualizerModal({
  visible,
  muscleId,
  selectedMuscles = [],
  onClose,
}: MuscleVisualizerModalProps) {
  const theme = useTheme();
  const [view, setView] = useState<'front' | 'back'>('front');
  const [prevMuscleId, setPrevMuscleId] = useState<string | null>(null);

  // Sync view when the modal opens or focuses on a new muscle
  if (muscleId !== prevMuscleId) {
    setPrevMuscleId(muscleId);
    if (muscleId) {
      setView(BACK_MUSCLES.has(muscleId) ? 'back' : 'front');
    }
  }

  if (!muscleId) return null;

  const muscleName = getMuscleName(muscleId);
  const zoneName = getMuscleZoneName(muscleId);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Prevent taps inside the card from closing it */}
        <Pressable style={{ width: '100%', maxWidth: 340 }}>
          <ThemedView type="backgroundElement" style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.titleContainer}>
                <ThemedText type="smallBold" style={styles.muscleTitle}>
                  {muscleName}
                </ThemedText>
                {zoneName ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.zoneSub}>
                    Zona: {zoneName}
                  </ThemedText>
                ) : null}
              </View>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              >
                <SymbolView
                  name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'close' }}
                  size={24}
                  tintColor={theme.textSecondary}
                />
              </Pressable>
            </View>

            {/* View Selector (Front / Back) */}
            <View style={[styles.toggleContainer, { backgroundColor: theme.backgroundSelected }]}>
              <Pressable
                onPress={() => setView('front')}
                style={[
                  styles.toggleBtn,
                  view === 'front' && [styles.toggleBtnActive, { backgroundColor: theme.backgroundElement }],
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={[
                    styles.toggleText,
                    view === 'front' ? { color: theme.text } : { color: theme.textSecondary },
                  ]}
                >
                  Vista Frontal
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setView('back')}
                style={[
                  styles.toggleBtn,
                  view === 'back' && [styles.toggleBtnActive, { backgroundColor: theme.backgroundElement }],
                ]}
              >
                <ThemedText
                  type="smallBold"
                  style={[
                    styles.toggleText,
                    view === 'back' ? { color: theme.text } : { color: theme.textSecondary },
                  ]}
                >
                  Vista Posterior
                </ThemedText>
              </Pressable>
            </View>

            {/* SVG Visualizer */}
            <View style={styles.visualizerWrapper}>
              <AnatomySvg
                view={view}
                selectedMuscles={selectedMuscles}
                activeMuscleId={muscleId}
                width={180}
                height={320}
              />
            </View>

            {/* Legend / Info Card */}
            <View style={styles.legendContainer}>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: '#3c87f7' }]} />
                  <ThemedText type="code" style={styles.legendLabel}>
                    P. Enfoque / Primario
                  </ThemedText>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: '#34c759' }]} />
                  <ThemedText type="code" style={styles.legendLabel}>
                    Secundario
                  </ThemedText>
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: '#ff9500' }]} />
                  <ThemedText type="code" style={styles.legendLabel}>
                    Estabilizador
                  </ThemedText>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.dot, { backgroundColor: theme.backgroundSelected }]} />
                  <ThemedText type="code" style={styles.legendLabel}>
                    No Involucrado
                  </ThemedText>
                </View>
              </View>
            </View>

            {/* Bottom Hint */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.hintText}>
              El músculo seleccionado se resalta en azul brillante.
            </ThemedText>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  content: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three + Spacing.two,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.1)',
    paddingBottom: Spacing.two,
  },
  titleContainer: {
    flex: 1,
    gap: Spacing.half,
  },
  muscleTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  zoneSub: {
    fontSize: 12,
  },
  closeBtn: {
    padding: Spacing.one,
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: Spacing.two,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: Spacing.one + Spacing.half,
    borderRadius: Spacing.one + Spacing.half,
    alignItems: 'center',
  },
  toggleBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleText: {
    fontSize: 13,
  },
  visualizerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    backgroundColor: 'rgba(128,128,128,0.03)',
    borderRadius: Spacing.three,
  },
  legendContainer: {
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  legendItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 11,
    opacity: 0.8,
  },
  hintText: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
  },
});
