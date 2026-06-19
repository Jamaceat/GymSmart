export interface MuscleInfo {
  id: string;
  name: string;
}

export interface MuscleZone {
  zone: string;
  muscles: MuscleInfo[];
}

export type MuscleIntensity = 'primary' | 'secondary' | 'stabilizer';

export const MUSCLE_ZONES: MuscleZone[] = [
  {
    zone: 'Pecho',
    muscles: [
      { id: 'pectoral_superior', name: 'Pectoral Superior' },
      { id: 'pectoral_inferior', name: 'Pectoral Inferior' },
    ],
  },
  {
    zone: 'Espalda',
    muscles: [
      { id: 'dorsales', name: 'Dorsal Ancho (Lats)' },
      { id: 'trapecio_superior', name: 'Trapecio Superior' },
      { id: 'trapecio_medio_inferior', name: 'Trapecio Medio/Inferior' },
      { id: 'lumbares', name: 'Lumbar' },
    ],
  },
  {
    zone: 'Hombros',
    muscles: [
      { id: 'deltoides_anterior', name: 'Deltoides Anterior' },
      { id: 'deltoides_lateral', name: 'Deltoides Lateral' },
      { id: 'deltoides_posterior', name: 'Deltoides Posterior' },
    ],
  },
  {
    zone: 'Brazos',
    muscles: [
      { id: 'biceps', name: 'Bíceps' },
      { id: 'triceps', name: 'Tríceps' },
      { id: 'antebrazos', name: 'Antebrazos' },
    ],
  },
  {
    zone: 'Piernas',
    muscles: [
      { id: 'cuadriceps', name: 'Cuádriceps' },
      { id: 'isquiotibiales', name: 'Femorales / Isquiotibiales' },
      { id: 'gluteo_mayor', name: 'Glúteo Mayor' },
      { id: 'gluteo_medio', name: 'Glúteo Medio' },
      { id: 'pantorrillas', name: 'Pantorrillas' },
      { id: 'aductores', name: 'Aductores' },
    ],
  },
  {
    zone: 'Core',
    muscles: [
      { id: 'abdomen', name: 'Abdomen (Abs)' },
      { id: 'oblicuos', name: 'Oblicuos' },
    ],
  },
];

// Helper to get a flat list of all muscles
export const ALL_MUSCLES: MuscleInfo[] = MUSCLE_ZONES.reduce<MuscleInfo[]>(
  (acc, zone) => [...acc, ...zone.muscles],
  []
);

// Helper to find a muscle by ID
export function getMuscleName(id: string): string {
  const muscle = ALL_MUSCLES.find((m) => m.id === id);
  return muscle ? muscle.name : id;
}
