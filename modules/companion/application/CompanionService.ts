import { CatMood, CatBreed } from '../domain/CatTypes';
import { CatBreedStorage } from '../infrastructure/CatBreedStorage';
import { soundEffects } from '../infrastructure/AudioSynthesizer';

export class CompanionService {
  private static instance: CompanionService;

  private constructor() {}

  public static getInstance(): CompanionService {
    if (!CompanionService.instance) {
      CompanionService.instance = new CompanionService();
    }
    return CompanionService.instance;
  }

  public getBreed(): CatBreed {
    return CatBreedStorage.getBreed();
  }

  public setBreed(breed: CatBreed): void {
    CatBreedStorage.setBreed(breed);
  }

  public calculateMood(
    isStreaming: boolean,
    logsPerSec: number,
    recentHasError: boolean,
    happyUntil: number
  ): CatMood {
    const now = Date.now();
    if (now < happyUntil) return 'happy';
    if (recentHasError) return 'alert';
    if (!isStreaming) return 'idle';
    if (logsPerSec > 3) return 'typing';
    return 'watching';
  }

  public pet(soundEnabled = true): number {
    if (soundEnabled) soundEffects.playPurr();
    return Date.now() + 4000;
  }

}

export const companionService = CompanionService.getInstance();
