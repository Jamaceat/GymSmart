import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Switch,
  Alert,
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

export default function CreateExerciseScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
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
  
  // Initial state / baseline states
  const [initialWeight, setInitialWeight] = useState('');
  const [initialReps, setInitialReps] = useState('');
  const [initialNotes, setInitialNotes] = useState('');

  const [isLoading, setIsLoading] = useState(false);

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

          if (exercise.is_constant === 0 && exercise.series_config) {
            try {
              const parsedConfig = JSON.parse(exercise.series_config) as SeriesConfigItem[];
              setVariableSets(parsedConfig);
            } catch (e) {
              console.error('Failed to parse series_config:', e);
            }
          }

          if (exercise.initial_state) {
            try {
              const parsedState = JSON.parse(exercise.initial_state) as InitialStateConfig;
              setInitialWeight(parsedState.weight.toString());
              setInitialReps(parsedState.reps.toString());
              setInitialNotes(parsedState.notes || '');
            } catch (e) {
              console.error('Failed to parse initial_state:', e);
            }
          }
        } else {
          Alert.alert('Error', 'No se encontró el ejercicio solicitado.');
          router.back();
        }
      } catch (error) {
        console.error('Error loading exercise for edit:', error);
        Alert.alert('Error', 'Error al cargar los datos del ejercicio.');
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
      Alert.alert('Validación', 'El nombre del ejercicio es requerido.');
      return;
    }

    const seriesConfigStr = !isConstant ? JSON.stringify(variableSets) : null;
    const weightNum = parseFloat(initialWeight) || 0;
    const repsNum = parseInt(initialReps, 10) || 0;
    const initialStateStr = JSON.stringify({
      weight: weightNum,
      reps: repsNum,
      notes: initialNotes.trim(),
    });

    const exerciseData: Omit<Exercise, 'id' | 'created_at'> = {
      name: name.trim(),
      default_sets: defaultSets,
      default_reps: isConstant ? defaultReps : 0,
      is_constant: isConstant ? 1 : 0,
      series_config: seriesConfigStr,
      video_url: videoUrl.trim() || null,
      initial_state: initialStateStr,
    };

    try {
      setIsLoading(true);
      if (isEditing) {
        await updateExercise(db, parseInt(id!, 10), exerciseData);
        Alert.alert('Éxito', 'Ejercicio actualizado correctamente.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        await insertExercise(db, exerciseData);
        Alert.alert('Éxito', 'Ejercicio creado correctamente.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (error) {
      console.error('Error saving exercise:', error);
      Alert.alert(
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

            {/* Estado de Referencia Inicial */}
            <ThemedView type="backgroundElement" style={styles.sectionCard}>
              <ThemedText type="smallBold" style={styles.sectionHeader}>
                Punto de Partida Histórico (Día 1)
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionDescription}>
                Registra tus logros iniciales para medir tu progreso a largo plazo.
              </ThemedText>
              
              <View style={styles.row}>
                <View style={[styles.flexField, { marginRight: Spacing.two }]}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Peso Inicial
                  </ThemedText>
                  <View style={[styles.inputWithSuffix, { backgroundColor: theme.background }]}>
                    <TextInput
                      style={[styles.suffixInput, { color: theme.text }]}
                      placeholder="0"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="numeric"
                      value={initialWeight}
                      onChangeText={setInitialWeight}
                    />
                    <ThemedText type="small" themeColor="textSecondary">kg</ThemedText>
                  </View>
                </View>

                <View style={styles.flexField}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    Reps Iniciales
                  </ThemedText>
                  <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                    placeholder="0"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numeric"
                    value={initialReps}
                    onChangeText={setInitialReps}
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  Notas de Referencia
                </ThemedText>
                <TextInput
                  style={[
                    styles.input,
                    styles.textArea,
                    { color: theme.text, backgroundColor: theme.background },
                  ]}
                  placeholder="Ej. Costó las últimas reps, técnica estricta."
                  placeholderTextColor={theme.textSecondary}
                  value={initialNotes}
                  onChangeText={setInitialNotes}
                  multiline
                  numberOfLines={3}
                />
              </View>
            </ThemedView>

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
});
