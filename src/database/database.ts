import { SQLiteDatabase } from 'expo-sqlite';

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
  created_at?: string;
}

export interface ExerciseGroup {
  id?: number;
  name: string;
  created_at?: string;
  exercises?: Exercise[];
}

export interface MetaGroup {
  id?: number;
  name: string;
  created_at?: string;
  groups?: ExerciseGroup[];
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
          meta_group_id INTEGER,
          group_id INTEGER,
          order_index INTEGER NOT NULL,
          PRIMARY KEY (meta_group_id, group_id),
          FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scheduled_routines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          meta_group_id INTEGER NOT NULL,
          scheduled_date TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE
      );
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
        { name: 'created_at', type: 'DATETIME DEFAULT CURRENT_TIMESTAMP' },
      ];
      for (const col of expectedColumns) {
        if (!columnNames.includes(col.name)) {
          await db.execAsync(`ALTER TABLE exercises ADD COLUMN ${col.name} ${col.type};`);
        }
      }
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
  return await db.getAllAsync<Exercise>('SELECT * FROM exercises ORDER BY name ASC');
}

export async function getExerciseById(db: SQLiteDatabase, id: number): Promise<Exercise | null> {
  return await db.getFirstAsync<Exercise>('SELECT * FROM exercises WHERE id = ?', [id]);
}

export async function insertExercise(
  db: SQLiteDatabase,
  exercise: Omit<Exercise, 'id' | 'created_at'>
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO exercises (name, default_sets, default_reps, is_constant, series_config, video_url, initial_state) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      exercise.name,
      exercise.default_sets,
      exercise.default_reps,
      exercise.is_constant,
      exercise.series_config,
      exercise.video_url,
      exercise.initial_state,
    ]
  );
  return result.lastInsertRowId;
}

export async function updateExercise(
  db: SQLiteDatabase,
  id: number,
  exercise: Partial<Omit<Exercise, 'id' | 'created_at'>>
): Promise<void> {
  await db.runAsync(
    `UPDATE exercises SET 
      name = COALESCE(?, name),
      default_sets = COALESCE(?, default_sets),
      default_reps = COALESCE(?, default_reps),
      is_constant = COALESCE(?, is_constant),
      series_config = COALESCE(?, series_config),
      video_url = COALESCE(?, video_url),
      initial_state = COALESCE(?, initial_state)
     WHERE id = ?`,
    [
      exercise.name ?? null,
      exercise.default_sets ?? null,
      exercise.default_reps ?? null,
      exercise.is_constant ?? null,
      exercise.series_config ?? null,
      exercise.video_url ?? null,
      exercise.initial_state ?? null,
      id,
    ]
  );
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
    `SELECT eg.* FROM exercise_groups eg 
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
    'INSERT OR REPLACE INTO meta_group_items (meta_group_id, group_id, order_index) VALUES (?, ?, ?)',
    [metaGroupId, groupId, orderIndex]
  );
}

export async function removeGroupFromMetaGroup(
  db: SQLiteDatabase,
  metaGroupId: number,
  groupId: number
): Promise<void> {
  await db.runAsync('DELETE FROM meta_group_items WHERE meta_group_id = ? AND group_id = ?', [metaGroupId, groupId]);
}

export async function updateMetaGroupItemsOrder(db: SQLiteDatabase, metaGroupId: number, groupIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM meta_group_items WHERE meta_group_id = ?', [metaGroupId]);
    for (let i = 0; i < groupIds.length; i++) {
      await db.runAsync(
        'INSERT INTO meta_group_items (meta_group_id, group_id, order_index) VALUES (?, ?, ?)',
        [metaGroupId, groupIds[i], i]
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

export async function deleteScheduledRoutine(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM scheduled_routines WHERE id = ?', [id]);
}
