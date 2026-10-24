import React, { useState } from 'react';
import { PixelCat } from './PixelCat';
import { CatBreed, CatMood, BreedDefinition } from '../domain/CatTypes';
import { CatBreedStorage } from '../infrastructure/CatBreedStorage';
import { X, Sparkles, Check } from 'lucide-react';
import { useDialog } from '../../desktop/application/useDialog';

interface CatCustomizerModalProps {
  isOpen: boolean;
  currentBreed: CatBreed;
  onSelectBreed: (breed: CatBreed) => void;
  onClose: () => void;
  onPet: () => void;
}

export const CatCustomizerModal: React.FC<CatCustomizerModalProps> = ({
  isOpen,
  currentBreed,
  onSelectBreed,
  onClose,
  onPet
}) => {
  const [testMood, setTestMood] = useState<CatMood>('watching');
  useDialog(isOpen, onClose);

  if (!isOpen) return null;

  const breeds: BreedDefinition[] = [
    { id: 'calico', name: 'Calico (Mochi)', desc: 'Classic tri-color lucky guardian cat', coat: 'Orange, white & charcoal patches' },
    { id: 'orange', name: 'Ginger Tabby (Garfield)', desc: 'Warm ginger fluff, loves cozy edge servers', coat: 'Golden orange with cream stripes' },
    { id: 'tuxedo', name: 'Tuxedo (Sylvester)', desc: 'Formal wear for production deployments', coat: 'Jet black with pure white chest & paws' },
    { id: 'black', name: 'Void Cat (Kuro)', desc: 'Stealth black cat with glowing lime eyes', coat: 'Pure midnight black & lime glow' },
    { id: 'cyber', name: 'Cyber Hacker (Byte)', desc: 'Neon synthwave cyber-cat with matrix paws', coat: 'Electric cyan, hot pink & purple' }
  ];

  const handleBreedClick = (b: CatBreed) => {
    onSelectBreed(b);
    CatBreedStorage.setBreed(b);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Customize your cat" tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            Infrastructure Cat Companion
          </h3>
          <button
            aria-label="Close cat settings"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Playground Preview */}
          <div className="p-6 rounded-2xl bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60 flex flex-col items-center justify-center text-center">
            <PixelCat mood={testMood} breed={currentBreed} size="lg" onPet={onPet} />
            <div className="mt-3">
              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 block">
                Click cat to pet & show love!
              </span>
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                Current Breed: <strong className="text-indigo-600 dark:text-indigo-400 capitalize">{currentBreed}</strong> • Reacts dynamically to infrastructure logs
              </span>
            </div>

            <div className="flex gap-1.5 mt-3">
              {(['idle', 'watching', 'alert', 'typing'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setTestMood(m)}
                  className={`text-[10px] px-2.5 py-1 rounded-md capitalize font-mono transition-all ${
                    testMood === m
                      ? 'bg-indigo-600 text-white font-bold shadow-xs'
                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300 dark:hover:bg-neutral-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Breed Selection */}
          <div>
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 block mb-2">
              Select Pixel Art Cat Companion (5 Breeds)
            </label>
            <div className="space-y-2">
              {breeds.map(b => {
                const isSelected = currentBreed === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => handleBreedClick(b.id)}
                    className={`w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-neutral-900 dark:text-neutral-100 ring-2 ring-indigo-500/20 shadow-xs'
                        : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-white/40 dark:bg-neutral-800/40 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-neutral-200/50 dark:bg-neutral-800 flex items-center justify-center shrink-0 border border-neutral-300/40 dark:border-neutral-700/40">
                        <PixelCat breed={b.id} mood="idle" size="sm" className="pointer-events-none" />
                      </div>

                      <div>
                        <div className="font-bold text-xs flex items-center gap-1.5">
                          <span>{b.name}</span>
                          {isSelected && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500 text-white font-bold font-mono">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                          {b.desc}
                        </div>
                        <div className="text-[9px] text-neutral-400 dark:text-neutral-500 font-mono">
                          {b.coat}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 ml-2">
                      {isSelected ? (
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border border-neutral-300 dark:border-neutral-700 hover:border-indigo-400" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-sm transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
