import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Platform,
  View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getExercises, deleteExercise, Exercise } from '@/database/database';
import { openExerciseVideo } from '@/utils/linking';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useAlert } from '@/components/ui/alert-provider';

export function ExercisesView() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { alert } = useAlert();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Confirmation Modal State
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ id: number; name: string } | null>(null);

  // Fetch exercises from database
  const loadExercises = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getExercises(db);
      setExercises(data);
    } catch (error) {
      console.error('Error loading exercises:', error);
      alert('Error', `No se pudieron cargar los ejercicios: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [db]);

  // Reload when the screen gains focus
  useFocusEffect(
    useCallback(() => {
      loadExercises();
    }, [loadExercises])
  );

  // Handle exercise deletion with confirmation
  const handleDelete = (id: number, name: string) => {
    setItemToDelete({ id, name });
    setConfirmModalVisible(true);
  };

  const executeDelete = async () => {
    if (!itemToDelete) return;
    setConfirmModalVisible(false);
    try {
      await deleteExercise(db, itemToDelete.id);
      loadExercises();
    } catch (error) {
      console.error('Error deleting exercise:', error);
      alert('Error', `No se pudo eliminar el ejercicio: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setItemToDelete(null);
    }
  };

  const filteredExercises = exercises.filter((ex) =>
    ex.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderExerciseItem = ({ item }: { item: Exercise }) => {
    const isConstant = item.is_constant === 1;

    return (
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleContainer}>
            <ThemedText type="smallBold" style={styles.exerciseName}>
              {item.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isConstant
                ? `${item.default_sets} series x ${item.default_reps} reps`
                : `${item.default_sets} series variables`}
            </ThemedText>
          </View>
          <View style={styles.actionButtons}>
            {item.video_url && (
              <Pressable
                onPress={() => openExerciseVideo(item.video_url!)}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                accessibilityLabel="Ver video explicativo">
                <SymbolView
                  name={{ ios: 'play.circle.fill', android: 'play_circle', web: 'play_circle' }}
                  size={22}
                  tintColor="#3c87f7"
                />
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push(`/exercises/create?id=${item.id}`)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Editar ejercicio">
              <SymbolView
                name={{ ios: 'pencil.circle.fill', android: 'edit', web: 'edit' }}
                size={22}
                tintColor={theme.text}
              />
            </Pressable>
            <Pressable
              onPress={() => item.id && handleDelete(item.id, item.name)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Eliminar ejercicio">
              <SymbolView
                name={{ ios: 'trash.circle.fill', android: 'delete', web: 'delete' }}
                size={22}
                tintColor="#ff453a"
              />
            </Pressable>
          </View>
        </View>
      </ThemedView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Ejercicios
        </ThemedText>
        <Pressable
          onPress={() => router.push('/exercises/create')}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.text },
            pressed && styles.pressed,
          ]}>
          <SymbolView
            name={{ ios: 'plus', android: 'add', web: 'add' }}
            size={16}
            tintColor={theme.background}
          />
          <ThemedText
            type="smallBold"
            style={[styles.addButtonText, { color: theme.background }]}>
            Nuevo
          </ThemedText>
        </Pressable>
      </View>

      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={18}
          tintColor={theme.textSecondary}
        />
        <TextInput
          placeholder="Buscar ejercicio..."
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')}>
            <SymbolView
              name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
              size={16}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        )}
      </View>

      {/* Exercises List */}
      <FlatList
        data={filteredExercises}
        keyExtractor={(item) => item.id?.toString() || ''}
        renderItem={renderExerciseItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <SymbolView
                name={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }}
                size={48}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="default" themeColor="textSecondary" style={styles.emptyText}>
                {searchQuery ? 'No se encontraron ejercicios.' : 'No hay ejercicios guardados.'}
              </ThemedText>
              {!searchQuery && (
                <Pressable
                  onPress={() => router.push('/exercises/create')}
                  style={({ pressed }) => [styles.emptyStateButton, pressed && styles.pressed]}>
                  <ThemedText type="linkPrimary">Crear el primero</ThemedText>
                </Pressable>
              )}
            </View>
          ) : null
        }
        refreshing={isLoading}
        onRefresh={loadExercises}
      />
      <ConfirmModal
        visible={confirmModalVisible}
        title="Eliminar Ejercicio"
        message={`¿Estás seguro de que deseas eliminar "${itemToDelete?.name}"? Esto también lo eliminará de todos los grupos y rutinas asociados.`}
        onConfirm={executeDelete}
        onCancel={() => {
          setConfirmModalVisible(false);
          setItemToDelete(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    marginBottom: Spacing.three,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: 99,
    gap: Spacing.one,
  },
  addButtonText: {
    fontSize: 14,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? Spacing.two : Spacing.one,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  listContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitleContainer: {
    flex: 1,
    gap: Spacing.half,
  },
  exerciseName: {
    fontSize: 18,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconButton: {
    padding: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.six,
    gap: Spacing.two,
  },
  emptyText: {
    marginTop: Spacing.two,
    textAlign: 'center',
  },
  emptyStateButton: {
    marginTop: Spacing.one,
  },
});
