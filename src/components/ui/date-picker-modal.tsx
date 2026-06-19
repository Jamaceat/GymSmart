import React, { useState, useEffect } from 'react';
import { StyleSheet, Modal, Pressable, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Helper to format Date to YYYY-MM-DD
const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper: Month names in Spanish
const getSpanishMonthName = (monthIndex: number): string => {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  return months[monthIndex];
};

interface DatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  value: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
  title: string;
}

export function DatePickerModal({
  visible,
  onClose,
  value,
  onSelect,
  title,
}: DatePickerModalProps) {
  const theme = useTheme();

  // Parse initial date value (forcing UTC/local safety)
  const getParsedDate = (val: string) => {
    if (!val) return new Date();
    const parts = val.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
    return new Date();
  };

  const [currentYear, setCurrentYear] = useState(() => getParsedDate(value).getFullYear());
  const [currentMonth, setCurrentMonth] = useState(() => getParsedDate(value).getMonth());
  const [viewMode, setViewMode] = useState<'days' | 'months' | 'years'>('days');
  const [yearRangeStart, setYearRangeStart] = useState(() => getParsedDate(value).getFullYear() - 5);

  // Sync state when modal opens or value changes
  useEffect(() => {
    if (visible) {
      const d = getParsedDate(value);
      setCurrentYear(d.getFullYear());
      setCurrentMonth(d.getMonth());
      setViewMode('days');
    }
  }, [visible, value]);

  // Sync year range starting value when currentYear changes
  useEffect(() => {
    setYearRangeStart(currentYear - 5);
  }, [currentYear]);

  // Navigate to previous month/year/range
  const handlePrev = () => {
    if (viewMode === 'days') {
      if (currentMonth === 0) {
        setCurrentMonth(11);
        setCurrentYear(prev => prev - 1);
      } else {
        setCurrentMonth(prev => prev - 1);
      }
    } else if (viewMode === 'months') {
      setCurrentYear(prev => prev - 1);
    } else if (viewMode === 'years') {
      setYearRangeStart(prev => prev - 12);
    }
  };

  // Navigate to next month/year/range
  const handleNext = () => {
    if (viewMode === 'days') {
      if (currentMonth === 11) {
        setCurrentMonth(0);
        setCurrentYear(prev => prev + 1);
      } else {
        setCurrentMonth(prev => prev + 1);
      }
    } else if (viewMode === 'months') {
      setCurrentYear(prev => prev + 1);
    } else if (viewMode === 'years') {
      setYearRangeStart(prev => prev + 12);
    }
  };

  const handlePrevYear = () => {
    setCurrentYear(prev => prev - 1);
  };

  const handleNextYear = () => {
    setCurrentYear(prev => prev + 1);
  };

  // Select today, switch to days view, focus current month, and submit selection
  const handleGoToToday = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setViewMode('days');
    onSelect(formatDate(today));
    onClose();
  };

  // Cycle view mode when tapping the header title
  const handleHeaderPress = () => {
    if (viewMode === 'days') {
      setViewMode('months');
    } else if (viewMode === 'months') {
      setViewMode('years');
    } else {
      setViewMode('days');
    }
  };

  // Days View calculations
  const numDays = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayIndex = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7;
  const totalSlots = firstDayIndex + numDays;
  const daysArray = Array.from({ length: totalSlots }, (_, i) => {
    if (i < firstDayIndex) {
      return null;
    }
    return i - firstDayIndex + 1;
  });

  const parsedSelectedDate = value ? getParsedDate(value) : null;
  const isDaySelected = (day: number) => {
    if (!parsedSelectedDate) return false;
    return (
      parsedSelectedDate.getDate() === day &&
      parsedSelectedDate.getMonth() === currentMonth &&
      parsedSelectedDate.getFullYear() === currentYear
    );
  };

  const handleSelectDay = (day: number) => {
    const selected = new Date(currentYear, currentMonth, day);
    onSelect(formatDate(selected));
    onClose();
  };

  // Months View calculations
  const monthsList = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  // Years View calculations
  const yearsList = Array.from({ length: 12 }, (_, i) => yearRangeStart + i);

  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              {title}
            </ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                tintColor={theme.textSecondary}
              />
            </Pressable>
          </View>

          {/* Month/Year Navigation Row */}
          <View style={styles.navRow}>
            <View style={styles.navGroup}>
              {viewMode === 'days' && (
                <Pressable onPress={handlePrevYear} style={styles.navBtn}>
                  <SymbolView
                    name={{ ios: 'chevron.left.2', android: 'keyboard_double_arrow_left', web: 'keyboard_double_arrow_left' }}
                    size={18}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              )}
              <Pressable onPress={handlePrev} style={styles.navBtn}>
                <SymbolView
                  name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
                  size={18}
                  tintColor={theme.text}
                />
              </Pressable>
            </View>

            <Pressable
              onPress={handleHeaderPress}
              style={({ pressed }) => [styles.headerPressable, pressed && styles.pressed]}
            >
              <ThemedText type="smallBold" style={styles.monthText}>
                {viewMode === 'days' && `${getSpanishMonthName(currentMonth)} ${currentYear}`}
                {viewMode === 'months' && `${currentYear}`}
                {viewMode === 'years' && `${yearRangeStart} - ${yearRangeStart + 11}`}
              </ThemedText>
              <SymbolView
                name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
                size={14}
                tintColor={theme.textSecondary}
                style={{ marginLeft: 4 }}
              />
            </Pressable>

            <View style={styles.navGroup}>
              <Pressable onPress={handleNext} style={styles.navBtn}>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={18}
                  tintColor={theme.text}
                />
              </Pressable>
              {viewMode === 'days' && (
                <Pressable onPress={handleNextYear} style={styles.navBtn}>
                  <SymbolView
                    name={{ ios: 'chevron.right.2', android: 'keyboard_double_arrow_right', web: 'keyboard_double_arrow_right' }}
                    size={18}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              )}
            </View>
          </View>

          {/* Calendar Views */}
          {viewMode === 'days' && (
            <View style={styles.calendarGrid}>
              {/* Weekday labels */}
              <View style={styles.weekLabelsRow}>
                {dayLabels.map((label, idx) => (
                  <View key={idx} style={styles.gridCell}>
                    <ThemedText type="code" themeColor="textSecondary" style={styles.weekLabelText}>
                      {label}
                    </ThemedText>
                  </View>
                ))}
              </View>

              {/* Days grid */}
              <View style={styles.daysGridRow}>
                {daysArray.map((day, idx) => {
                  if (day === null) {
                    return <View key={idx} style={styles.gridCell} />;
                  }

                  const selected = isDaySelected(day);

                  return (
                    <Pressable
                      key={idx}
                      onPress={() => handleSelectDay(day)}
                      style={styles.gridCell}
                    >
                      {({ pressed }) => (
                        <View
                          style={[
                            styles.dayInner,
                            selected && { backgroundColor: '#3c87f7' },
                            pressed && !selected && { backgroundColor: theme.backgroundSelected },
                          ]}
                        >
                          <ThemedText
                            type={selected ? 'smallBold' : 'small'}
                            style={{ color: selected ? '#ffffff' : theme.text }}
                          >
                            {day}
                          </ThemedText>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {viewMode === 'months' && (
            <View style={styles.gridRow}>
              {monthsList.map((monthName, idx) => {
                const isCurrent = idx === currentMonth;
                return (
                  <Pressable
                    key={idx}
                    onPress={() => {
                      setCurrentMonth(idx);
                      setViewMode('days');
                    }}
                    style={({ pressed }) => [
                      styles.monthGridCell,
                      isCurrent && { backgroundColor: '#3c87f7' },
                      pressed && !isCurrent && { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <ThemedText
                      type={isCurrent ? 'smallBold' : 'small'}
                      style={{ color: isCurrent ? '#ffffff' : theme.text }}
                    >
                      {monthName}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {viewMode === 'years' && (
            <View style={styles.gridRow}>
              {yearsList.map((yr) => {
                const isCurrent = yr === currentYear;
                return (
                  <Pressable
                    key={yr}
                    onPress={() => {
                      setCurrentYear(yr);
                      setViewMode('months');
                    }}
                    style={({ pressed }) => [
                      styles.yearGridCell,
                      isCurrent && { backgroundColor: '#3c87f7' },
                      pressed && !isCurrent && { backgroundColor: theme.backgroundSelected },
                    ]}
                  >
                    <ThemedText
                      type={isCurrent ? 'smallBold' : 'small'}
                      style={{ color: isCurrent ? '#ffffff' : theme.text }}
                    >
                      {yr}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Footer with Today shortcut */}
          <View style={styles.footer}>
            <Pressable
              onPress={handleGoToToday}
              style={({ pressed }) => [
                styles.todayBtn,
                { backgroundColor: theme.backgroundSelected },
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={{ ios: 'calendar.badge.clock', android: 'today', web: 'today' }}
                size={14}
                tintColor={theme.text}
              />
              <ThemedText type="smallBold" style={{ marginLeft: 6 }}>
                Hoy
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
    borderRadius: Spacing.three,
    padding: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    gap: Spacing.one,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128, 128, 128, 0.12)',
    paddingBottom: Spacing.two,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: Spacing.one,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: Spacing.one,
  },
  navBtn: {
    padding: Spacing.two,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
  },
  headerPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.one,
  },
  monthText: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  calendarGrid: {
    width: '100%',
  },
  weekLabelsRow: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: Spacing.one,
  },
  daysGridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
  },
  gridCell: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  weekLabelText: {
    fontWeight: 'bold',
    fontSize: 11,
  },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: '100%',
    marginVertical: Spacing.one,
  },
  monthGridCell: {
    width: '33.33%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Spacing.two,
  },
  yearGridCell: {
    width: '33.33%',
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Spacing.two,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.12)',
    paddingTop: Spacing.two,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  todayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
