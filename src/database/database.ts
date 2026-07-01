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
  weight?: number | null; // default weight if applicable
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
  weight?: number | null; // weight lifted in this set
  seconds_taken: number | null;
  routine_id: number;
  routine_name: string;
  completed_date: string; // YYYY-MM-DD
  group_name?: string | null;
  meta_group_item_id?: number | null;
  scheduled_routine_id?: number | null;
  created_at?: string;
}

export interface ExerciseStatItem {
  exercise_id: number | null;
  exercise_name: string;
  total_reps: number;
  times_done: number;
  historical_max_reps: number;
}

const CURRENT_DB_VERSION = 1;

// Database version control and migrations
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  try {
    await db.execAsync('PRAGMA foreign_keys = ON;');

    const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    const currentVersion = versionRow?.user_version ?? 0;

    if (currentVersion >= CURRENT_DB_VERSION) return;

    // Migration 0 → 1: initial schema + incremental column backfills for pre-versioned installs
    if (currentVersion < 1) {
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
            weight REAL,
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
            scheduled_routine_id INTEGER DEFAULT 0,
            active_index INTEGER,
            active_seconds INTEGER,
            rest_seconds INTEGER,
            is_resting INTEGER,
            current_set INTEGER,
            completed_sets TEXT,
            completed_exercises TEXT,
            set_times TEXT,
            custom_reps TEXT,
            custom_weights TEXT,
            extra_sets TEXT,
            adhoc_exercises TEXT,
            deleted_sets TEXT,
            PRIMARY KEY (meta_group_id, scheduled_date, scheduled_routine_id),
            FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS exercise_completion_audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise_id INTEGER,
            exercise_name TEXT NOT NULL,
            set_index INTEGER NOT NULL,
            repetitions INTEGER NOT NULL,
            weight REAL,
            seconds_taken INTEGER,
            routine_id INTEGER,
            routine_name TEXT NOT NULL,
            completed_date TEXT NOT NULL,
            group_name TEXT,
            meta_group_item_id INTEGER,
            scheduled_routine_id INTEGER,
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

      // Backfills for installs that existed before user_version was tracked
      const exerciseCols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(exercises);')).map(c => c.name);
      for (const col of [
        { name: 'default_sets', type: 'INTEGER NOT NULL DEFAULT 3' },
        { name: 'default_reps', type: 'INTEGER NOT NULL DEFAULT 10' },
        { name: 'is_constant', type: 'INTEGER NOT NULL DEFAULT 1' },
        { name: 'series_config', type: 'TEXT' },
        { name: 'video_url', type: 'TEXT' },
        { name: 'initial_state', type: 'TEXT' },
        { name: 'muscle_group', type: 'TEXT' },
        { name: 'weight', type: 'REAL' },
        { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
      ]) {
        if (!exerciseCols.includes(col.name)) {
          await db.execAsync(`ALTER TABLE exercises ADD COLUMN ${col.name} ${col.type};`);
        }
      }

      const scheduledCols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(scheduled_routines);')).map(c => c.name);
      if (scheduledCols.length > 0 && !scheduledCols.includes('is_completed')) {
        await db.execAsync('ALTER TABLE scheduled_routines ADD COLUMN is_completed INTEGER DEFAULT 0;');
      }

      const sessionCols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(session_progress);')).map(c => c.name);
      if (sessionCols.length > 0) {
        if (!sessionCols.includes('scheduled_routine_id')) {
          await db.execAsync(`
            ALTER TABLE session_progress RENAME TO session_progress_old;

            CREATE TABLE session_progress (
                meta_group_id INTEGER,
                scheduled_date TEXT,
                scheduled_routine_id INTEGER DEFAULT 0,
                active_index INTEGER,
                active_seconds INTEGER,
                rest_seconds INTEGER,
                is_resting INTEGER,
                current_set INTEGER,
                completed_sets TEXT,
                completed_exercises TEXT,
                set_times TEXT,
                custom_reps TEXT,
                custom_weights TEXT,
                extra_sets TEXT,
                adhoc_exercises TEXT,
                deleted_sets TEXT,
                PRIMARY KEY (meta_group_id, scheduled_date, scheduled_routine_id),
                FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE
            );

            INSERT INTO session_progress (
              meta_group_id, scheduled_date, scheduled_routine_id, active_index, active_seconds,
              rest_seconds, is_resting, current_set, completed_sets, completed_exercises,
              set_times, custom_reps, custom_weights
            )
            SELECT
              meta_group_id, scheduled_date, 0, active_index, active_seconds,
              rest_seconds, is_resting, current_set, completed_sets, completed_exercises,
              set_times, custom_reps, custom_weights
            FROM session_progress_old;

            DROP TABLE session_progress_old;
          `);
        } else {
          for (const col of ['set_times', 'custom_reps', 'custom_weights', 'extra_sets', 'adhoc_exercises', 'deleted_sets']) {
            if (!sessionCols.includes(col)) {
              await db.execAsync(`ALTER TABLE session_progress ADD COLUMN ${col} TEXT;`);
            }
          }
        }
      }

      const auditCols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(exercise_completion_audits);')).map(c => c.name);
      if (auditCols.length > 0) {
        if (!auditCols.includes('set_index')) {
          await db.execAsync('DROP TABLE exercise_completion_audits;');
          await db.execAsync(`
            CREATE TABLE exercise_completion_audits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exercise_id INTEGER,
                exercise_name TEXT NOT NULL,
                set_index INTEGER NOT NULL,
                repetitions INTEGER NOT NULL,
                weight REAL,
                seconds_taken INTEGER,
                routine_id INTEGER,
                routine_name TEXT NOT NULL,
                completed_date TEXT NOT NULL,
                group_name TEXT,
                meta_group_item_id INTEGER,
                scheduled_routine_id INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_exercise_completion_audits_date ON exercise_completion_audits (completed_date);
          `);
        } else {
          for (const col of [
            { name: 'group_name', type: 'TEXT' },
            { name: 'meta_group_item_id', type: 'INTEGER' },
            { name: 'weight', type: 'REAL' },
            { name: 'scheduled_routine_id', type: 'INTEGER' },
          ]) {
            if (!auditCols.includes(col.name)) {
              await db.execAsync(`ALTER TABLE exercise_completion_audits ADD COLUMN ${col.name} ${col.type};`);
            }
          }
        }
      }

      const metaItemCols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(meta_group_items);')).map(c => c.name);
      if (metaItemCols.length > 0 && !metaItemCols.includes('id')) {
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

      await db.execAsync('PRAGMA user_version = 1;');
    }

    // Add future migrations here:
    // if (currentVersion < 2) { ...; await db.execAsync('PRAGMA user_version = 2;'); }

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
      `INSERT INTO exercises (name, default_sets, default_reps, is_constant, series_config, video_url, initial_state, muscle_group, weight) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exercise.name,
        exercise.default_sets,
        exercise.default_reps,
        exercise.is_constant,
        exercise.series_config,
        exercise.video_url,
        exercise.initial_state,
        exercise.muscle_group ?? null,
        exercise.weight ?? null,
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
        muscle_group = COALESCE(?, muscle_group),
        weight = CASE WHEN ? = 1 THEN ? ELSE weight END
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
        exercise.weight !== undefined ? 1 : 0,
        exercise.weight ?? null,
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
      await db.runAsync(
        'DELETE FROM exercise_completion_audits WHERE scheduled_routine_id = ?',
        [id]
      );
      await db.runAsync(
        'DELETE FROM session_progress WHERE scheduled_routine_id = ?',
        [id]
      );
    } else {
      await db.runAsync(
        'DELETE FROM scheduled_routines WHERE meta_group_id = ? AND scheduled_date = ?',
        [metaGroupId, date]
      );
      await db.runAsync(
        'DELETE FROM exercise_completion_audits WHERE routine_id = ? AND completed_date = ?',
        [metaGroupId, date]
      );
      await db.runAsync(
        'DELETE FROM session_progress WHERE meta_group_id = ? AND scheduled_date = ?',
        [metaGroupId, date]
      );
    }
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
     (exercise_id, exercise_name, set_index, repetitions, weight, seconds_taken, routine_id, routine_name, completed_date, group_name, meta_group_item_id, scheduled_routine_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      audit.exercise_id,
      audit.exercise_name,
      audit.set_index,
      audit.repetitions,
      audit.weight ?? null,
      audit.seconds_taken,
      audit.routine_id,
      audit.routine_name,
      audit.completed_date,
      audit.group_name ?? null,
      audit.meta_group_item_id ?? null,
      audit.scheduled_routine_id ?? null,
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
  max_weight?: number | null;
  all_weights?: string | null;
  max_reps?: number | null;
  all_reps?: string | null;
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
         MAX(repetitions) as max_reps,
         MAX(weight) as max_weight,
         GROUP_CONCAT(weight) as all_weights,
         GROUP_CONCAT(repetitions) as all_reps,
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
         MAX(repetitions) as max_reps,
         MAX(weight) as max_weight,
         GROUP_CONCAT(weight) as all_weights,
         GROUP_CONCAT(repetitions) as all_reps,
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

export async function clearExerciseHistory(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM exercise_completion_audits;');
    await db.runAsync('DELETE FROM scheduled_routines;');
    await db.runAsync('DELETE FROM session_progress;');
  });
}

// ==========================================
// BACKUP EXPORT & IMPORT OPERATIONS
// ==========================================

export interface BackupOptions {
  exercises: boolean;
  groups: boolean;
  routines: boolean;
  history: boolean;
}

export interface BackupPayload {
  exercises?: any[];
  groups?: any[];
  routines?: any[];
  history?: {
    scheduled_routines?: any[];
    completion_audits?: any[];
  };
}

export async function exportBackupData(
  db: SQLiteDatabase,
  options: BackupOptions
): Promise<BackupPayload> {
  const payload: BackupPayload = {};

  if (options.exercises) {
    const exercises = await db.getAllAsync<any>('SELECT * FROM exercises ORDER BY id ASC');
    for (const ex of exercises) {
      const muscles = await db.getAllAsync<{ muscle_id: string; intensity: string }>(
        'SELECT muscle_id, intensity FROM exercise_muscles WHERE exercise_id = ?',
        [ex.id]
      );
      ex.muscles = muscles;
    }
    payload.exercises = exercises;
  }

  if (options.groups) {
    const groups = await db.getAllAsync<any>('SELECT * FROM exercise_groups ORDER BY id ASC');
    for (const gr of groups) {
      const groupExercises = await db.getAllAsync<{ exercise_id: number; order_index: number }>(
        'SELECT exercise_id, order_index FROM group_exercises WHERE group_id = ? ORDER BY order_index ASC',
        [gr.id]
      );
      gr.exercises = groupExercises;
    }
    payload.groups = groups;
  }

  if (options.routines) {
    const routines = await db.getAllAsync<any>('SELECT * FROM meta_groups ORDER BY id ASC');
    for (const rt of routines) {
      const groups = await db.getAllAsync<{ id: number; group_id: number; order_index: number }>(
        'SELECT id, group_id, order_index FROM meta_group_items WHERE meta_group_id = ? ORDER BY order_index ASC',
        [rt.id]
      );
      rt.groups = groups;
    }
    payload.routines = routines;
  }

  if (options.history) {
    const scheduled = await db.getAllAsync<any>('SELECT * FROM scheduled_routines ORDER BY id ASC');
    const audits = await db.getAllAsync<any>('SELECT * FROM exercise_completion_audits ORDER BY id ASC');
    payload.history = {
      scheduled_routines: scheduled,
      completion_audits: audits,
    };
  }

  return payload;
}

export async function importBackupData(
  db: SQLiteDatabase,
  payload: BackupPayload
): Promise<{ success: boolean; message: string }> {
  try {
    await db.withTransactionAsync(async () => {
      const exerciseIdMap: Record<number, number> = {};
      const groupIdMap: Record<number, number> = {};
      const routineIdMap: Record<number, number> = {};
      const metaGroupItemIdMap: Record<number, number> = {};
      const scheduledRoutineIdMap: Record<number, number> = {};

      // 1. Import Exercises
      if (payload.exercises && payload.exercises.length > 0) {
        for (const ex of payload.exercises) {
          const existing = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM exercises WHERE name = ?',
            [ex.name]
          );
          let exerciseId: number;
          if (existing) {
            exerciseId = existing.id;
          } else {
            const result = await db.runAsync(
              `INSERT INTO exercises (name, default_sets, default_reps, is_constant, series_config, video_url, initial_state, muscle_group, weight, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                ex.name,
                ex.default_sets ?? 3,
                ex.default_reps ?? 10,
                ex.is_constant ?? 1,
                ex.series_config ?? null,
                ex.video_url ?? null,
                ex.initial_state ?? null,
                ex.muscle_group ?? null,
                ex.weight ?? null,
                ex.created_at ?? new Date().toISOString()
              ]
            );
            exerciseId = result.lastInsertRowId;

            if (ex.muscles && ex.muscles.length > 0) {
              for (const m of ex.muscles) {
                await db.runAsync(
                  'INSERT OR IGNORE INTO exercise_muscles (exercise_id, muscle_id, intensity) VALUES (?, ?, ?)',
                  [exerciseId, m.muscle_id, m.intensity]
                );
              }
            }
          }
          exerciseIdMap[ex.id] = exerciseId;
        }
      }

      // 2. Import Groups
      if (payload.groups && payload.groups.length > 0) {
        for (const gr of payload.groups) {
          const existing = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM exercise_groups WHERE name = ?',
            [gr.name]
          );
          let groupId: number;
          if (existing) {
            groupId = existing.id;
          } else {
            const result = await db.runAsync(
              'INSERT INTO exercise_groups (name, created_at) VALUES (?, ?)',
              [gr.name, gr.created_at ?? new Date().toISOString()]
            );
            groupId = result.lastInsertRowId;
          }
          groupIdMap[gr.id] = groupId;

          if (gr.exercises && gr.exercises.length > 0) {
            for (const link of gr.exercises) {
              const mappedExId = exerciseIdMap[link.exercise_id];
              if (mappedExId) {
                await db.runAsync(
                  'INSERT OR REPLACE INTO group_exercises (group_id, exercise_id, order_index) VALUES (?, ?, ?)',
                  [groupId, mappedExId, link.order_index]
                );
              }
            }
          }
        }
      }

      // 3. Import Routines (MetaGroups)
      if (payload.routines && payload.routines.length > 0) {
        for (const rt of payload.routines) {
          const existing = await db.getFirstAsync<{ id: number }>(
            'SELECT id FROM meta_groups WHERE name = ?',
            [rt.name]
          );
          let routineId: number;
          if (existing) {
            routineId = existing.id;
          } else {
            const result = await db.runAsync(
              'INSERT INTO meta_groups (name, created_at) VALUES (?, ?)',
              [rt.name, rt.created_at ?? new Date().toISOString()]
            );
            routineId = result.lastInsertRowId;
          }
          routineIdMap[rt.id] = routineId;

          if (rt.groups && rt.groups.length > 0) {
            for (const item of rt.groups) {
              const mappedGroupId = groupIdMap[item.group_id];
              if (mappedGroupId) {
                const existingItem = await db.getFirstAsync<{ id: number }>(
                  'SELECT id FROM meta_group_items WHERE meta_group_id = ? AND group_id = ?',
                  [routineId, mappedGroupId]
                );
                let itemId: number;
                if (existingItem) {
                  itemId = existingItem.id;
                } else {
                  const resultItem = await db.runAsync(
                    'INSERT INTO meta_group_items (meta_group_id, group_id, order_index) VALUES (?, ?, ?)',
                    [routineId, mappedGroupId, item.order_index]
                  );
                  itemId = resultItem.lastInsertRowId;
                }
                metaGroupItemIdMap[item.id] = itemId;
              }
            }
          }
        }
      }

      // 4. Import History
      if (payload.history) {
        const { scheduled_routines, completion_audits } = payload.history;

        if (scheduled_routines && scheduled_routines.length > 0) {
          for (const sr of scheduled_routines) {
            const mappedMetaGroupId = routineIdMap[sr.meta_group_id];
            if (mappedMetaGroupId) {
              const existingSR = await db.getFirstAsync<{ id: number }>(
                'SELECT id FROM scheduled_routines WHERE meta_group_id = ? AND scheduled_date = ? AND is_completed = ?',
                [mappedMetaGroupId, sr.scheduled_date, sr.is_completed ?? 0]
              );
              let scheduledId: number;
              if (existingSR) {
                scheduledId = existingSR.id;
              } else {
                const result = await db.runAsync(
                  'INSERT INTO scheduled_routines (meta_group_id, scheduled_date, is_completed, created_at) VALUES (?, ?, ?, ?)',
                  [
                    mappedMetaGroupId,
                    sr.scheduled_date,
                    sr.is_completed ?? 0,
                    sr.created_at ?? new Date().toISOString()
                  ]
                );
                scheduledId = result.lastInsertRowId;
              }
              scheduledRoutineIdMap[sr.id] = scheduledId;
            }
          }
        }

        if (completion_audits && completion_audits.length > 0) {
          for (const audit of completion_audits) {
            const mappedExId = audit.exercise_id ? exerciseIdMap[audit.exercise_id] : null;
            const mappedRoutineId = audit.routine_id ? routineIdMap[audit.routine_id] : null;
            const mappedMetaGroupItemId = audit.meta_group_item_id ? metaGroupItemIdMap[audit.meta_group_item_id] : null;
            const mappedScheduledRoutineId = audit.scheduled_routine_id ? scheduledRoutineIdMap[audit.scheduled_routine_id] : null;

            // Evitar duplicados de auditoría
            const existingAudit = await db.getFirstAsync<{ id: number }>(
              `SELECT id FROM exercise_completion_audits 
               WHERE completed_date = ? AND exercise_name = ? AND set_index = ? AND routine_name = ? AND repetitions = ? AND (scheduled_routine_id = ? OR (scheduled_routine_id IS NULL AND ? IS NULL))`,
              [
                audit.completed_date,
                audit.exercise_name,
                audit.set_index,
                audit.routine_name,
                audit.repetitions,
                mappedScheduledRoutineId,
                mappedScheduledRoutineId
              ]
            );

            if (!existingAudit) {
              await db.runAsync(
                `INSERT INTO exercise_completion_audits 
                 (exercise_id, exercise_name, set_index, repetitions, weight, seconds_taken, routine_id, routine_name, completed_date, group_name, meta_group_item_id, scheduled_routine_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  mappedExId,
                  audit.exercise_name,
                  audit.set_index,
                  audit.repetitions,
                  audit.weight ?? null,
                  audit.seconds_taken ?? null,
                  mappedRoutineId,
                  audit.routine_name,
                  audit.completed_date,
                  audit.group_name ?? null,
                  mappedMetaGroupItemId,
                  mappedScheduledRoutineId,
                  audit.created_at ?? new Date().toISOString()
                ]
              );
            }
          }
        }
      }
    });

    return { success: true, message: 'Datos importados con éxito.' };
  } catch (error: any) {
    console.error('Error importing backup data:', error);
    return { success: false, message: `Error al importar: ${error?.message || error}` };
  }
}


