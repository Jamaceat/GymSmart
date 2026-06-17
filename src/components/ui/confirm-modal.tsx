import React from 'react';
import { StyleSheet, Modal, Pressable, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmText = 'Eliminar',
  cancelText = 'Cancelar',
  isDestructive = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const theme = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.content}>
          <View
            style={[
              styles.iconContainer,
              {
                backgroundColor: isDestructive
                  ? 'rgba(255, 69, 58, 0.12)'
                  : 'rgba(60, 135, 247, 0.12)',
              },
            ]}
          >
            <SymbolView
              name={{
                ios: isDestructive ? 'exclamationmark.triangle.fill' : 'questionmark.circle.fill',
                android: isDestructive ? 'warning' : 'help',
                web: isDestructive ? 'warning' : 'help',
              }}
              size={28}
              tintColor={isDestructive ? '#ff453a' : '#3c87f7'}
            />
          </View>

          <ThemedText type="smallBold" style={styles.title}>
            {title}
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            {message}
          </ThemedText>

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={[styles.button, styles.cancelButton]}
            >
              <ThemedText type="smallBold" themeColor="text">
                {cancelText}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              style={[
                styles.button,
                { backgroundColor: isDestructive ? '#ff453a' : theme.text },
              ]}
            >
              <ThemedText
                type="smallBold"
                style={{ color: isDestructive ? '#ffffff' : theme.background }}
              >
                {confirmText}
              </ThemedText>
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
});
