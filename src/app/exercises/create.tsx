import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getExerciseById,
  insertExercise,
  updateExercise,
  Exercise,
  SeriesConfigItem,
  InitialStateConfig,
} from '@/database/database';
import { useAlert } from '@/components/ui/alert-provider';
import { MUSCLE_ZONES, MuscleIntensity, getMuscleName } from '@/constants/muscle-groups';
import { MuscleVisualizerModal } from '@/components/ui/muscle-visualizer-modal';

export default function CreateExerciseScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { alert } = useAlert();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  // Form states
  const [name, setName] = useState('');
  const [defaultSets, setDefaultSets] = useState(3);
  const [defaultReps, setDefaultReps] = useState(10);
  const [isConstant, setIsConstant] = useState(true);
  const [variableSets, setVariableSets] = useState<SeriesConfigItem[]>([
    { set: 1, reps: 10 },
    { set: 2, reps: 10 },
    { set: 3, reps: 10 },
  ]);
  const [videoUrl, setVideoUrl] = useState('');
  const [weight, setWeight] = useState('');
  const [selectedMuscles, setSelectedMuscles] = useState<{ muscle_id: string; intensity: MuscleIntensity }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showIntensityInfo, setShowIntensityInfo] = useState(false);
  const [visualizerVisible, setVisualizerVisible] = useState(false);
  const [focusedMuscleId, setFocusedMuscleId] = useState<string | null>(null);

  const handleLongPressMuscle = (muscleId: string) => {
    setFocusedMuscleId(muscleId);
    setVisualizerVisible(true);
  };

  // Load existing exercise details if editing
  useEffect(() => {
    if (!isEditing) return;

    const loadExercise = async () => {
      try {
        setIsLoading(true);
        const exerciseId = parseInt(id, 10);
        const exercise = await getExerciseById(db, exerciseId);
        
        if (exercise) {
          setName(exercise.name);
          setDefaultSets(exercise.default_sets);
          setDefaultReps(exercise.default_reps);
          setIsConstant(exercise.is_constant === 1);
          setVideoUrl(exercise.video_url || '');
          setWeight(exercise.weight !== null && exercise.weight !== undefined ? exercise.weight.toString() : '');
          setSelectedMuscles(exercise.muscles || []);

          if (exercise.is_constant === 0 && exercise.series_config) {
            try {
              const parsedConfig = JSON.parse(exercise.series_config) as SeriesConfigItem[];
              setVariableSets(parsedConfig);
            } catch (e) {
              console.error('Failed to parse series_config:', e);
            }
          }

        } else {
          alert('Error', 'No se encontró el ejercicio solicitado.');
          router.back();
        }
      } catch (error) {
        console.error('Error loading exercise for edit:', error);
        alert('Error', 'Error al cargar los datos del ejercicio.');
      } finally {
        setIsLoading(false);
      }
    };

    loadExercise();
  }, [db, id, isEditing]);

  // Adjust variable sets count when defaultSets changes
  useEffect(() => {
    setVariableSets((prev) => {
      const currentCount = prev.length;
      if (defaultSets === currentCount) return prev;

      if (defaultSets > currentCount) {
        const added = Array.from({ length: defaultSets - currentCount }, (_, i) => ({
          set: currentCount + i + 1,
          reps: prev[currentCount - 1]?.reps ?? defaultReps,
        }));
        return [...prev, ...added];
      } else {
        return prev.slice(0, defaultSets);
      }
    });
  }, [defaultSets, defaultReps]);

  // Handle variable set rep change
  const handleVariableRepChange = (index: number, repsStr: string) => {
    const val = parseInt(repsStr, 10) || 0;
    setVariableSets((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, reps: val } : item))
    );
  };

  // Adjust sets count via + / - buttons safely
  const adjustSets = (diff: number) => {
    setDefaultSets((prev) => Math.max(1, Math.min(20, prev + diff)));
  };

  // Adjust reps count via + / - buttons safely
  const adjustReps = (diff: number) => {
    setDefaultReps((prev) => Math.max(1, Math.min(100, prev + diff)));
  };

  // Form submission handler
  const handleSave = async () => {
    if (!name.trim()) {
      alert('Validación', 'El nombre del ejercicio es requerido.');
      return;
    }

    const seriesConfigStr = !isConstant ? JSON.stringify(variableSets) : null;
    const initialStateStr = null;

    const primaryMuscles = selectedMuscles.filter(m => m.intensity === 'primary');
    const mainMuscleId = primaryMuscles.length > 0 ? primaryMuscles[0].muscle_id : (selectedMuscles.length > 0 ? selectedMuscles[0].muscle_id : null);
    
    let mainZoneName: string | null = null;
    if (mainMuscleId) {
      const zone = MUSCLE_ZONES.find(z => z.muscles.some(m => m.id === mainMuscleId));
      mainZoneName = zone ? zone.zone : null;
    }

    const parsedWeight = weight.trim() !== '' ? parseFloat(weight.replace(',', '.')) : null;
    if (parsedWeight !== null && isNaN(parsedWeight)) {
      alert('Validación', 'El peso ingresado debe ser un número válido.');
      return;
    }

    const exerciseData: Omit<Exercise, 'id' | 'created_at'> = {
      name: name.trim(),
      default_sets: defaultSets,
      default_reps: isConstant ? defaultReps : 0,
      is_constant: isConstant ? 1 : 0,
      series_config: seriesConfigStr,
      video_url: videoUrl.trim() || null,
      initial_state: initialStateStr,
      muscle_group: mainZoneName,
      muscles: selectedMuscles,
      weight: parsedWeight,
    };

    try {
      setIsLoading(true);
      if (isEditing) {
        await updateExercise(db, parseInt(id!, 10), exerciseData);
        alert('Éxito', 'Ejercicio actualizado correctamente.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        await insertExercise(db, exerciseData);
        alert('Éxito', 'Ejercicio creado correctamente.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      console.error('Error saving exercise:', error);
      alert(
        'Error',
        `No se pudo guardar el ejercicio: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardContainer}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
              <SymbolView
                name={{ ios: 'chevron.left', web: 'chevron_left' }}
                size={24}
                tintColor={theme.text}
              />
            </Pressable>
            <ThemedText type="subtitle" style={styles.headerTitle}>
              {isEditing ? 'Editar Ejercicio' : 'Nuevo Ejercicio'}
            </ThemedText>
            <View style={styles.headerRightPlaceholder} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            
            {/* Exercise Name */}
            <View style={styles.formGroup}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Nombre del Ejercicio
              </ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                placeholder="Ej. Press de Banca, Sentadillas"
                placeholderTextColor={theme.textSecondary}
                value={name}
                onChangeText={setName}
                editable={!isLoading}
              />
            </View>

            {/* Muscle Group Selection */}
            <View style={styles.formGroup}>
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
                Músculos Involucrados e Intensidad
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
                Selecciona los músculos que trabaja este ejercicio y define su nivel: Primario (P), Secundario (S) o Estabilizador (E). Mantén presionado un músculo para ver su ubicación en el cuerpo.
              </ThemedText>

              <Pressable
                onPress={() => setShowIntensityInfo(!showIntensityInfo)}
                style={({ pressed }) => [
                  styles.infoToggleBtn,
                  pressed && styles.pressed,
                ]}>
                <SymbolView
                  name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }}
                  size={16}
                  tintColor="#3c87f7"
                />
                <ThemedText type="small" style={{ color: '#3c87f7', fontWeight: 'bold' }}>
                  ¿Qué significa Primario, Secundario o Estabilizador?
                </ThemedText>
                <SymbolView
                  name={showIntensityInfo ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                  size={16}
                  tintColor="#3c87f7"
                />
              </Pressable>

              {showIntensityInfo && (
                <View style={[styles.infoCard, { backgroundColor: theme.backgroundSelected }]}>
                  <View style={styles.infoCardRow}>
                    <View style={[styles.intensityBadge, { backgroundColor: '#3c87f7' }]}>
                      <ThemedText type="code" style={styles.intensityBadgeText}>P</ThemedText>
                    </View>
                    <View style={styles.infoCardTextContainer}>
                      <ThemedText type="smallBold">Primario (Motor Principal)</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        El músculo que realiza la mayor parte del esfuerzo durante el ejercicio y es el objetivo principal del entrenamiento.
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.infoCardRow}>
                    <View style={[styles.intensityBadge, { backgroundColor: '#34c759' }]}>
                      <ThemedText type="code" style={styles.intensityBadgeText}>S</ThemedText>
                    </View>
                    <View style={styles.infoCardTextContainer}>
                      <ThemedText type="smallBold">Secundario (Sinergista)</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Músculos que ayudan de manera activa a realizar el movimiento, asistiendo al músculo primario.
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.infoCardRow}>
                    <View style={[styles.intensityBadge, { backgroundColor: '#ff9500' }]}>
                      <ThemedText type="code" style={styles.intensityBadgeText}>E</ThemedText>
                    </View>
                    <View style={styles.infoCardTextContainer}>
                      <ThemedText type="smallBold">Estabilizador (Fijador)</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Músculos que se contraen para mantener una postura firme y equilibrada, protegiendo las articulaciones sin realizar el movimiento principal.
                      </ThemedText>
                    </View>
                  </View>
                </View>
              )}

              {MUSCLE_ZONES.map((zone) => (
                <View key={zone.zone} style={styles.zoneGroup}>
                  <ThemedText type="smallBold" style={styles.zoneHeader}>
                    {zone.zone}
                  </ThemedText>
                  <View style={styles.musclesGrid}>
                    {zone.muscles.map((muscle) => {
                      const existing = selectedMuscles.find((m) => m.muscle_id === muscle.id);
                      const isSelected = !!existing;
                      const intensity = existing?.intensity;

                      const handleIntensitySelect = (level: MuscleIntensity) => {
                        setSelectedMuscles((prev) => {
                          const filtered = prev.filter((m) => m.muscle_id !== muscle.id);
                          return [...filtered, { muscle_id: muscle.id, intensity: level }];
                        });
                      };

                      const handleToggleMuscle = () => {
                        if (isSelected) {
                          setSelectedMuscles((prev) => prev.filter((m) => m.muscle_id !== muscle.id));
                        } else {
                          setSelectedMuscles((prev) => [...prev, { muscle_id: muscle.id, intensity: 'primary' }]);
                        }
                      };

                      return (
                        <View
                          key={muscle.id}
                          style={[
                            styles.muscleItemRow,
                            { backgroundColor: theme.backgroundElement },
                            isSelected && styles.muscleItemRowActive,
                          ]}>
                          <Pressable
                            onPress={handleToggleMuscle}
                            onLongPress={() => handleLongPressMuscle(muscle.id)}
                            delayLongPress={350}
                            style={styles.muscleItemLeft}>
                            <SymbolView
                              name={
                                isSelected
                                  ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                                  : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }
                              }
                              size={20}
                              tintColor={
                                isSelected
                                  ? intensity === 'primary'
                                    ? '#3c87f7'
                                    : intensity === 'secondary'
                                    ? '#34c759'
                                    : '#ff9500'
                                  : theme.textSecondary
                              }
                            />
                            <ThemedText
                              type="small"
                              style={[
                                styles.muscleNameLabel,
                                isSelected && { color: theme.text, fontWeight: 'bold' },
                              ]}>
                              {muscle.name}
                            </ThemedText>
                          </Pressable>

                          {isSelected && (
                            <View style={styles.intensitySelector}>
                              {(['primary', 'secondary', 'stabilizer'] as MuscleIntensity[]).map((level) => {
                                const isActive = intensity === level;
                                const labels: Record<MuscleIntensity, string> = {
                                  primary: 'P',
                                  secondary: 'S',
                                  stabilizer: 'E',
                                };
                                const colors: Record<MuscleIntensity, string> = {
                                  primary: '#3c87f7',
                                  secondary: '#34c759',
                                  stabilizer: '#ff9500',
                                };
                                return (
                                  <Pressable
                                    key={level}
                                    onPress={() => handleIntensitySelect(level)}
                                    style={[
                                      styles.intensityButton,
                                      isActive && { backgroundColor: colors[level] },
                                    ]}>
                                    <ThemedText
                                      type="code"
                                      style={[
                                        styles.intensityButtonText,
                                        isActive && { color: '#ffffff', fontWeight: 'bold' },
                                      ]}>
                                      {labels[level]}
                                    </ThemedText>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>

            {/* Video URL */}
            <View style={styles.formGroup}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                URL de Video (YouTube, TikTok, Instagram)
              </ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                placeholder="https://www.youtube.com/watch?v=..."
                placeholderTextColor={theme.textSecondary}
                value={videoUrl}
                onChangeText={setVideoUrl}
                autoCapitalize="none"
                keyboardType="url"
                editable={!isLoading}
              />
            </View>

            {/* Default Weight */}
            <View style={styles.formGroup}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Peso Predeterminado (opcional)
              </ThemedText>
              <View style={[styles.inputWithSuffix, { backgroundColor: theme.backgroundElement }]}>
                <TextInput
                  style={[styles.suffixInput, { color: theme.text }]}
                  placeholder="Ej. 20, 15.5 (Dejar vacío si no aplica)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="numeric"
                  value={weight}
                  onChangeText={setWeight}
                  editable={!isLoading}
                />
                <ThemedText type="smallBold" themeColor="textSecondary" style={{ marginRight: Spacing.three }}>
                  kg
                </ThemedText>
              </View>
            </View>

            {/* Series Configuration Selector */}
            <View style={styles.rowFormGroup}>
              <View>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Series Constantes
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {isConstant ? 'Mismas reps en todas las series' : 'Reps independientes por serie'}
                </ThemedText>
              </View>
              <Switch
                value={isConstant}
                onValueChange={setIsConstant}
                trackColor={{ false: '#767577', true: '#3c87f7' }}
                thumbColor={isConstant ? '#ffffff' : '#f4f3f4'}
              />
            </View>

            {/* Sets counter */}
            <View style={styles.formGroup}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Número de Series
              </ThemedText>
              <View style={styles.counterRow}>
                <Pressable
                  onPress={() => adjustSets(-1)}
                  style={[styles.counterButton, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="subtitle" style={styles.counterButtonText}>-</ThemedText>
                </Pressable>
                <ThemedText type="subtitle" style={styles.counterValue}>
                  {defaultSets}
                </ThemedText>
                <Pressable
                  onPress={() => adjustSets(1)}
                  style={[styles.counterButton, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="subtitle" style={styles.counterButtonText}>+</ThemedText>
                </Pressable>
              </View>
            </View>

            {/* Repetitions (Constant) */}
            {isConstant ? (
              <View style={styles.formGroup}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Repeticiones por Serie
                </ThemedText>
                <View style={styles.counterRow}>
                  <Pressable
                    onPress={() => adjustReps(-1)}
                    style={[styles.counterButton, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="subtitle" style={styles.counterButtonText}>-</ThemedText>
                  </Pressable>
                  <ThemedText type="subtitle" style={styles.counterValue}>
                    {defaultReps}
                  </ThemedText>
                  <Pressable
                    onPress={() => adjustReps(1)}
                    style={[styles.counterButton, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="subtitle" style={styles.counterButtonText}>+</ThemedText>
                  </Pressable>
                </View>
              </View>
            ) : (
              /* Repetitions (Variable / Subsets list) */
              <View style={styles.formGroup}>
                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
                  Configuración de cada Serie (Subsets)
                </ThemedText>
                <View style={styles.variableGrid}>
                  {variableSets.map((item, index) => (
                    <View
                      key={index}
                      style={[styles.variableRow, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="smallBold">Serie {index + 1}</ThemedText>
                      <View style={styles.variableInputContainer}>
                        <TextInput
                          style={[styles.variableInput, { color: theme.text }]}
                          keyboardType="numeric"
                          value={item.reps.toString()}
                          onChangeText={(text) => handleVariableRepChange(index, text)}
                          selectTextOnFocus
                        />
                        <ThemedText type="small" themeColor="textSecondary">reps</ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}


            {/* Save Button */}
            <Pressable
              onPress={handleSave}
              disabled={isLoading}
              style={({ pressed }) => [
                styles.saveButton,
                { backgroundColor: theme.text },
                pressed && styles.pressed,
                isLoading && styles.disabled,
              ]}>
              <ThemedText
                type="default"
                style={[styles.saveButtonText, { color: theme.background }]}>
                {isLoading ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Ejercicio'}
              </ThemedText>
            </Pressable>

            {/* Back bottom spacing */}
            <View style={styles.bottomSpacer} />
          </ScrollView>

          <MuscleVisualizerModal
            visible={visualizerVisible}
            muscleId={focusedMuscleId}
            selectedMuscles={selectedMuscles}
            onClose={() => {
              setVisualizerVisible(false);
              setFocusedMuscleId(null);
            }}
          />
        </SafeAreaView>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
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
    marginBottom: Spacing.three,
  },
  backButton: {
    padding: Spacing.one,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerRightPlaceholder: {
    width: 40,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  formGroup: {
    gap: Spacing.one,
  },
  rowFormGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  input: {
    fontSize: 16,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? Spacing.two + Spacing.half : Spacing.two,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  counterButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterButtonText: {
    fontSize: 24,
    lineHeight: 28,
    textAlign: 'center',
  },
  counterValue: {
    fontSize: 24,
    fontWeight: 'bold',
    minWidth: 40,
    textAlign: 'center',
  },
  sectionTitle: {
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  variableGrid: {
    gap: Spacing.two,
  },
  variableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  variableInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  variableInput: {
    fontSize: 16,
    fontWeight: 'bold',
    width: 60,
    textAlign: 'right',
    paddingVertical: Spacing.half,
  },
  sectionCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.three,
    gap: Spacing.two,
  },
  sectionHeader: {
    fontSize: 18,
  },
  sectionDescription: {
    fontSize: 13,
    marginBottom: Spacing.one,
  },
  row: {
    flexDirection: 'row',
  },
  flexField: {
    flex: 1,
    gap: Spacing.one,
  },
  inputWithSuffix: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? Spacing.two : Spacing.one,
  },
  suffixInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  saveButton: {
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  bottomSpacer: {
    height: Spacing.five,
  },
  zoneGroup: {
    marginBottom: Spacing.three,
    gap: Spacing.one,
  },
  zoneHeader: {
    fontSize: 14,
    opacity: 0.8,
    marginBottom: Spacing.half,
  },
  musclesGrid: {
    gap: Spacing.one,
  },
  muscleItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  muscleItemRowActive: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.15)',
  },
  muscleItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    paddingVertical: Spacing.half,
  },
  muscleNameLabel: {
    fontSize: 14,
  },
  intensitySelector: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  intensityButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  intensityButtonText: {
    fontSize: 11,
    color: '#8e8e93',
  },
  infoToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    alignSelf: 'flex-start',
  },
  infoCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  infoCardRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    alignItems: 'flex-start',
  },
  infoCardTextContainer: {
    flex: 1,
    gap: Spacing.half,
  },
  intensityBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  intensityBadgeText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
