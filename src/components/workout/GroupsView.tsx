import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  View,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';
import { GestureDetector } from 'react-native-gesture-handler';

import { ConfirmModal } from '@/components/ui/confirm-modal';
import { useAlert } from '@/components/ui/alert-provider';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SortableList } from '@/components/ui/sortable-list';
import {
  getGroups,
  getGroupWithExercises,
  insertGroup,
  updateGroupName,
  deleteGroup,
  getExercises,
  addExerciseToGroup,
  removeExerciseFromGroup,
  updateGroupExercisesOrder,
  Exercise,
  ExerciseGroup,
} from '@/database/database';

export function GroupsView() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { alert } = useAlert();

  // State
  const [groups, setGroups] = useState<ExerciseGroup[]>([]);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [expandedGroupId, setExpandedGroupId] = useState<number | null>(null);
  const [expandedGroupDetails, setExpandedGroupDetails] = useState<ExerciseGroup | null>(null);

  // Group Management Modals
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<'create' | 'edit'>('create');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [groupNameInput, setGroupNameInput] = useState('');

  // Exercise Selector Modal
  const [isExerciseSelectorOpen, setIsExerciseSelectorOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  // Confirmation Modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actionType: 'deleteGroup' | 'removeExercise' | null;
    groupId?: number;
    groupName?: string;
    exerciseId?: number;
    exerciseName?: string;
  }>({
    visible: false,
    title: '',
    message: '',
    actionType: null,
  });

  // Load groups and all exercises
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const groupsData = await getGroups(db);
      const exercisesData = await getExercises(db);
      setGroups(groupsData);
      setAllExercises(exercisesData);

      // If there is an expanded group, refresh its details
      if (expandedGroupId !== null) {
        const details = await getGroupWithExercises(db, expandedGroupId);
        setExpandedGroupDetails(details);
      }
    } catch (error) {
      console.error('Error loading groups:', error);
      alert('Error', `No se pudieron cargar los grupos de ejercicios: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [db, expandedGroupId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Expand / Collapse Group card
  const toggleGroupExpand = async (groupId: number) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      setExpandedGroupDetails(null);
    } else {
      setExpandedGroupId(groupId);
      try {
        const details = await getGroupWithExercises(db, groupId);
        setExpandedGroupDetails(details);
      } catch (error) {
        console.error('Error loading group details:', error);
      }
    }
  };

  // Create / Edit Group Save
  const handleSaveGroup = async () => {
    if (!groupNameInput.trim()) {
      alert('Validación', 'El nombre del grupo es requerido.');
      return;
    }

    try {
      if (groupModalMode === 'create') {
        await insertGroup(db, groupNameInput.trim());
      } else if (groupModalMode === 'edit' && selectedGroupId !== null) {
        await updateGroupName(db, selectedGroupId, groupNameInput.trim());
      }
      setIsGroupModalOpen(false);
      setGroupNameInput('');
      loadData();
    } catch (error) {
      console.error('Error saving group:', error);
      alert('Error', `No se pudo guardar el grupo: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Delete Group
  const handleDeleteGroup = (id: number, name: string) => {
    setConfirmConfig({
      visible: true,
      title: 'Eliminar Grupo',
      message: `¿Estás seguro de que deseas eliminar el grupo "${name}"? Los ejercicios no serán borrados, solo su agrupación.`,
      actionType: 'deleteGroup',
      groupId: id,
      groupName: name,
    });
  };

  // Add exercise to currently expanded group
  const handleAddExerciseToGroup = async (exerciseId: number) => {
    if (!expandedGroupId || !expandedGroupDetails) return;

    try {
      const orderIndex = expandedGroupDetails.exercises?.length ?? 0;
      await addExerciseToGroup(db, expandedGroupId, exerciseId, orderIndex);
      
      // Refresh details
      const details = await getGroupWithExercises(db, expandedGroupId);
      setExpandedGroupDetails(details);
    } catch (error) {
      console.error('Error adding exercise to group:', error);
      alert('Error', `No se pudo añadir el ejercicio al grupo: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Remove exercise from currently expanded group
  const handleRemoveExerciseFromGroup = (exerciseId: number, exerciseName: string) => {
    if (!expandedGroupId) return;
    setConfirmConfig({
      visible: true,
      title: 'Quitar Ejercicio',
      message: `¿Estás seguro de que deseas quitar "${exerciseName}" de este grupo?`,
      actionType: 'removeExercise',
      exerciseId,
      exerciseName,
    });
  };

  const handleConfirmAction = async () => {
    const { actionType, groupId, exerciseId } = confirmConfig;
    setConfirmConfig((prev) => ({ ...prev, visible: false }));

    if (actionType === 'deleteGroup' && groupId !== undefined) {
      try {
        if (expandedGroupId === groupId) {
          setExpandedGroupId(null);
          setExpandedGroupDetails(null);
        }
        await deleteGroup(db, groupId);
        loadData();
      } catch (error) {
        console.error('Error deleting group:', error);
        alert('Error', `No se pudo eliminar el grupo: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (actionType === 'removeExercise' && exerciseId !== undefined && expandedGroupId) {
      try {
        await removeExerciseFromGroup(db, expandedGroupId, exerciseId);
        
        // Refresh details
        const details = await getGroupWithExercises(db, expandedGroupId);
        setExpandedGroupDetails(details);
      } catch (error) {
        console.error('Error removing exercise from group:', error);
        alert('Error', `No se pudo remover el ejercicio: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // Reorder exercises inside group (via drag and drop)
  const handleExercisesOrderChange = async (newOrderedExercises: Exercise[]) => {
    if (!expandedGroupId || !expandedGroupDetails) return;

    try {
      const ids = newOrderedExercises.map((ex) => ex.id!).filter(Boolean);
      await updateGroupExercisesOrder(db, expandedGroupId, ids);
      
      // Refresh local list
      setExpandedGroupDetails({ ...expandedGroupDetails, exercises: newOrderedExercises });
    } catch (error) {
      console.error('Error reordering exercises:', error);
      alert('Error', `No se pudo reordenar: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Filter exercises available to add (not in the current group)
  const availableExercises = allExercises.filter(
    (ex) => !expandedGroupDetails?.exercises?.some((curr) => curr.id === ex.id)
  );

  const renderGroupItem = ({ item }: { item: ExerciseGroup }) => {
    const isExpanded = expandedGroupId === item.id;

    return (
      <ThemedView type="backgroundElement" style={styles.groupCard}>
        <Pressable onPress={() => item.id && toggleGroupExpand(item.id)} style={styles.groupHeader}>
          <View style={styles.groupHeaderLeft}>
            <SymbolView
              name={{
                ios: isExpanded ? 'chevron.down' : 'chevron.right',
                android: isExpanded ? 'expand_more' : 'chevron_right',
                web: isExpanded ? 'expand_more' : 'chevron_right'
              }}
              size={18}
              tintColor={theme.text}
            />
            <ThemedText type="smallBold" style={styles.groupName}>
              {item.name}
            </ThemedText>
          </View>
          <View style={styles.groupHeaderRight}>
            <Pressable
              onPress={() => {
                setSelectedGroupId(item.id!);
                setGroupNameInput(item.name);
                setGroupModalMode('edit');
                setIsGroupModalOpen(true);
              }}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Editar nombre de grupo">
              <SymbolView
                name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                size={18}
                tintColor={theme.text}
              />
            </Pressable>
            <Pressable
              onPress={() => item.id && handleDeleteGroup(item.id, item.name)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Eliminar grupo">
              <SymbolView
                name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                size={18}
                tintColor="#ff453a"
              />
            </Pressable>
          </View>
        </Pressable>

        {isExpanded && expandedGroupDetails && (
          <View style={styles.expandedContent}>
            {expandedGroupDetails.exercises && expandedGroupDetails.exercises.length > 0 ? (
              <SortableList
                data={expandedGroupDetails.exercises.filter(Boolean)}
                keyExtractor={(ex) => ex?.id?.toString() || Math.random().toString()}
                itemHeight={60}
                onOrderChange={handleExercisesOrderChange}
                renderItem={(ex, idx, dragGesture) => {
                  if (!ex) return null;
                  return (
                    <View 
                      style={[
                        styles.exerciseItem,
                        {
                          height: 56,
                          borderBottomWidth: 0,
                          paddingVertical: 0,
                          paddingHorizontal: Spacing.two,
                          backgroundColor: theme.background,
                          borderRadius: Spacing.two,
                        }
                      ]}>
                      <View style={styles.exerciseInfo}>
                        <ThemedText type="smallBold">{ex.name || 'Ejercicio'}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {ex.is_constant === 1
                            ? `${ex.default_sets || 0} x ${ex.default_reps || 0}`
                            : `${ex.default_sets || 0} series var.`}
                        </ThemedText>
                      </View>
                      <View style={styles.exerciseActions}>
                        <GestureDetector gesture={dragGesture}>
                          <View style={styles.reorderButton}>
                            <SymbolView
                              name={{ ios: 'line.horizontal.3', android: 'drag_handle', web: 'drag_handle' }}
                              size={18}
                              tintColor={theme.text}
                            />
                          </View>
                        </GestureDetector>
                        <Pressable
                          onPress={() => ex.id && handleRemoveExerciseFromGroup(ex.id, ex.name)}
                          style={({ pressed }) => [styles.reorderButton, pressed && styles.pressed]}>
                          <SymbolView
                            name={{ ios: 'minus.circle', android: 'remove_circle', web: 'remove_circle' }}
                            size={18}
                            tintColor="#ff453a"
                          />
                        </Pressable>
                      </View>
                    </View>
                  );
                }}
              />
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyGroupText}>
                No hay ejercicios en este grupo.
              </ThemedText>
            )}

            <Pressable
              onPress={() => setIsExerciseSelectorOpen(true)}
              style={({ pressed }) => [
                styles.addExerciseButton,
                { borderColor: theme.text },
                pressed && styles.pressed,
              ]}>
              <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={14} tintColor={theme.text} />
              <ThemedText type="smallBold">Añadir Ejercicio</ThemedText>
            </Pressable>
          </View>
        )}
      </ThemedView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Grupos de Ejercicios
        </ThemedText>
        <Pressable
          onPress={() => {
            setGroupModalMode('create');
            setGroupNameInput('');
            setIsGroupModalOpen(true);
          }}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.text },
            pressed && styles.pressed,
          ]}>
          <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={16} tintColor={theme.background} />
          <ThemedText type="smallBold" style={[styles.addButtonText, { color: theme.background }]}>
            Nuevo Grupo
          </ThemedText>
        </Pressable>
      </View>

      {/* Groups List */}
      <FlatList
        data={groups}
        keyExtractor={(item) => item.id?.toString() || ''}
        renderItem={renderGroupItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <SymbolView
                name={{ ios: 'folder.badge.plus', android: 'create_new_folder', web: 'create_new_folder' }}
                size={48}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="default" themeColor="textSecondary" style={styles.emptyText}>
                No hay grupos de ejercicios creados.
              </ThemedText>
            </View>
          ) : null
        }
        refreshing={isLoading}
        onRefresh={loadData}
      />

      {/* Create / Edit Group Modal */}
      <Modal
        visible={isGroupModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsGroupModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.modalContent}>
            <ThemedText type="smallBold" style={styles.modalTitle}>
              {groupModalMode === 'create' ? 'Crear Nuevo Grupo' : 'Editar Nombre de Grupo'}
            </ThemedText>
            <TextInput
              style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]}
              placeholder="Nombre del grupo (ej. Pecho, Piernas)"
              placeholderTextColor={theme.textSecondary}
              value={groupNameInput}
              onChangeText={setGroupNameInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setIsGroupModalOpen(false)}
                style={[styles.modalButton, styles.cancelButton]}>
                <ThemedText type="smallBold">Cancelar</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleSaveGroup}
                style={[styles.modalButton, { backgroundColor: theme.text }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Guardar
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* Exercise Selector Modal */}
      <Modal
        visible={isExerciseSelectorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsExerciseSelectorOpen(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.selectorModalContent}>
            <View style={styles.selectorHeader}>
              <ThemedText type="smallBold" style={styles.selectorTitle}>
                Seleccionar Ejercicios
              </ThemedText>
              <Pressable
                onPress={() => setIsExerciseSelectorOpen(false)}
                style={({ pressed }) => [styles.closeSelectorButton, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                  size={24}
                  tintColor={theme.text}
                />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.selectorScroll}>
              {availableExercises.length > 0 ? (
                availableExercises.map((ex) => (
                  <Pressable
                    key={ex.id}
                    onPress={() => {
                      if (ex.id) handleAddExerciseToGroup(ex.id);
                    }}
                    style={({ pressed }) => [
                      styles.selectorItem,
                      { backgroundColor: theme.background },
                      pressed && styles.pressed,
                    ]}>
                    <View>
                      <ThemedText type="smallBold">{ex.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {ex.is_constant === 1
                          ? `${ex.default_sets} x ${ex.default_reps}`
                          : `${ex.default_sets} series var.`}
                      </ThemedText>
                    </View>
                    <SymbolView
                      name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                      size={22}
                      tintColor="#3c87f7"
                    />
                  </Pressable>
                ))
              ) : (
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={styles.noAvailableExercises}>
                  {allExercises.length === 0
                    ? 'No hay ejercicios en el catálogo. Créalos primero.'
                    : 'Todos los ejercicios ya están en este grupo.'}
                </ThemedText>
              )}
            </ScrollView>
          </ThemedView>
        </View>
      </Modal>
      <ConfirmModal
        visible={confirmConfig.visible}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmConfig((prev) => ({ ...prev, visible: false }))}
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
  listContent: {
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
  groupCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  groupName: {
    fontSize: 18,
  },
  groupHeaderRight: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  iconButton: {
    padding: Spacing.half,
  },
  expandedContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  exerciseList: {
    gap: Spacing.one + Spacing.half,
  },
  exerciseItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  exerciseInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  exerciseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  reorderButton: {
    padding: Spacing.half,
  },
  disabled: {
    opacity: 0.3,
  },
  pressed: {
    opacity: 0.7,
  },
  emptyGroupText: {
    paddingVertical: Spacing.one,
    fontStyle: 'italic',
  },
  addExerciseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    gap: Spacing.one,
    marginTop: Spacing.two,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  modalTitle: {
    fontSize: 18,
    textAlign: 'center',
  },
  modalInput: {
    fontSize: 16,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
  modalButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.4)',
  },
  selectorModalContent: {
    width: '100%',
    maxWidth: 500,
    maxHeight: '80%',
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  selectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
    paddingBottom: Spacing.two,
  },
  selectorTitle: {
    fontSize: 18,
  },
  closeSelectorButton: {
    padding: Spacing.half,
  },
  selectorScroll: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  selectorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  noAvailableExercises: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
});
