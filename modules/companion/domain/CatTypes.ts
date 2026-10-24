export type CatMood = 'idle' | 'watching' | 'alert' | 'typing' | 'happy';
export type CatBreed = 'tuxedo' | 'orange' | 'calico' | 'black' | 'cyber';

export interface BreedDefinition {
  id: CatBreed;
  name: string;
  desc: string;
  coat: string;
}

export interface CatColorPalette {
  primary: string;
  secondary: string;
  patch: string;
  eyes: string;
  ears: string;
  nose: string;
  outline: string;
}

export const CAT_PALETTES: Record<CatBreed, CatColorPalette> = {
  calico: {
    primary: '#f97316',
    secondary: '#ffffff',
    patch: '#292524',
    eyes: '#10b981',
    ears: '#fda4af',
    nose: '#fb7185',
    outline: '#1c1917'
  },
  orange: {
    primary: '#f97316',
    secondary: '#fed7aa',
    patch: '#ea580c',
    eyes: '#22c55e',
    ears: '#fbcfe8',
    nose: '#f43f5e',
    outline: '#431407'
  },
  tuxedo: {
    primary: '#18181b',
    secondary: '#fafafa',
    patch: '#27272a',
    eyes: '#eab308',
    ears: '#fda4af',
    nose: '#f472b6',
    outline: '#09090b'
  },
  black: {
    primary: '#171717',
    secondary: '#262626',
    patch: '#171717',
    eyes: '#a3e635',
    ears: '#fb7185',
    nose: '#fb7185',
    outline: '#0a0a0a'
  },
  cyber: {
    primary: '#06b6d4',
    secondary: '#818cf8',
    patch: '#3b82f6',
    eyes: '#ec4899',
    ears: '#f43f5e',
    nose: '#a855f7',
    outline: '#0f172a'
  }
};
