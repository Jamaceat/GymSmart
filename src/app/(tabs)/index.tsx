import React, { useState, useCallback } from 'react';
import { StyleSheet, Pressable, View, ScrollView, Dimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, MaxContentWidth, BottomTabInset } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DeleteHistoryModal } from '@/components/ui/delete-history-modal';
import { clearExerciseHistory } from '@/database/database';

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();

  // Statistics state
  const [stats, setStats] = useState({
    exercises: 0,
    groups: 0,
    metaGroups: 0,
  });
  const [todayRoutines, setTodayRoutines] = useState<string[]>([]);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const exResult = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM exercises');
      const grResult = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM exercise_groups');
      const mtResult = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM meta_groups');

      // Query routines scheduled for today
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const todayStr = `${year}-${month}-${day}`;

      const todayScheduled = await db.getAllAsync<{ name: string }>(
        `SELECT mg.name FROM scheduled_routines sr
         JOIN meta_groups mg ON sr.meta_group_id = mg.id
         WHERE sr.scheduled_date = ?`,
        [todayStr]
      );

      setStats({
        exercises: exResult?.count ?? 0,
        groups: grResult?.count ?? 0,
        metaGroups: mtResult?.count ?? 0,
      });
      setTodayRoutines(todayScheduled.map(r => r.name));
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const handleConfirmDelete = useCallback(async () => {
    try {
      await clearExerciseHistory(db);
      await loadStats();
    } catch (error) {
      console.error('Error deleting history:', error);
    }
  }, [db, loadStats]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          
          {/* Hero Header */}
          <View style={styles.heroSection}>
            <View style={styles.appBadge}>
              <SymbolView
                name={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }}
                size={24}
                tintColor="#3c87f7"
              />
            </View>
            <ThemedText type="subtitle" style={styles.title}>
              GymSmart
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              Entrena de forma inteligente. Configura tus sets, videos y rutinas estructuradas.
            </ThemedText>
          </View>

          {/* Stats Grid */}
          <View style={styles.grid}>
            <ThemedView type="backgroundElement" style={styles.statCard}>
              <SymbolView
                name={{ ios: 'dumbbell', android: 'fitness_center', web: 'fitness_center' }}
                size={22}
                tintColor={theme.text}
              />
              <ThemedText type="title" style={styles.statNumber}>
                {stats.exercises}
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Ejercicios
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.statCard}>
              <SymbolView
                name={{ ios: 'folder', android: 'folder', web: 'folder' }}
                size={22}
                tintColor={theme.text}
              />
              <ThemedText type="title" style={styles.statNumber}>
                {stats.groups}
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Grupos
              </ThemedText>
            </ThemedView>

            <ThemedView type="backgroundElement" style={styles.statCard}>
              <SymbolView
                name={{ ios: 'list.bullet.clipboard', android: 'assignment', web: 'assignment' }}
                size={22}
                tintColor={theme.text}
              />
              <ThemedText type="title" style={styles.statNumber}>
                {stats.metaGroups}
              </ThemedText>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Rutinas
              </ThemedText>
            </ThemedView>
          </View>

          {/* Today's scheduled routines banner */}
          {todayRoutines.length > 0 && (
            <Pressable
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [
                styles.todayBanner,
                { borderColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}>
              <View style={styles.todayBannerIcon}>
                <SymbolView
                  name={{ ios: 'calendar.badge.clock', android: 'event_available', web: 'event_available' }}
                  size={22}
                  tintColor="#3c87f7"
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Rutina de Hoy</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {todayRoutines.join(', ')}
                </ThemedText>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          )}

          {/* Navigation Shortcuts */}
          <View style={styles.sectionHeader}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Accesos Rápidos
            </ThemedText>
          </View>

          <View style={styles.shortcutList}>
            <Pressable
              onPress={() => router.push('/workout?tab=exercises')}
              style={({ pressed }) => [
                styles.shortcutCard,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <View style={styles.shortcutLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: 'rgba(60, 135, 247, 0.15)' }]}>
                  <SymbolView
                    name={{ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }}
                    size={20}
                    tintColor="#3c87f7"
                  />
                </View>
                <View>
                  <ThemedText type="smallBold">Catálogo de Ejercicios</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Crear ejercicios sueltos, series y videos
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </Pressable>

            <Pressable
              onPress={() => router.push('/workout?tab=groups')}
              style={({ pressed }) => [
                styles.shortcutCard,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <View style={styles.shortcutLeft}>
                <View style={[styles.iconWrapper, { backgroundColor: 'rgba(52, 199, 89, 0.15)' }]}>
                  <SymbolView
                    name={{ ios: 'folder.fill', android: 'folder', web: 'folder' }}
                    size={20}
                    tintColor="#34c759"
                  />
                </View>
                <View>
                  <ThemedText type="smallBold">Grupos de Músculos</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Agrupar ejercicios por zonas o categorías
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </Pressable>

            <Pressable
              onPress={() => router.push('/workout?tab=routines')}
              style={({ pressed }) => [
                styles.shortcutCard,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <View style={shortcutLeftStyle}>
                <View style={[styles.iconWrapper, { backgroundColor: 'rgba(255, 149, 0, 0.15)' }]}>
                  <SymbolView
                    name={{ ios: 'list.bullet.clipboard.fill', android: 'assignment', web: 'assignment' }}
                    size={20}
                    tintColor="#ff9500"
                  />
                </View>
                <View>
                  <ThemedText type="smallBold">Rutinas de Entrenamiento</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Organizar múltiples grupos en rutinas semanales
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </Pressable>

            <Pressable
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [
                styles.shortcutCard,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <View style={shortcutLeftStyle}>
                <View style={[styles.iconWrapper, { backgroundColor: 'rgba(90, 200, 250, 0.15)' }]}>
                  <SymbolView
                    name={{ ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }}
                    size={20}
                    tintColor="#5ac8fa"
                  />
                </View>
                <View>
                  <ThemedText type="smallBold">Agenda Semanal</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Planificar rutinas en el calendario de la semana
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          </View>

          <Pressable
            onPress={() => setDeleteModalVisible(true)}
            style={({ pressed }) => [
              styles.deleteHistoryBtn,
              pressed && styles.pressed,
            ]}>
            <SymbolView
              name={{ ios: 'trash', android: 'delete', web: 'delete' }}
              size={14}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="small" themeColor="textSecondary" style={styles.deleteHistoryText}>
              Limpiar historial de entrenamiento
            </ThemedText>
          </Pressable>

          <DeleteHistoryModal
            visible={deleteModalVisible}
            onClose={() => setDeleteModalVisible(false)}
            onConfirm={handleConfirmDelete}
          />

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const screenWidth = Dimensions.get('window').width;

const styles = StyleSheet.create({
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
  scrollContent: {
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  appBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(60, 135, 247, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  statNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: 34,
  },
  sectionHeader: {
    marginTop: Spacing.two,
  },
  shortcutList: {
    gap: Spacing.two,
  },
  shortcutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  shortcutLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    flex: 1,
  },
  iconWrapper: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  todayBannerIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(60, 135, 247, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  bottomSpacer: {
    height: Spacing.four,
  },
  deleteHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
  },
  deleteHistoryText: {
    fontSize: 12,
    opacity: 0.6,
  },
});

const shortcutLeftStyle = Platform.select({
  ios: styles.shortcutLeft,
  android: styles.shortcutLeft,
  web: styles.shortcutLeft,
}) ?? styles.shortcutLeft;

