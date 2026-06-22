import React, { useState } from 'react';
import { StyleSheet, Modal, Pressable, View, TextInput, ActivityIndicator } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface DeleteHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteHistoryModal({
  visible,
  onClose,
  onConfirm,
}: DeleteHistoryModalProps) {
  const theme = useTheme();
  const [confirmedStep1, setConfirmedStep1] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleClose = () => {
    setConfirmedStep1(false);
    setConfirmText('');
    setIsDeleting(false);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmedStep1 || confirmText.trim().toLowerCase() !== 'confirmo') return;
    setIsDeleting(true);
    try {
      await onConfirm();
      handleClose();
    } catch (error) {
      console.error('Error clearing history:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const isDeleteEnabled = confirmedStep1 && confirmText.trim().toLowerCase() === 'confirmo';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.content}>
          <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 69, 58, 0.12)' }]}>
            <SymbolView
              name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
              size={28}
              tintColor="#ff453a"
            />
          </View>

          <ThemedText type="smallBold" style={styles.title}>
            Eliminar Historial
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            Esta acción eliminará de forma permanente todo el historial de ejercicios completados, estadísticas y registros en el calendario. Las rutinas, grupos y ejercicios no serán eliminados.
          </ThemedText>

          {/* Double Confirmation Steps */}
          <View style={styles.stepsContainer}>
            {/* Step 1: Confirmation Pressable */}
            <Pressable
              onPress={() => setConfirmedStep1(!confirmedStep1)}
              style={({ pressed }) => [
                styles.stepRow,
                { backgroundColor: theme.background },
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={confirmedStep1 ? { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' } : { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' }}
                size={20}
                tintColor={confirmedStep1 ? '#ff453a' : theme.textSecondary}
              />
              <ThemedText type="small" style={{ flex: 1, color: confirmedStep1 ? theme.text : theme.textSecondary }}>
                Paso 1: Confirmar eliminación de datos
              </ThemedText>
            </Pressable>

            {/* Step 2: Text Input "confirmo" */}
            <View style={[styles.inputContainer, { opacity: confirmedStep1 ? 1 : 0.5 }]} pointerEvents={confirmedStep1 ? 'auto' : 'none'}>
              <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
                Paso 2: Escribe <ThemedText type="smallBold" style={{ color: '#ff453a' }}>confirmo</ThemedText> para continuar:
              </ThemedText>
              <TextInput
                style={[
                  styles.textInput,
                  {
                    color: theme.text,
                    borderColor: theme.backgroundSelected,
                    backgroundColor: theme.background,
                  },
                ]}
                placeholder="Escribe 'confirmo'"
                placeholderTextColor={theme.textSecondary}
                value={confirmText}
                onChangeText={setConfirmText}
                autoCapitalize="none"
                autoCorrect={false}
                editable={confirmedStep1}
              />
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              onPress={handleClose}
              style={[styles.button, styles.cancelButton]}
              disabled={isDeleting}
            >
              <ThemedText type="smallBold" themeColor="text">
                Cancelar
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleDelete}
              style={[
                styles.button,
                { backgroundColor: isDeleteEnabled ? '#ff453a' : 'rgba(255, 69, 58, 0.4)' },
              ]}
              disabled={!isDeleteEnabled || isDeleting}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                  Eliminar
                </ThemedText>
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
    maxWidth: 320,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  iconContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.half,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  message: {
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: Spacing.one,
  },
  stepsContainer: {
    width: '100%',
    gap: Spacing.two,
    marginVertical: Spacing.one,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Spacing.two,
  },
  inputContainer: {
    width: '100%',
    marginTop: Spacing.one,
  },
  textInput: {
    width: '100%',
    height: 44,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
    width: '100%',
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: 'rgba(128, 128, 128, 0.25)',
  },
  pressed: {
    opacity: 0.8,
  },
});
