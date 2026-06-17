# Plan de Desarrollo - GymSmart

Este documento define el plan de requerimientos, diseño de base de datos y arquitectura para el **Módulo de Set de Ejercicios** en GymSmart.

---

## 1. Requerimientos del Módulo de Set de Ejercicios

### 1.1 Gestión de Tipos de Ejercicios (Ejercicios Sueltos)
* **Creación y Configuración:**
  * Nombre del ejercicio (ej. Flexiones, Sentadillas).
  * Configuración predeterminada de **Series** (sets) y **Repeticiones** (reps).
  * **Configuración de Series (Subsets de Series):**
    * **Series Constantes:** Todas las series tienen el mismo número de repeticiones y peso/esfuerzo inicial.
    * **Series Variables (Subsets):** Permite configurar cada serie de forma independiente por si hubo una descarga (disminución) o aumento de carga/repeticiones en su punto de partida (ej. Serie 1: 12 reps, Serie 2: 10 reps, Serie 3: 8 reps). Esto define la estructura del **estado de referencia inicial** (cómo comenzó el usuario) para tener constancia a lo largo del tiempo. Se podrá modificar si el usuario necesita ajustar el registro de su primera vez, pero servirá como línea base estática del histórico.
  * **Redirección a Video Explicativo:**
    * Un enlace (URL) asociado al ejercicio para ver la técnica.
    * **Lógica de Redirección inteligente:**
      * **YouTube:** Detecta URLs de YouTube (`youtube.com`, `youtu.be`) e intenta abrir la aplicación nativa de YouTube (`vnd.youtube://` en Android/iOS) con fallback al navegador.
      * **TikTok:** Detecta URLs de TikTok (`tiktok.com`) e intenta abrir la aplicación nativa de TikTok (`snssdk1128://` o `tiktok://`) con fallback al navegador.
      * **Instagram:** Detecta URLs de Instagram (`instagram.com`) e intenta abrir la aplicación nativa de Instagram (`instagram://`) con fallback al navegador.
      * **Web/Otros:** Abre el enlace directamente en el navegador por defecto del dispositivo.
  * **Estado de Referencia Inicial Histórico:**
    * Registro de cuánto peso/repeticiones realizaba el usuario cuando comenzó a hacer este ejercicio (o lo que espera lograr si nunca lo ha hecho). Funciona como una línea base fija a largo plazo para evaluar el progreso comparativo. El usuario podrá editar este punto de partida si requiere corregir su récord inicial (por ejemplo, si recuerda mal cuánto levantó la primera vez), pero el comportamiento por defecto es mantenerlo estático como referencia del "día uno".

### 1.2 Jerarquía y Organización del Módulo
La aplicación organizará la información en tres niveles independientes pero vinculados:
1. **Nivel 1: Ejercicios Sueltos (Standalone):** Catálogo general de ejercicios con su configuración inicial y estado.
2. **Nivel 2: Grupos de Ejercicios (Submódulo de Grupos):** Agrupación personalizada de ejercicios sueltos por categorías elegidas por el usuario (ej. "Pecho", "Piernas", "Tirón").
3. **Nivel 3: Grupos de Grupos (Submódulo Meta-Grupos / Rutinas):** Agrupaciones de mayor nivel que organizan múltiples grupos (ej. "Rutina A" que contiene "Pecho" y "Tríceps", o "Día de Empuje" que contiene "Pecho", "Hombros" y "Tríceps").

---

## 2. Adaptabilidad Móvil y Ajuste de Pantalla (Safe Area Bottom Inset)

* ~~**Problema:** En dispositivos móviles modernos (especialmente iPhones con "notch" e indicador de inicio, y Androids con navegación por gestos o barra de navegación por software), la interfaz inferior de la aplicación se superponía con los elementos del sistema o quedaba cortada.~~
* ~~**Solución:** Se ajustó la configuración del componente `SafeAreaView` en `src/app/index.tsx` agregando el borde inferior:~~
  ```tsx
  <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
  ```
* ~~**Impacto:** Al habilitar el borde `bottom`, el layout detecta dinámicamente la altura de la barra del sistema del teléfono y añade un margen inferior automático. Los botones de acción siempre quedan perfectamente visibles y legibles por encima de los controles táctiles nativos del teléfono.~~ (Implementado)

---

## 3. Estrategia de Persistencia y Optimización

Para cumplir con el requerimiento de una persistencia **rápida de leer, con uso óptimo de espacio y que no se acumule excesivamente**, se evalúan las siguientes opciones:

| Criterio | SQLite (`expo-sqlite`) | MMKV (`react-native-mmkv`) | AsyncStorage |
| :--- | :--- | :--- | :--- |
| **Tipo de datos** | Relacional (Tablas) | Clave-Valor | Clave-Valor (Lento) |
| **Velocidad de Lectura** | Muy rápida (C nativo) | Extremadamente rápida (C++ nativo) | Media-Lenta (JSON serializado) |
| **Relaciones (Joins)** | **Excelente (Nativo)** | Complejo (Requiere lógica en JS) | Muy complejo (No indexado) |
| **Espacio en Disco** | **Mínimo** (Formato binario compacto) | Bajo (JSON en memoria mapeada) | Alto (Archivos JSON por clave) |
| **Integridad Referencial** | **Sí** (ON DELETE CASCADE) | No (Se debe hacer manual) | No (Se debe hacer manual) |

### Decisión Técnica: SQLite (`expo-sqlite` en Expo SDK 56)
* **¿Por qué?** La jerarquía de 3 niveles (Ejercicios -> Grupos -> Meta-Grupos) es inherentemente relacional. SQLite permite estructurar esto de forma natural con claves foráneas, asegurando consistencia de datos y borrados en cascada óptimos. Además, el consumo de almacenamiento es extremadamente bajo al no duplicar datos y procesarse directamente en el motor SQLite nativo en C.

#### Esquema de Base de Datos Propuesto
```sql
CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    default_sets INTEGER NOT NULL DEFAULT 3,
    default_reps INTEGER NOT NULL DEFAULT 10,
    is_constant INTEGER NOT NULL DEFAULT 1, -- 1 = Series constantes, 0 = Series variables (subsets)
    series_config TEXT, -- Guardado como JSON compacto de subsets: ej. '[{"set": 1, "reps": 12}, {"set": 2, "reps": 10}]'
    video_url TEXT,
    initial_state TEXT, -- Guardado como string o JSON compacto (ej: '{"weight": 20, "reps": 10, "notes": "iniciando"}')
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Grupos (ej: Pecho, Piernas)
CREATE TABLE IF NOT EXISTS exercise_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Relación Grupo-Ejercicio (Muchos a Muchos con orden indexado)
CREATE TABLE IF NOT EXISTS group_exercises (
    group_id INTEGER,
    exercise_id INTEGER,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (group_id, exercise_id),
    FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
);

-- Tabla de Meta-Grupos (ej: Rutina A, Día de Empuje)
CREATE TABLE IF NOT EXISTS meta_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Relación MetaGrupo-Grupo (Muchos a Muchos con orden indexado)
CREATE TABLE IF NOT EXISTS meta_group_items (
    meta_group_id INTEGER,
    group_id INTEGER,
    order_index INTEGER NOT NULL,
    PRIMARY KEY (meta_group_id, group_id),
    FOREIGN KEY (meta_group_id) REFERENCES meta_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES exercise_groups(id) ON DELETE CASCADE
);
```

---

## 4. Plan de Implementación de Interfaces y Componentes

### 3.1 Vistas y Rutas (Expo Router)
* `/src/app/index.tsx`: Dashboard principal que muestra accesos rápidos a Ejercicios Sueltos, Grupos y Meta-Grupos.
* `/src/app/exercises/index.tsx`: Listado de Ejercicios Sueltos + Botón para agregar.
* `/src/app/exercises/create.tsx`: Formulario de creación de ejercicio (Series, Repes, Progresión, URL de video, Estado inicial).
* `/src/app/groups/index.tsx`: Listado de Grupos + Creación de Grupos + Asociación de ejercicios.
* `/src/app/meta-groups/index.tsx`: Listado de Meta-grupos + Creación de Meta-grupos + Asociación de grupos.

### 3.2 Redirección de Enlaces (Deep Linking)
Implementaremos una función utilitaria en `src/utils/linking.ts` que determine la URL de destino adecuada:
```typescript
import { Linking, Platform } from 'react-native';

export async function openExerciseVideo(url: string) {
  if (!url) return;
  
  try {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      // Extraer ID de video e intentar deep link
      const videoId = extractYoutubeId(url);
      const deepLink = Platform.select({
        ios: `youtube://www.youtube.com/watch?v=${videoId}`,
        android: `vnd.youtube:${videoId}`,
        default: url
      });
      const canOpen = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(deepLink);
        return;
      }
    } else if (url.includes('tiktok.com')) {
      // Intentar deep link de TikTok
      const deepLink = `tiktok://`;
      const canOpen = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    } else if (url.includes('instagram.com')) {
      // Intentar deep link de Instagram
      const deepLink = `instagram://`;
      const canOpen = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    }
    
    // Fallback para cualquier sitio web
    await Linking.openURL(url);
  } catch (error) {
    console.error('Error al abrir la URL:', error);
    // Fallback definitivo
    await Linking.openURL(url);
  }
}
```

---

## 5. Siguientes Pasos
1. ~~Aprobación de este plan por parte del usuario.~~ (Aprobado)
2. ~~Ajustar adaptabilidad móvil en `src/app/index.tsx`.~~ (Implementado)
3. ~~Configurar `expo-sqlite` y la capa de base de datos (`database.ts`).~~ (Implementado)
4. ~~Crear las migraciones e inicialización del esquema.~~ (Implementado)
5. ~~Crear la UI del Módulo de Ejercicios Sueltos.~~ (Implementado)
6. ~~Crear la UI del Módulo de Grupos de Ejercicios.~~ (Implementado)
7. ~~Crear la UI del Módulo de Meta-Grupos.~~ (Implementado)
