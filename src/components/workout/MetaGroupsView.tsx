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

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SortableList } from '@/components/ui/sortable-list';
import { useAlert } from '@/components/ui/alert-provider';
import {
  getMetaGroups,
  getMetaGroupWithGroups,
  insertMetaGroup,
  updateMetaGroupName,
  deleteMetaGroup,
  getGroups,
  addGroupToMetaGroup,
  removeGroupFromMetaGroup,
  updateMetaGroupItemsOrder,
  ExerciseGroup,
  MetaGroup,
} from '@/database/database';

export function MetaGroupsView() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { alert } = useAlert();

  // State
  const [metaGroups, setMetaGroups] = useState<MetaGroup[]>([]);
  const [allGroups, setAllGroups] = useState<ExerciseGroup[]>([]);
  const [expandedMetaGroupId, setExpandedMetaGroupId] = useState<number | null>(null);
  const [expandedMetaGroupDetails, setExpandedMetaGroupDetails] = useState<MetaGroup | null>(null);

  // MetaGroup Management Modals
  const [isMetaGroupModalOpen, setIsMetaGroupModalOpen] = useState(false);
  const [metaGroupModalMode, setMetaGroupModalMode] = useState<'create' | 'edit'>('create');
  const [selectedMetaGroupId, setSelectedMetaGroupId] = useState<number | null>(null);
  const [metaGroupNameInput, setMetaGroupNameInput] = useState('');

  // Group Selector Modal
  const [isGroupSelectorOpen, setIsGroupSelectorOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  // Confirmation Modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actionType: 'deleteMetaGroup' | 'removeGroup' | null;
    metaGroupId?: number;
    metaGroupName?: string;
    groupId?: number;
    metaGroupItemId?: number;
    groupName?: string;
  }>({
    visible: false,
    title: '',
    message: '',
    actionType: null,
  });

  // Load routines and groups
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const metaData = await getMetaGroups(db);
      const groupsData = await getGroups(db);
      setMetaGroups(metaData);
      setAllGroups(groupsData);

      // If there is an expanded routine, refresh details
      if (expandedMetaGroupId !== null) {
        const details = await getMetaGroupWithGroups(db, expandedMetaGroupId);
        setExpandedMetaGroupDetails(details);
      }
    } catch (error) {
      console.error('Error loading meta-groups:', error);
      alert('Error', `No se pudieron cargar las rutinas: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [db, expandedMetaGroupId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Expand / Collapse MetaGroup card
  const toggleMetaGroupExpand = async (id: number) => {
    if (expandedMetaGroupId === id) {
      setExpandedMetaGroupId(null);
      setExpandedMetaGroupDetails(null);
    } else {
      setExpandedMetaGroupId(id);
      try {
        const details = await getMetaGroupWithGroups(db, id);
        setExpandedMetaGroupDetails(details);
      } catch (error) {
        console.error('Error loading meta-group details:', error);
      }
    }
  };

  // Create / Edit MetaGroup Save
  const handleSaveMetaGroup = async () => {
    if (!metaGroupNameInput.trim()) {
      alert('Validación', 'El nombre de la rutina es requerido.');
      return;
    }

    try {
      if (metaGroupModalMode === 'create') {
        await insertMetaGroup(db, metaGroupNameInput.trim());
      } else if (metaGroupModalMode === 'edit' && selectedMetaGroupId !== null) {
        await updateMetaGroupName(db, selectedMetaGroupId, metaGroupNameInput.trim());
      }
      setIsMetaGroupModalOpen(false);
      setMetaGroupNameInput('');
      loadData();
    } catch (error) {
      console.error('Error saving meta-group:', error);
      alert('Error', `No se pudo guardar la rutina: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Delete MetaGroup
  const handleDeleteMetaGroup = (id: number, name: string) => {
    setConfirmConfig({
      visible: true,
      title: 'Eliminar Rutina',
      message: `¿Estás seguro de que deseas eliminar la rutina "${name}"? Los grupos y ejercicios asociados no serán borrados.`,
      actionType: 'deleteMetaGroup',
      metaGroupId: id,
      metaGroupName: name,
    });
  };

  // Add group to currently expanded routine
  const handleAddGroupToMetaGroup = async (groupId: number) => {
    if (!expandedMetaGroupId || !expandedMetaGroupDetails) return;

    try {
      const orderIndex = expandedMetaGroupDetails.groups?.length ?? 0;
      await addGroupToMetaGroup(db, expandedMetaGroupId, groupId, orderIndex);
      
      // Refresh details
      const details = await getMetaGroupWithGroups(db, expandedMetaGroupId);
      setExpandedMetaGroupDetails(details);
    } catch (error) {
      console.error('Error adding group to routine:', error);
      alert('Error', `No se pudo añadir el grupo: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Remove group from currently expanded routine
  const handleRemoveGroupFromMetaGroup = (metaGroupItemId: number, groupName: string) => {
    if (!expandedMetaGroupId) return;
    setConfirmConfig({
      visible: true,
      title: 'Quitar Grupo',
      message: `¿Estás seguro de que deseas quitar el grupo "${groupName}" de esta rutina?`,
      actionType: 'removeGroup',
      metaGroupItemId,
      groupName,
    });
  };

  const handleConfirmAction = async () => {
    const { actionType, metaGroupId, metaGroupItemId } = confirmConfig;
    setConfirmConfig((prev) => ({ ...prev, visible: false }));

    if (actionType === 'deleteMetaGroup' && metaGroupId !== undefined) {
      try {
        if (expandedMetaGroupId === metaGroupId) {
          setExpandedMetaGroupId(null);
          setExpandedMetaGroupDetails(null);
        }
        await deleteMetaGroup(db, metaGroupId);
        loadData();
      } catch (error) {
        console.error('Error deleting meta-group:', error);
        alert('Error', `No se pudo eliminar la rutina: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (actionType === 'removeGroup' && metaGroupItemId !== undefined && expandedMetaGroupId) {
      try {
        await removeGroupFromMetaGroup(db, metaGroupItemId);
        
        // Refresh details
        const details = await getMetaGroupWithGroups(db, expandedMetaGroupId);
        setExpandedMetaGroupDetails(details);
      } catch (error) {
        console.error('Error removing group from routine:', error);
        alert('Error', `No se pudo remover el grupo: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  // Reorder groups inside routine
  const handleGroupsOrderChange = async (newOrderedGroups: ExerciseGroup[]) => {
    if (!expandedMetaGroupId) return;

    try {
      const ids = newOrderedGroups.map((g) => g.meta_group_item_id!).filter(Boolean);
      await updateMetaGroupItemsOrder(db, expandedMetaGroupId, ids);
      
      // Refresh details from database to get correct meta_group_item_id values
      const details = await getMetaGroupWithGroups(db, expandedMetaGroupId);
      setExpandedMetaGroupDetails(details);
    } catch (error) {
      console.error('Error reordering groups:', error);
      alert('Error', `No se pudo reordenar: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // All groups are available to be added multiple times
  const availableGroups = allGroups;

  const renderMetaGroupItem = ({ item }: { item: MetaGroup }) => {
    const isExpanded = expandedMetaGroupId === item.id;

    return (
      <ThemedView type="backgroundElement" style={styles.routineCard}>
        <Pressable onPress={() => item.id && toggleMetaGroupExpand(item.id)} style={styles.routineHeader}>
          <View style={styles.routineHeaderLeft}>
            <SymbolView
              name={{
                ios: isExpanded ? 'chevron.down' : 'chevron.right',
                android: isExpanded ? 'expand_more' : 'chevron_right',
                web: isExpanded ? 'expand_more' : 'chevron_right'
              }}
              size={18}
              tintColor={theme.text}
            />
            <ThemedText type="smallBold" style={styles.routineName}>
              {item.name}
            </ThemedText>
          </View>
          <View style={styles.routineHeaderRight}>
            <Pressable
              onPress={() => {
                setSelectedMetaGroupId(item.id!);
                setMetaGroupNameInput(item.name);
                setMetaGroupModalMode('edit');
                setIsMetaGroupModalOpen(true);
              }}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Editar nombre de rutina">
              <SymbolView
                name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                size={18}
                tintColor={theme.text}
              />
            </Pressable>
            <Pressable
              onPress={() => item.id && handleDeleteMetaGroup(item.id, item.name)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              accessibilityLabel="Eliminar rutina">
              <SymbolView
                name={{ ios: 'trash', android: 'delete', web: 'delete' }}
                size={18}
                tintColor="#ff453a"
              />
            </Pressable>
          </View>
        </Pressable>

        {isExpanded && expandedMetaGroupDetails && (() => {
          // Calculate occurrences of each group in the expanded routine
          const groupOccurrenceCounts: Record<number, number> = {};
          const groupsWithOccurrence = (expandedMetaGroupDetails.groups ?? []).map(g => {
            const gId = g.id!;
            groupOccurrenceCounts[gId] = (groupOccurrenceCounts[gId] ?? 0) + 1;
            return {
              ...g,
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
            <View style={styles.expandedContent}>
              {groupsWithOccurrence.length > 0 ? (
                <SortableList
                  data={groupsWithOccurrence}
                  keyExtractor={(g) => g.meta_group_item_id?.toString() || `${g.id}-${g.occurrenceIndex}`}
                  itemHeight={52}
                  onOrderChange={handleGroupsOrderChange}
                  renderItem={(g, idx, dragGesture) => (
                    <View 
                      style={[
                        styles.groupItem,
                        {
                          backgroundColor: getGroupBackgroundColor(g.occurrenceIndex),
                          paddingHorizontal: Spacing.two,
                          height: 48,
                          borderRadius: Spacing.two,
                          borderBottomWidth: 0,
                        }
                      ]}>
                      <View style={styles.groupInfo}>
                        <View style={styles.groupHeaderRow}>
                          <ThemedText type="smallBold">{g.name}</ThemedText>
                          {g.occurrenceIndex > 1 && (
                            <View style={[styles.repeatBadge, { backgroundColor: theme.background === '#ffffff' ? '#3c87f7' : '#2260c0' }]}>
                              <ThemedText type="smallBold" style={styles.repeatBadgeText}>
                                {g.occurrenceIndex}x
                              </ThemedText>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={styles.groupActions}>
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
                          onPress={() => g.meta_group_item_id && handleRemoveGroupFromMetaGroup(g.meta_group_item_id, g.name)}
                          style={({ pressed }) => [styles.reorderButton, pressed && styles.pressed]}>
                          <SymbolView
                            name={{ ios: 'minus.circle', android: 'remove_circle', web: 'remove_circle' }}
                            size={18}
                            tintColor="#ff453a"
                          />
                        </Pressable>
                      </View>
                    </View>
                  )}
                />
              ) : (
                <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRoutineText}>
                  No hay grupos asignados a esta rutina.
                </ThemedText>
              )}

              <Pressable
                onPress={() => setIsGroupSelectorOpen(true)}
                style={({ pressed }) => [
                  styles.addGroupButton,
                  { borderColor: theme.text },
                  pressed && styles.pressed,
                ]}>
                <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={14} tintColor={theme.text} />
                <ThemedText type="smallBold">Añadir Grupo</ThemedText>
              </Pressable>
            </View>
          );
        })()}
      </ThemedView>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="subtitle" style={styles.headerTitle}>
          Rutinas (Meta-Grupos)
        </ThemedText>
        <Pressable
          onPress={() => {
            setMetaGroupModalMode('create');
            setMetaGroupNameInput('');
            setIsMetaGroupModalOpen(true);
          }}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.text },
            pressed && styles.pressed,
          ]}>
          <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={16} tintColor={theme.background} />
          <ThemedText type="smallBold" style={[styles.addButtonText, { color: theme.background }]}>
            Nueva Rutina
          </ThemedText>
        </Pressable>
      </View>

      {/* Routines List */}
      <FlatList
        data={metaGroups}
        keyExtractor={(item) => item.id?.toString() || ''}
        renderItem={renderMetaGroupItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.emptyState}>
              <SymbolView
                name={{ ios: 'square.grid.3x1.folder.badge.plus', android: 'folder_open', web: 'folder_open' }}
                size={48}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="default" themeColor="textSecondary" style={styles.emptyText}>
                No hay rutinas creadas.
              </ThemedText>
            </View>
          ) : null
        }
        refreshing={isLoading}
        onRefresh={loadData}
      />

      {/* Create / Edit Routine Modal */}
      <Modal
        visible={isMetaGroupModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMetaGroupModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.modalContent}>
            <ThemedText type="smallBold" style={styles.modalTitle}>
              {metaGroupModalMode === 'create' ? 'Crear Nueva Rutina' : 'Editar Nombre de Rutina'}
            </ThemedText>
            <TextInput
              style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]}
              placeholder="Nombre de la rutina (ej. Rutina A, Push/Pull)"
              placeholderTextColor={theme.textSecondary}
              value={metaGroupNameInput}
              onChangeText={setMetaGroupNameInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setIsMetaGroupModalOpen(false)}
                style={[styles.modalButton, styles.cancelButton]}>
                <ThemedText type="smallBold">Cancelar</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleSaveMetaGroup}
                style={[styles.modalButton, { backgroundColor: theme.text }]}>
                <ThemedText type="smallBold" style={{ color: theme.background }}>
                  Guardar
                </ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>

      {/* Group Selector Modal */}
      <Modal
        visible={isGroupSelectorOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsGroupSelectorOpen(false)}>
        <View style={styles.modalOverlay}>
          <ThemedView type="backgroundElement" style={styles.selectorModalContent}>
            <View style={styles.selectorHeader}>
              <ThemedText type="smallBold" style={styles.selectorTitle}>
                Seleccionar Grupos
              </ThemedText>
              <Pressable
                onPress={() => setIsGroupSelectorOpen(false)}
                style={({ pressed }) => [styles.closeSelectorButton, pressed && styles.pressed]}>
                <SymbolView
                  name={{ ios: 'xmark.circle.fill', android: 'close', web: 'close' }}
                  size={24}
                  tintColor={theme.text}
                />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.selectorScroll}>
              {availableGroups.length > 0 ? (
                availableGroups.map((g) => (
                  <Pressable
                    key={g.id}
                    onPress={() => {
                      if (g.id) handleAddGroupToMetaGroup(g.id);
                    }}
                    style={({ pressed }) => [
                      styles.selectorItem,
                      { backgroundColor: theme.background },
                      pressed && styles.pressed,
                    ]}>
                    <View>
                      <ThemedText type="smallBold">{g.name}</ThemedText>
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
                  style={styles.noAvailableGroups}>
                  {allGroups.length === 0
                    ? 'No hay grupos de ejercicios creados. Créalos primero.'
                    : 'Todos los grupos ya están en esta rutina.'}
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
    fontSize: 18,
  },
  routineHeaderRight: {
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
  groupList: {
    gap: Spacing.one + Spacing.half,
  },
  groupItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.2)',
  },
  groupInfo: {
    flex: 1,
    gap: Spacing.half,
  },
  groupActions: {
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
  emptyRoutineText: {
    paddingVertical: Spacing.one,
    fontStyle: 'italic',
  },
  addGroupButton: {
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
  noAvailableGroups: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
});
