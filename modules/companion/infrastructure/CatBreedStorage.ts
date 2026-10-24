import { CatBreed, CAT_PALETTES } from '../domain/CatTypes';

const STORAGE_KEY_BREED = 'simply_logs_cat_breed';

export class CatBreedStorage {
  static getBreed(): CatBreed {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY_BREED) || localStorage.getItem('purrpulse_cat_breed')) as CatBreed;
      return Object.hasOwn(CAT_PALETTES, saved) ? saved : 'calico';
    } catch {
      return 'calico';
    }
  }

  static setBreed(breed: CatBreed): void {
    try {
      localStorage.setItem(STORAGE_KEY_BREED, breed);
      window.dispatchEvent(new Event('simply-logs:breed-change'));
    } catch {}
  }
}
