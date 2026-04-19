export interface Version {
  id: string;
  text: string;
  parentId: string | null;
  targetPct: number;
  included: boolean;
  annotation: string;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  versions: Version[];
  currentVid: string | null;
  calibChars: number;
  calibArea: number;
  annotation: string;
  fontSize: number;
}

export type FitMode = 'grow' | 'shrink';
export type PopoverKind = 'annotation' | 'versions' | null;
