import React, { useState } from 'react';
import { StyleSheet, Modal, Pressable, View, ActivityIndicator, Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAlert } from '@/components/ui/alert-provider';
import { exportBackupData, importBackupData } from '@/database/database';

interface BackupModalProps {
  visible: boolean;
  onClose: () => void;
  onRefreshStats?: () => void;
}

export function BackupModal({
  visible,
  onClose,
  onRefreshStats,
}: BackupModalProps) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const { alert } = useAlert();

  // Selection states
  const [exercises, setExercises] = useState(true);
  const [groups, setGroups] = useState(true);
  const [routines, setRoutines] = useState(true);
  const [history, setHistory] = useState(true);

  // Loading states
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Toggle handlers honoring dependencies
  const handleToggleExercises = () => {
    const nextVal = !exercises;
    setExercises(nextVal);
    if (!nextVal) {
      setGroups(false);
      setRoutines(false);
      setHistory(false);
    }
  };

  const handleToggleGroups = () => {
    const nextVal = !groups;
    setGroups(nextVal);
    if (nextVal) {
      setExercises(true);
    } else {
      setRoutines(false);
    }
  };

  const handleToggleRoutines = () => {
    const nextVal = !routines;
    setRoutines(nextVal);
    if (nextVal) {
      setGroups(true);
      setExercises(true);
    }
  };

  const handleToggleHistory = () => {
    const nextVal = !history;
    setHistory(nextVal);
    if (nextVal) {
      setExercises(true);
    }
  };

  const handleClose = () => {
    if (isExporting || isImporting) return;
    onClose();
  };

  const handleExport = async () => {
    if (!exercises && !groups && !routines && !history) {
      alert('Selección Vacía', 'Por favor selecciona al menos una opción para exportar.');
      return;
    }

    setIsExporting(true);
    try {
      const data = await exportBackupData(db, { exercises, groups, routines, history });
      const jsonString = JSON.stringify(data, null, 2);

      if (Platform.OS === 'android') {
        try {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (!permissions.granted) {
            setIsExporting(false);
            return;
          }

          const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            'GymSmart_Backup.json',
            'application/json'
          );

          await FileSystem.writeAsStringAsync(fileUri, jsonString, {
            encoding: FileSystem.EncodingType.UTF8,
          });

          alert('Exportación Exitosa', 'El archivo GymSmart_Backup.json se ha guardado correctamente en la carpeta seleccionada.');
        } catch (err: any) {
          console.error('Android SAF Export error:', err);
          alert('Error de Exportación', `No se pudo guardar el archivo en el dispositivo: ${err?.message || err}`);
        }
      } else {
        const fileUri = FileSystem.cacheDirectory + 'GymSmart_Backup.json';
        
        await FileSystem.writeAsStringAsync(fileUri, jsonString, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/json',
            dialogTitle: 'Exportar copia de seguridad GymSmart',
            UTI: 'public.json',
          });
        } else {
          alert('Guardar no disponible', 'La funcionalidad de guardar/compartir no está disponible en este dispositivo.');
        }
      }
    } catch (error: any) {
      console.error('Export error:', error);
      alert('Error de Exportación', `Ocurrió un error al exportar los datos: ${error?.message || error}`);
    } finally {
      setIsExporting(false);
    }
  };

  const executeImport = async (payload: any) => {
    setIsImporting(true);
    try {
      const result = await importBackupData(db, payload);
      if (result.success) {
        alert('Importación Exitosa', 'Todos los datos del archivo se han importado y persistido correctamente.', [
          {
            text: 'Aceptar',
            onPress: () => {
              if (onRefreshStats) onRefreshStats();
              onClose();
            },
          },
        ]);
      } else {
        alert('Error de Importación', result.message);
      }
    } catch (error: any) {
      console.error('Execute import error:', error);
      alert('Error de Importación', `Ocurrió un error al escribir en la base de datos: ${error?.message || error}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        setIsImporting(false);
        return;
      }

      const fileUri = result.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      let payload: any;
      try {
        payload = JSON.parse(fileContent);
      } catch (e) {
        alert('Formato Inválido', 'El archivo seleccionado no tiene un formato JSON válido.');
        setIsImporting(false);
        return;
      }

      // Basic structure check
      const hasExercises = Array.isArray(payload.exercises);
      const hasGroups = Array.isArray(payload.groups);
      const hasRoutines = Array.isArray(payload.routines);
      const hasHistory = payload.history && (Array.isArray(payload.history.completion_audits) || Array.isArray(payload.history.scheduled_routines));

      if (!hasExercises && !hasGroups && !hasRoutines && !hasHistory) {
        alert('Archivo no compatible', 'El archivo no contiene un formato de respaldo GymSmart válido.');
        setIsImporting(false);
        return;
      }

      // Format detail message
      const details = [
        hasExercises ? `• Ejercicios: ${payload.exercises.length}` : null,
        hasGroups ? `• Grupos: ${payload.groups.length}` : null,
        hasRoutines ? `• Rutinas: ${payload.routines.length}` : null,
        hasHistory ? `• Registros de historial: ${payload.history.completion_audits?.length || payload.history.scheduled_routines?.length || 0}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      setIsImporting(false); // Stop loading before showing confirm alert
      
      // Confirm import with the user
      alert(
        'Confirmar Importación',
        `¿Deseas importar los siguientes datos encontrados?\n\n${details}\n\nLos datos se guardarán de forma permanente en tu base de datos SQLite.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Importar',
            onPress: () => executeImport(payload),
          },
        ]
      );
    } catch (error: any) {
      console.error('Import picker error:', error);
      alert('Error de Importación', `Ocurrió un error al seleccionar o leer el archivo: ${error?.message || error}`);
      setIsImporting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.content}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: 'rgba(60, 135, 247, 0.12)' }]}>
              <SymbolView
                name={{ ios: 'square.and.arrow.up.on.square.fill', android: 'backup', web: 'backup' }}
                size={26}
                tintColor="#3c87f7"
              />
            </View>
            <ThemedText type="smallBold" style={styles.title}>
              Copias de Seguridad
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              Exporta tus datos estructurados o importa un archivo JSON generado.
            </ThemedText>
          </View>

          {/* Options Selection */}
          <View style={styles.optionsContainer}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.optionsHeader}>
              Seleccionar datos a exportar
            </ThemedText>

            {/* Exercises Checkbox */}
            <Pressable
              onPress={handleToggleExercises}
              style={({ pressed }) => [
                styles.optionRow,
                { backgroundColor: theme.background },
                pressed && styles.pressed,
              ]}
              disabled={isExporting || isImporting}
            >
              <SymbolView
                name={exercises ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' } : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }}
                size={20}
                tintColor={exercises ? '#3c87f7' : theme.textSecondary}
              />
              <View style={styles.optionTextContainer}>
                <ThemedText type="smallBold" style={styles.optionLabel}>Ejercicios</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.optionDesc}>
                  Configuración, series constantes/variables, videos y notas.
                </ThemedText>
              </View>
            </Pressable>

            {/* Groups Checkbox */}
            <Pressable
              onPress={handleToggleGroups}
              style={({ pressed }) => [
                styles.optionRow,
                { backgroundColor: theme.background, opacity: exercises ? 1 : 0.5 },
                pressed && styles.pressed,
              ]}
              disabled={!exercises || isExporting || isImporting}
            >
              <SymbolView
                name={groups ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' } : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }}
                size={20}
                tintColor={groups ? '#3c87f7' : theme.textSecondary}
              />
              <View style={styles.optionTextContainer}>
                <ThemedText type="smallBold" style={styles.optionLabel}>Grupos de Ejercicios</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.optionDesc}>
                  Agrupaciones musculares y orden. (Requiere Ejercicios)
                </ThemedText>
              </View>
            </Pressable>

            {/* Routines Checkbox */}
            <Pressable
              onPress={handleToggleRoutines}
              style={({ pressed }) => [
                styles.optionRow,
                { backgroundColor: theme.background, opacity: groups ? 1 : 0.5 },
                pressed && styles.pressed,
              ]}
              disabled={!groups || isExporting || isImporting}
            >
              <SymbolView
                name={routines ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' } : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }}
                size={20}
                tintColor={routines ? '#3c87f7' : theme.textSecondary}
              />
              <View style={styles.optionTextContainer}>
                <ThemedText type="smallBold" style={styles.optionLabel}>Rutinas</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.optionDesc}>
                  Rutinas de entrenamiento. (Requiere Grupos y Ejercicios)
                </ThemedText>
              </View>
            </Pressable>

            {/* History Checkbox */}
            <Pressable
              onPress={handleToggleHistory}
              style={({ pressed }) => [
                styles.optionRow,
                { backgroundColor: theme.background, opacity: exercises ? 1 : 0.5 },
                pressed && styles.pressed,
              ]}
              disabled={!exercises || isExporting || isImporting}
            >
              <SymbolView
                name={history ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' } : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }}
                size={20}
                tintColor={history ? '#3c87f7' : theme.textSecondary}
              />
              <View style={styles.optionTextContainer}>
                <ThemedText type="smallBold" style={styles.optionLabel}>Historial de Entrenamiento</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.optionDesc}>
                  Registros del calendario, estadísticas e historial. (Requiere Ejercicios)
                </ThemedText>
              </View>
            </Pressable>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            {/* Cancel Button */}
            <Pressable
              onPress={handleClose}
              style={[styles.button, styles.cancelButton]}
              disabled={isExporting || isImporting}
            >
              <ThemedText type="smallBold">
                Cerrar
              </ThemedText>
            </Pressable>

            {/* Export Button */}
            <Pressable
              onPress={handleExport}
              style={[
                styles.button,
                { backgroundColor: '#3c87f7' },
              ]}
              disabled={isExporting || isImporting}
            >
              {isExporting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <View style={styles.buttonInner}>
                  <SymbolView
                    name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
                    size={16}
                    tintColor="#ffffff"
                  />
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                    Exportar
                  </ThemedText>
                </View>
              )}
            </Pressable>
          </View>

          {/* Import Section */}
          <View style={[styles.importSection, { borderTopColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.importTitle}>
              ¿Tienes una copia de seguridad existente?
            </ThemedText>
            
            <Pressable
              onPress={handleImport}
              style={({ pressed }) => [
                styles.importButton,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}
              disabled={isExporting || isImporting}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <View style={styles.buttonInner}>
                  <SymbolView
                    name={{ ios: 'square.and.arrow.down', android: 'folder_open', web: 'folder_open' }}
                    size={16}
                    tintColor={theme.text}
                  />
                  <ThemedText type="smallBold">
                    Importar archivo JSON
                  </ThemedText>
                </View>
              )}
            </Pressable>
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  content: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: Platform.OS === 'ios' ? 0 : StyleSheet.hairlineWidth,
    borderColor: 'rgba(128, 128, 128, 0.15)',
  },
  header: {
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.one,
  },
  iconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  title: {
    fontSize: 19,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 18,
    fontSize: 12,
  },
  optionsContainer: {
    gap: Spacing.two,
  },
  optionsHeader: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.half,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  optionTextContainer: {
    flex: 1,
    gap: Spacing.half,
  },
  optionLabel: {
    fontSize: 14,
  },
  optionDesc: {
    fontSize: 11,
    lineHeight: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.25)',
  },
  importSection: {
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  importTitle: {
    fontSize: 12,
    textAlign: 'center',
  },
  importButton: {
    width: '100%',
    height: 44,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
});
