import { SQLiteDatabase } from 'expo-sqlite';
import { MuscleIntensity } from '@/constants/muscle-groups';

export interface SeriesConfigItem {
  set: number;
  reps: number;
}

export interface InitialStateConfig {
  weight: number;
  reps: number;
  notes: string;
}

export interface Exercise {
  id?: number;
  name: string;
  default_sets: number;
  default_reps: number;
  is_constant: number; // 1 = Series constantes, 0 = Series variables (subsets)
  series_config: string | null; // serialized JSON array of SeriesConfigItem
  video_url: string | null;
  initial_state: string | null; // serialized JSON of InitialStateConfig
  muscle_group?: string | null;
  muscles?: { muscle_id: string; intensity: MuscleIntensity }[];
  created_at?: string;
  repsDisplay?: string;
  isAudit?: boolean;
}

export interface ExerciseGroup {
  id?: number;
  name: string;
  created_at?: string;
  exercises?: Exercise[];
  meta_group_item_id?: number;
}

export interface MetaGroup {
  id?: number;
  name: string;
  created_at?: string;
  groups?: ExerciseGroup[];
}

export interface ExerciseCompletionAudit {
  id?: number;
  exercise_id: number | null;
  exercise_name: string;
  set_index: number;
  repetitions: number;
  seconds_taken: number | null;
  routine_id: number;
  routine_name: string;
  completed_date: string; // YYYY-MM-DD
  group_name?: string | null;
  meta_group_item_id?: number | null;
  created_at?: string;
}

export interface ExerciseStatItem {
  exercise_id: number | null;
  exercise_name: string;
  total_reps: number;
  times_done: number;
  historical_max_reps: number;
}

// Database version control and migrations
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  try {
    // Always enable foreign keys first
    await db.execAsync('PRAGMA foreign_keys = ON;');

    // Unconditionally run CREATE TABLE IF NOT EXISTS for all tables to ensure they all exist.
    // In SQLite, this is a fast no-op if the table already exists.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS exercises (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          default_sets INTEGER NOT NULL DEFAULT 3,
          default_reps INTEGER NOT NULL DEFAULT 10,
          is_constant INTEGER NOT NULL DEFAULT 1,
          series_config TEXT,
          video_url TEXT,
          initial_state TEXT,
          muscle_group TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS exercise_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS group_exercises (
          group_id INTEGER,
          exercise_id INTEGER,
          order_index INTEGER NOT NULL,
          PRIMARY KEY (group_id, exercise_id),
          FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS meta_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS meta_group_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meta_group_id INTEGER,
          group_id INTEGER,
          order_index INTEGER NOT NULL,
          FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scheduled_routines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meta_group_id INTEGER NOT NULL,
          scheduled_date TEXT NOT NULL,
          is_completed INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_progress (
          meta_group_id INTEGER,
          scheduled_date TEXT,
          active_index INTEGER,
          active_seconds INTEGER,
          rest_seconds INTEGER,
          is_resting INTEGER,
          current_set INTEGER,
          completed_sets TEXT,
          completed_exercises TEXT,
          set_times TEXT,
          PRIMARY KEY (meta_group_id, scheduled_date),
          FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exercise_completion_audits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          exercise_id INTEGER,
          exercise_name TEXT NOT NULL,
          set_index INTEGER NOT NULL,
          repetitions INTEGER NOT NULL,
          seconds_taken INTEGER,
          routine_id INTEGER,
          routine_name TEXT NOT NULL,
          completed_date TEXT NOT NULL,
          group_name TEXT,
          meta_group_item_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS exercise_muscles (
          exercise_id INTEGER,
          muscle_id TEXT NOT NULL,
          intensity TEXT NOT NULL,
          PRIMARY KEY (exercise_id, muscle_id),
          FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_exercise_completion_audits_date ON exercise_completion_audits (completed_date);
    `);

    // Ensure all columns exist in the exercises table in case it was created in an older code version
    const columnsCheck = await db.getAllAsync<{ name: string }>("PRAGMA table_info(exercises);");
    const columnNames = columnsCheck.map(c => c.name);

    if (columnNames.length > 0) {
      const expectedColumns = [
        { name: 'default_sets', type: 'INTEGER NOT NULL DEFAULT 3' },
        { name: 'default_reps', type: 'INTEGER NOT NULL DEFAULT 10' },
        { name: 'is_constant', type: 'INTEGER NOT NULL DEFAULT 1' },
        { name: 'series_config', type: 'TEXT' },
        { name: 'video_url', type: 'TEXT' },
        { name: 'initial_state', type: 'TEXT' },
        { name: 'muscle_group', type: 'TEXT' },
        { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
      ];
      for (const col of expectedColumns) {
        if (!columnNames.includes(col.name)) {
          await db.execAsync(`ALTER TABLE exercises ADD COLUMN ${col.name} ${col.type};`);
        }
      }
    }

    // Ensure all columns exist in the scheduled_routines table
    const scheduledRoutinesCheck = await db.getAllAsync<{ name: string }>("PRAGMA table_info(scheduled_routines);");
    const scheduledRoutinesColumns = scheduledRoutinesCheck.map(c => c.name);

    if (scheduledRoutinesColumns.length > 0) {
      if (!scheduledRoutinesColumns.includes('is_completed')) {
        await db.execAsync('ALTER TABLE scheduled_routines ADD COLUMN is_completed INTEGER DEFAULT 0;');
      }
    }

    // Ensure set_times column exists in session_progress table
    const sessionProgressCheck = await db.getAllAsync<{ name: string }>("PRAGMA table_info(session_progress);");
    const sessionProgressColumns = sessionProgressCheck.map(c => c.name);
    if (sessionProgressColumns.length > 0 && !sessionProgressColumns.includes('set_times')) {
      await db.execAsync('ALTER TABLE session_progress ADD COLUMN set_times TEXT;');
    }

    // Ensure custom_reps column exists in session_progress table
    if (sessionProgressColumns.length > 0 && !sessionProgressColumns.includes('custom_reps')) {
      await db.execAsync('ALTER TABLE session_progress ADD COLUMN custom_reps TEXT;');
    }

    // Ensure set_index column exists in exercise_completion_audits table
    const auditsCheck = await db.getAllAsync<{ name: string }>("PRAGMA table_info(exercise_completion_audits);");
    const auditsColumns = auditsCheck.map(c => c.name);
    if (auditsColumns.length > 0 && !auditsColumns.includes('set_index')) {
      await db.execAsync('DROP TABLE exercise_completion_audits;');
      await db.execAsync(`
        CREATE TABLE exercise_completion_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise_id INTEGER,
            exercise_name TEXT NOT NULL,
            set_index INTEGER NOT NULL,
            repetitions INTEGER NOT NULL,
            seconds_taken INTEGER,
            routine_id INTEGER,
            routine_name TEXT NOT NULL,
            completed_date TEXT NOT NULL,
            group_name TEXT,
            meta_group_item_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_exercise_completion_audits_date ON exercise_completion_audits (completed_date);');
    }

    // Ensure group_name column exists in exercise_completion_audits table
    if (auditsColumns.length > 0 && !auditsColumns.includes('group_name')) {
      await db.execAsync('ALTER TABLE exercise_completion_audits ADD COLUMN group_name TEXT;');
    }

    // Ensure meta_group_item_id column exists in exercise_completion_audits table
    if (auditsColumns.length > 0 && !auditsColumns.includes('meta_group_item_id')) {
      await db.execAsync('ALTER TABLE exercise_completion_audits ADD COLUMN meta_group_item_id INTEGER;');
    }

    // Ensure meta_group_items has surrogate id instead of composite primary key
    const metaGroupItemsCheck = await db.getAllAsync<{ name: string }>("PRAGMA table_info(meta_group_items);");
    const metaGroupItemsColumns = metaGroupItemsCheck.map(c => c.name);

    if (metaGroupItemsColumns.length > 0 && !metaGroupItemsColumns.includes('id')) {
      await db.execAsync(`
        ALTER TABLE meta_group_items RENAME TO meta_group_items_old;

        CREATE TABLE meta_group_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meta_group_id INTEGER,
            group_id INTEGER,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE,
            FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE
        );

        INSERT INTO meta_group_items (meta_group_id, group_id, order_index)
        SELECT meta_group_id, group_id, order_index FROM meta_group_items_old;

        DROP TABLE meta_group_items_old;
      `);
    }

    // Set user_version to 1
    await db.execAsync('PRAGMA user_version = 1;');
  } catch (error) {
    console.error('CRITICAL DATABASE MIGRATION ERROR:', error);
    throw error;
  }
}

// ==========================================
// EXERCISE CRUD OPERATIONS
// ==========================================

export async function getExercises(db: SQLiteDatabase): Promise<Exercise[]> {
  const exercises = await db.getAllAsync<Exercise>('SELECT * FROM exercises ORDER BY name ASC');
  for (const ex of exercises) {
    if (ex.id) {
      const muscles = await db.getAllAsync<{ muscle_id: string; intensity: MuscleIntensity }>(
        'SELECT muscle_id, intensity FROM exercise_muscles WHERE exercise_id = ?',
        [ex.id]
      );
      ex.muscles = muscles;
    }
  }
  return exercises;
}

export async function getExerciseById(db: SQLiteDatabase, id: number): Promise<Exercise | null> {
  const exercise = await db.getFirstAsync<Exercise>('SELECT * FROM exercises WHERE id = ?', [id]);
  if (exercise && exercise.id) {
    const muscles = await db.getAllAsync<{ muscle_id: string; intensity: MuscleIntensity }>(
      'SELECT muscle_id, intensity FROM exercise_muscles WHERE exercise_id = ?',
      [exercise.id]
    );
    exercise.muscles = muscles;
  }
  return exercise;
}

export async function insertExercise(
  db: SQLiteDatabase,
  exercise: Omit<Exercise, 'id' | 'created_at'>
): Promise<number> {
  let lastInsertRowId = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      `INSERT INTO exercises (name, default_sets, default_reps, is_constant, series_config, video_url, initial_state, muscle_group) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exercise.name,
        exercise.default_sets,
        exercise.default_reps,
        exercise.is_constant,
        exercise.series_config,
        exercise.video_url,
        exercise.initial_state,
        exercise.muscle_group ?? null,
      ]
    );
    lastInsertRowId = result.lastInsertRowId;

    if (exercise.muscles && exercise.muscles.length > 0) {
      for (const m of exercise.muscles) {
        await db.runAsync(
          'INSERT INTO exercise_muscles (exercise_id, muscle_id, intensity) VALUES (?, ?, ?)',
          [lastInsertRowId, m.muscle_id, m.intensity]
        );
      }
    }
  });
  return lastInsertRowId;
}

export async function updateExercise(
  db: SQLiteDatabase,
  id: number,
  exercise: Partial<Omit<Exercise, 'id' | 'created_at'>>
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE exercises SET 
        name = COALESCE(?, name),
        default_sets = COALESCE(?, default_sets),
        default_reps = COALESCE(?, default_reps),
        is_constant = COALESCE(?, is_constant),
        series_config = COALESCE(?, series_config),
        video_url = COALESCE(?, video_url),
        initial_state = COALESCE(?, initial_state),
        muscle_group = COALESCE(?, muscle_group)
       WHERE id = ?`,
      [
        exercise.name ?? null,
        exercise.default_sets ?? null,
        exercise.default_reps ?? null,
        exercise.is_constant ?? null,
        exercise.series_config ?? null,
        exercise.video_url ?? null,
        exercise.initial_state ?? null,
        exercise.muscle_group ?? null,
        id,
      ]
    );

    if (exercise.muscles !== undefined) {
      await db.runAsync('DELETE FROM exercise_muscles WHERE exercise_id = ?', [id]);
      if (exercise.muscles && exercise.muscles.length > 0) {
        for (const m of exercise.muscles) {
          await db.runAsync(
            'INSERT INTO exercise_muscles (exercise_id, muscle_id, intensity) VALUES (?, ?, ?)',
            [id, m.muscle_id, m.intensity]
          );
        }
      }
    }
  });
}

export async function deleteExercise(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM exercises WHERE id = ?', [id]);
}

// ==========================================
// GROUP CRUD OPERATIONS
// ==========================================

export async function getGroups(db: SQLiteDatabase): Promise<ExerciseGroup[]> {
  return await db.getAllAsync<ExerciseGroup>('SELECT * FROM exercise_groups ORDER BY name ASC');
}

export async function getGroupWithExercises(db: SQLiteDatabase, groupId: number): Promise<ExerciseGroup | null> {
  const group = await db.getFirstAsync<ExerciseGroup>('SELECT * FROM exercise_groups WHERE id = ?', [groupId]);
  if (!group) return null;

  const exercises = await db.getAllAsync<Exercise>(
    `SELECT e.* FROM exercises e 
     JOIN group_exercises ge ON e.id = ge.exercise_id 
     WHERE ge.group_id = ? 
     ORDER BY ge.order_index ASC`,
    [groupId]
  );
  for (const ex of exercises) {
    if (ex.id) {
      const muscles = await db.getAllAsync<{ muscle_id: string; intensity: MuscleIntensity }>(
        'SELECT muscle_id, intensity FROM exercise_muscles WHERE exercise_id = ?',
        [ex.id]
      );
      ex.muscles = muscles;
    }
  }
  return { ...group, exercises };
}

export async function insertGroup(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync('INSERT INTO exercise_groups (name) VALUES (?)', [name]);
  return result.lastInsertRowId;
}

export async function updateGroupName(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE exercise_groups SET name = ? WHERE id = ?', [name, id]);
}

export async function deleteGroup(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM exercise_groups WHERE id = ?', [id]);
}

export async function addExerciseToGroup(
  db: SQLiteDatabase,
  groupId: number,
  exerciseId: number,
  orderIndex: number
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO group_exercises (group_id, exercise_id, order_index) VALUES (?, ?, ?)',
    [groupId, exerciseId, orderIndex]
  );
}

export async function removeExerciseFromGroup(
  db: SQLiteDatabase,
  groupId: number,
  exerciseId: number
): Promise<void> {
  await db.runAsync('DELETE FROM group_exercises WHERE group_id = ? AND exercise_id = ?', [groupId, exerciseId]);
}

export async function updateGroupExercisesOrder(db: SQLiteDatabase, groupId: number, exerciseIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM group_exercises WHERE group_id = ?', [groupId]);
    for (let i = 0; i < exerciseIds.length; i++) {
      await db.runAsync(
        'INSERT INTO group_exercises (group_id, exercise_id, order_index) VALUES (?, ?, ?)',
        [groupId, exerciseIds[i], i]
      );
    }
  });
}

// ==========================================
// META-GROUP CRUD OPERATIONS
// ==========================================

export async function getMetaGroups(db: SQLiteDatabase): Promise<MetaGroup[]> {
  return await db.getAllAsync<MetaGroup>('SELECT * FROM meta_groups ORDER BY name ASC');
}

export async function getMetaGroupWithGroups(db: SQLiteDatabase, metaGroupId: number): Promise<MetaGroup | null> {
  const metaGroup = await db.getFirstAsync<MetaGroup>('SELECT * FROM meta_groups WHERE id = ?', [metaGroupId]);
  if (!metaGroup) return null;

  const groups = await db.getAllAsync<ExerciseGroup>(
    `SELECT eg.*, mgi.id as meta_group_item_id FROM exercise_groups eg 
     JOIN meta_group_items mgi ON eg.id = mgi.group_id 
     WHERE mgi.meta_group_id = ? 
     ORDER BY mgi.order_index ASC`,
    [metaGroupId]
  );
  return { ...metaGroup, groups };
}

export async function insertMetaGroup(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync('INSERT INTO meta_groups (name) VALUES (?)', [name]);
  return result.lastInsertRowId;
}

export async function updateMetaGroupName(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE meta_groups SET name = ? WHERE id = ?', [name, id]);
}

export async function deleteMetaGroup(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM meta_groups WHERE id = ?', [id]);
}

export async function addGroupToMetaGroup(
  db: SQLiteDatabase,
  metaGroupId: number,
  groupId: number,
  orderIndex: number
): Promise<void> {
  await db.runAsync(
    'INSERT INTO meta_group_items (meta_group_id, group_id, order_index) VALUES (?, ?, ?)',
    [metaGroupId, groupId, orderIndex]
  );
}

export async function removeGroupFromMetaGroup(
  db: SQLiteDatabase,
  metaGroupItemId: number
): Promise<void> {
  await db.runAsync('DELETE FROM meta_group_items WHERE id = ?', [metaGroupItemId]);
}

export async function updateMetaGroupItemsOrder(db: SQLiteDatabase, metaGroupId: number, metaGroupItemIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < metaGroupItemIds.length; i++) {
      await db.runAsync(
        'UPDATE meta_group_items SET order_index = ? WHERE id = ? AND meta_group_id = ?',
        [i, metaGroupItemIds[i], metaGroupId]
      );
    }
  });
}

// ==========================================
// SCHEDULED ROUTINES CRUD OPERATIONS
// ==========================================

export interface ScheduledRoutine {
  id: number;
  meta_group_id: number;
  meta_group_name: string;
  scheduled_date: string; // YYYY-MM-DD
  is_completed?: number;
  created_at?: string;
}

export async function getScheduledRoutinesForRange(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string
): Promise<ScheduledRoutine[]> {
  return await db.getAllAsync<ScheduledRoutine>(
    `SELECT sr.*, mg.name as meta_group_name 
     FROM scheduled_routines sr
     JOIN meta_groups mg ON sr.meta_group_id = mg.id
     WHERE sr.scheduled_date BETWEEN ? AND ?
     ORDER BY sr.scheduled_date ASC, sr.created_at ASC`,
    [startDate, endDate]
  );
}

export async function insertScheduledRoutine(
  db: SQLiteDatabase,
  metaGroupId: number,
  date: string
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO scheduled_routines (meta_group_id, scheduled_date) VALUES (?, ?)',
    [metaGroupId, date]
  );
  return result.lastInsertRowId;
}

export async function deleteScheduledRoutine(
  db: SQLiteDatabase,
  id: number,
  metaGroupId: number,
  date: string
): Promise<void> {
  await db.withTransactionAsync(async () => {
    if (id > 0) {
      await db.runAsync('DELETE FROM scheduled_routines WHERE id = ?', [id]);
    } else {
      await db.runAsync(
        'DELETE FROM scheduled_routines WHERE meta_group_id = ? AND scheduled_date = ?',
        [metaGroupId, date]
      );
    }
    await db.runAsync(
      'DELETE FROM exercise_completion_audits WHERE routine_id = ? AND completed_date = ?',
      [metaGroupId, date]
    );
    await db.runAsync(
      'DELETE FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ?',
      [metaGroupId, date]
    );
  });
}

// ==========================================
// EXERCISE COMPLETION AUDIT & STATS OPERATIONS
// ==========================================

export async function insertExerciseCompletionAudit(
  db: SQLiteDatabase,
  audit: Omit<ExerciseCompletionAudit, 'id' | 'created_at'>
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO exercise_completion_audits 
     (exercise_id, exercise_name, set_index, repetitions, seconds_taken, routine_id, routine_name, completed_date, group_name, meta_group_item_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      audit.exercise_id,
      audit.exercise_name,
      audit.set_index,
      audit.repetitions,
      audit.seconds_taken,
      audit.routine_id,
      audit.routine_name,
      audit.completed_date,
      audit.group_name ?? null,
      audit.meta_group_item_id ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export async function getExerciseStatsAllTime(db: SQLiteDatabase): Promise<ExerciseStatItem[]> {
  return await db.getAllAsync<ExerciseStatItem>(
    `SELECT 
       a.exercise_id,
       a.exercise_name,
       SUM(a.repetitions) as total_reps,
       COUNT(DISTINCT a.completed_date || '-' || a.routine_id) as times_done,
       COALESCE(m.historical_max_reps, 0) as historical_max_reps
     FROM exercise_completion_audits a
     LEFT JOIN (
       SELECT exercise_id, MAX(routine_reps) as historical_max_reps
       FROM (
         SELECT exercise_id, SUM(repetitions) as routine_reps
         FROM exercise_completion_audits
         GROUP BY exercise_id, completed_date, routine_id
       )
       GROUP BY exercise_id
     ) m ON a.exercise_id = m.exercise_id
     GROUP BY a.exercise_id, a.exercise_name
     ORDER BY total_reps DESC`
  );
}

export async function getExerciseStatsForRange(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string
): Promise<ExerciseStatItem[]> {
  return await db.getAllAsync<ExerciseStatItem>(
    `SELECT 
       a.exercise_id,
       a.exercise_name,
       SUM(a.repetitions) as total_reps,
       COUNT(DISTINCT a.completed_date || '-' || a.routine_id) as times_done,
       COALESCE(m.historical_max_reps, 0) as historical_max_reps
     FROM exercise_completion_audits a
     LEFT JOIN (
       SELECT exercise_id, MAX(routine_reps) as historical_max_reps
       FROM (
         SELECT exercise_id, SUM(repetitions) as routine_reps
         FROM exercise_completion_audits
         GROUP BY exercise_id, completed_date, routine_id
       )
       GROUP BY exercise_id
     ) m ON a.exercise_id = m.exercise_id
     WHERE a.completed_date BETWEEN ? AND ?
     GROUP BY a.exercise_id, a.exercise_name
     ORDER BY total_reps DESC`,
    [startDate, endDate]
  );
}

export interface ExerciseProgressHistoryItem {
  completed_date: string;
  total_reps: number;
  routine_name: string;
}

export async function getExerciseProgressHistory(
  db: SQLiteDatabase,
  exerciseId: number | null,
  exerciseName: string
): Promise<ExerciseProgressHistoryItem[]> {
  if (exerciseId !== null) {
    return await db.getAllAsync<ExerciseProgressHistoryItem>(
      `SELECT 
         completed_date,
         SUM(repetitions) as total_reps,
         routine_name
       FROM exercise_completion_audits
       WHERE exercise_id = ? OR exercise_name = ?
       GROUP BY completed_date, routine_id
       ORDER BY completed_date ASC`,
      [exerciseId, exerciseName]
    );
  } else {
    return await db.getAllAsync<ExerciseProgressHistoryItem>(
      `SELECT 
         completed_date,
         SUM(repetitions) as total_reps,
         routine_name
       FROM exercise_completion_audits
       WHERE exercise_name = ?
       GROUP BY completed_date, routine_id
        ORDER BY completed_date ASC`,
      [exerciseName]
    );
  }
}

export interface WorkedMuscle {
  muscle_id: string;
  intensity: MuscleIntensity;
}

export async function getWorkedMusclesForRange(
  db: SQLiteDatabase,
  startDate: string | null,
  endDate: string | null
): Promise<WorkedMuscle[]> {
  let query = `
    SELECT em.muscle_id, em.intensity
    FROM exercise_completion_audits a
    JOIN exercises e ON (a.exercise_id = e.id OR (a.exercise_id IS NULL AND a.exercise_name = e.name))
    JOIN exercise_muscles em ON e.id = em.exercise_id
  `;
  const params: string[] = [];
  if (startDate && endDate) {
    query += ` WHERE a.completed_date BETWEEN ? AND ?`;
    params.push(startDate, endDate);
  }

  const rows = await db.getAllAsync<{ muscle_id: string; intensity: MuscleIntensity }>(query, params);

  // Combine to keep the highest intensity per muscle_id
  const intensityOrder: Record<MuscleIntensity, number> = {
    primary: 3,
    secondary: 2,
    stabilizer: 1
  };

  const combined: Record<string, MuscleIntensity> = {};
  for (const row of rows) {
    const existing = combined[row.muscle_id];
    if (!existing || intensityOrder[row.intensity] > intensityOrder[existing]) {
      combined[row.muscle_id] = row.intensity;
    }
  }

  return Object.entries(combined).map(([muscle_id, intensity]) => ({
    muscle_id,
    intensity,
  }));
}
