import React, { createContext, useContext, useState, useCallback } from 'react';
import { StyleSheet, Modal, Pressable, View, Platform } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface AlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface AlertState {
  visible: boolean;
  title: string;
  message: string;
  buttons: AlertButton[];
}

interface AlertContextProps {
  alert: (
    title: string,
    message?: string,
    buttons?: AlertButton[]
  ) => void;
}

const AlertContext = createContext<AlertContextProps | undefined>(undefined);

export function useAlert() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const [state, setState] = useState<AlertState>({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  });

  const alert = useCallback((
    title: string,
    message: string = '',
    buttons: AlertButton[] = []
  ) => {
    setState({
      visible: true,
      title,
      message,
      buttons: buttons.length > 0 ? buttons : [{ text: 'OK' }],
    });
  }, []);

  const hideAlert = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  // Determine Alert Type based on title and message
  const getAlertType = () => {
    const t = state.title.toLowerCase();
    const m = state.message.toLowerCase();
    if (t.includes('error') || t.includes('falló') || m.includes('error') || m.includes('falló')) {
      return 'error';
    }
    if (t.includes('éxito') || t.includes('correcto') || t.includes('terminado') || t.includes('finalizado') || t.includes('actualizado') || t.includes('creado')) {
      return 'success';
    }
    if (t.includes('validación') || t.includes('advertencia') || t.includes('alerta') || t.includes('atención')) {
      return 'warning';
    }
    return 'info';
  };

  const alertType = getAlertType();

  // Choose icon and color based on alertType
  const getIconProps = () => {
    switch (alertType) {
      case 'success':
        // If it's workout finished, let's show a trophy!
        if (state.title.toLowerCase().includes('entrenamiento') || state.title.toLowerCase().includes('terminado')) {
          return {
            name: { ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' } as any,
            color: '#ffcc00', // Gold
            bgColor: 'rgba(255, 204, 0, 0.15)',
          };
        }
        return {
          name: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' } as any,
          color: '#34c759', // Green
          bgColor: 'rgba(52, 199, 89, 0.15)',
        };
      case 'error':
        return {
          name: { ios: 'xmark.octagon.fill', android: 'error', web: 'error' } as any,
          color: '#ff453a', // Red
          bgColor: 'rgba(255, 69, 58, 0.15)',
        };
      case 'warning':
        return {
          name: { ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' } as any,
          color: '#ff9500', // Amber
          bgColor: 'rgba(255, 149, 0, 0.15)',
        };
      case 'info':
      default:
        return {
          name: { ios: 'info.circle.fill', android: 'info', web: 'info' } as any,
          color: '#3c87f7', // Blue
          bgColor: 'rgba(60, 135, 247, 0.15)',
        };
    }
  };

  const iconProps = getIconProps();

  // Helper to run button onPress and close the modal
  const handleButtonPress = (onPress?: () => void) => {
    hideAlert();
    if (onPress) {
      // Small timeout to let modal close animation finish smoothly
      setTimeout(() => {
        onPress();
      }, 100);
    }
  };

  return (
    <AlertContext.Provider value={{ alert }}>
      {children}
      <Modal
        visible={state.visible}
        transparent
        animationType="fade"
        onRequestClose={hideAlert}
      >
        <View style={styles.overlay}>
          <ThemedView type="backgroundElement" style={styles.content}>
            {/* Celebration or Status Icon */}
            <View style={[styles.iconContainer, { backgroundColor: iconProps.bgColor }]}>
              <SymbolView
                name={iconProps.name}
                size={32}
                tintColor={iconProps.color}
              />
            </View>

            {/* Title */}
            <ThemedText type="smallBold" style={styles.title}>
              {state.title}
            </ThemedText>

            {/* Message */}
            {state.message ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
                {state.message}
              </ThemedText>
            ) : null}

            {/* Actions Grid */}
            <View
              style={[
                styles.actions,
                state.buttons.length > 2 ? styles.actionsVertical : styles.actionsHorizontal,
              ]}
            >
              {state.buttons.map((btn, index) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                const isPrimary = !isDestructive && !isCancel;

                let btnBgColor: string = theme.backgroundSelected;
                let textColor: string = theme.text;
                let borderColor: string = 'transparent';

                if (isDestructive) {
                  btnBgColor = '#ff453a';
                  textColor = '#ffffff';
                } else if (isPrimary) {
                  btnBgColor = alertType === 'success' ? '#34c759' : alertType === 'warning' ? '#ff9500' : '#3c87f7';
                  textColor = '#ffffff';
                } else if (isCancel) {
                  btnBgColor = 'transparent';
                  borderColor = 'rgba(128, 128, 128, 0.25)';
                  textColor = theme.textSecondary;
                }

                return (
                  <Pressable
                    key={index}
                    onPress={() => handleButtonPress(btn.onPress)}
                    style={({ pressed }) => [
                      styles.button,
                      {
                        backgroundColor: btnBgColor,
                        borderColor: borderColor,
                        borderWidth: borderColor !== 'transparent' ? 1 : 0,
                      },
                      pressed && styles.pressed,
                      state.buttons.length > 2 && { width: '100%' },
                    ]}
                  >
                    <ThemedText
                      type="smallBold"
                      style={{ color: textColor }}
                    >
                      {btn.text || 'OK'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ThemedView>
        </View>
      </Modal>
    </AlertContext.Provider>
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
    alignItems: 'center',
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: Platform.OS === 'ios' ? 0 : StyleSheet.hairlineWidth,
    borderColor: 'rgba(128, 128, 128, 0.15)',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.half,
  },
  title: {
    fontSize: 19,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingHorizontal: Spacing.one,
  },
  message: {
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: Spacing.two,
  },
  actions: {
    marginTop: Spacing.one,
    width: '100%',
  },
  actionsHorizontal: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionsVertical: {
    flexDirection: 'column',
    gap: Spacing.one + Spacing.half,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
  },
  pressed: {
    opacity: 0.8,
  },
});
