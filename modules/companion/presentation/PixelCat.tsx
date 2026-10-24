import React, { useState, useEffect, useRef } from 'react';
import { CatMood, CatBreed, CAT_PALETTES } from '../domain/CatTypes';
import { CatBreedStorage } from '../infrastructure/CatBreedStorage';

export type { CatMood, CatBreed } from '../domain/CatTypes';

export interface PixelCatProps {
  mood?: CatMood;
  breed?: CatBreed;
  size?: 'sm' | 'md' | 'lg';
  showSpeechBubble?: boolean;
  statusText?: string;
  onPet?: () => void;
  className?: string;
}

export const PixelCat: React.FC<PixelCatProps> = ({
  mood = 'idle',
  breed: breedProp,
  size = 'md',
  showSpeechBubble = false,
  statusText,
  onPet,
  className = ''
}) => {
  const [blink, setBlink] = useState(false);
  const [pawFrame, setPawFrame] = useState(0);
  const [hearts, setHearts] = useState<{ id: number; x: number }[]>([]);
  const [localBreed, setLocalBreed] = useState<CatBreed>(() => CatBreedStorage.getBreed());
  const timeouts = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timeouts.current.delete(timer); callback(); }, delay);
    timeouts.current.add(timer);
  };
  useEffect(() => () => { timeouts.current.forEach(clearTimeout); }, []);

  const breed = breedProp || localBreed;

  useEffect(() => {
    const handleBreedChange = () => {
      setLocalBreed(CatBreedStorage.getBreed());
    };

    window.addEventListener('simply-logs:breed-change', handleBreedChange);
    return () => window.removeEventListener('simply-logs:breed-change', handleBreedChange);
  }, []);

  useEffect(() => {
    const blinkInterval = setInterval(() => {
      setBlink(true);
      later(() => setBlink(false), 160);
    }, 3800 + Math.random() * 2000);

    return () => clearInterval(blinkInterval);
  }, []);

  useEffect(() => {
    if (mood === 'typing' || mood === 'watching') {
      const pawTimer = setInterval(() => {
        setPawFrame(prev => (prev === 0 ? 1 : 0));
      }, 260);
      return () => clearInterval(pawTimer);
    }
  }, [mood]);

  const handleCatClick = () => {
    const newHeart = { id: Date.now(), x: Math.random() * 20 - 10 };
    setHearts(prev => [...prev.slice(-4), newHeart]);
    later(() => {
      setHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 1200);

    if (onPet) onPet();
  };

  const p = CAT_PALETTES[breed] || CAT_PALETTES.calico;
  const scale = size === 'sm' ? 24 : size === 'lg' ? 64 : 40;

  return (
    <div role={onPet ? 'button' : undefined} tabIndex={onPet ? 0 : undefined} aria-label={onPet ? 'Pet your cat' : undefined}
      onKeyDown={event => { if (onPet && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); handleCatClick(); } }}
      className={`relative inline-flex flex-col items-center select-none group cursor-pointer ${className}`} onClick={handleCatClick}>
      {/* Floating Hearts */}
      <>
        {hearts.map(h => (
          <span
            key={h.id}
            style={{ left: h.x }}
            className="cat-heart absolute -top-3 text-rose-500 font-bold text-xs pointer-events-none z-30"
          >
            ❤️
          </span>
        ))}
      </>

      {/* Alert Bubble */}
      {(showSpeechBubble || mood === 'alert') && (
        <div
          className={`absolute -top-7 whitespace-nowrap text-[10px] font-mono px-2 py-0.5 rounded shadow-lg pointer-events-none z-20 flex items-center gap-1 ${
            mood === 'alert'
              ? 'bg-rose-500 text-white font-bold animate-pulse'
              : 'bg-neutral-800 text-neutral-200 border border-neutral-700'
          }`}
        >
          {mood === 'alert' ? (
            <>
              <span className="text-yellow-300">⚠️</span> {statusText || 'Error in infra!'}
            </>
          ) : (
            statusText || (mood === 'watching' ? 'watching logs...' : 'purr...')
          )}
        </div>
      )}

      {/* Pixel Cat SVG */}
      <div className={`relative ${mood === 'alert' ? 'animate-bounce' : ''}`}>
        <svg
          width={scale}
          height={scale}
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="pixelated drop-shadow-sm transition-transform duration-150 group-hover:scale-105"
          style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}
        >
          <rect x="3" y="2" width="2" height="2" fill={p.outline} />
          <rect x="11" y="2" width="2" height="2" fill={p.outline} />
          <rect x="2" y="4" width="12" height="9" fill={p.outline} />
          <rect x="3" y="13" width="10" height="2" fill={p.outline} />

          <rect x="3" y="3" width="2" height="2" fill={p.ears} />
          <rect x="11" y="3" width="2" height="2" fill={p.ears} />

          <rect x="3" y="4" width="10" height="8" fill={p.primary} />
          <rect x="4" y="12" width="8" height="2" fill={p.primary} />

          <rect x="4" y="4" width="3" height="3" fill={p.patch} />
          <rect x="6" y="8" width="4" height="5" fill={p.secondary} />
          <rect x="7" y="6" width="2" height="3" fill={p.secondary} />

          {blink ? (
            <>
              <rect x="4" y="7" width="2" height="1" fill={p.outline} />
              <rect x="10" y="7" width="2" height="1" fill={p.outline} />
            </>
          ) : mood === 'alert' ? (
            <>
              <rect x="4" y="5" width="3" height="3" fill="#ffffff" />
              <rect x="9" y="5" width="3" height="3" fill="#ffffff" />
              <rect x="5" y="6" width="2" height="2" fill="#ef4444" />
              <rect x="9" y="6" width="2" height="2" fill="#ef4444" />
            </>
          ) : (
            <>
              <rect x="4" y="6" width="2" height="2" fill={p.eyes} />
              <rect x="10" y="6" width="2" height="2" fill={p.eyes} />
              <rect x="4" y="6" width="1" height="1" fill="#ffffff" />
              <rect x="10" y="6" width="1" height="1" fill="#ffffff" />
            </>
          )}

          <rect x="7" y="8" width="2" height="1" fill={p.nose} />

          <rect x="1" y="7" width="2" height="1" fill={p.outline} opacity="0.6" />
          <rect x="13" y="7" width="2" height="1" fill={p.outline} opacity="0.6" />
          <rect x="1" y="9" width="2" height="1" fill={p.outline} opacity="0.6" />
          <rect x="13" y="9" width="2" height="1" fill={p.outline} opacity="0.6" />

          {mood === 'alert' ? (
            <>
              <rect x="13" y="10" width="2" height="2" fill={p.outline} />
              <rect x="14" y="7" width="2" height="3" fill={p.primary} />
            </>
          ) : (
            <g className="animate-pixel-tail">
              <rect x="13" y="11" width="2" height="1" fill={p.primary} />
              <rect x="14" y="9" width="1" height="3" fill={p.patch} />
            </g>
          )}

          {mood === 'typing' || mood === 'watching' ? (
            <>
              <rect x="4" y="14" width="8" height="1" fill="#475569" />
              <rect x="5" y="13" width="1" height="1" fill="#94a3b8" />
              <rect x="7" y="13" width="1" height="1" fill="#94a3b8" />
              <rect x="9" y="13" width="1" height="1" fill="#94a3b8" />
              <rect x={pawFrame === 0 ? 4 : 5} y={pawFrame === 0 ? 12 : 11} width="2" height="2" fill={p.secondary} />
              <rect x={pawFrame === 0 ? 9 : 10} y={pawFrame === 0 ? 11 : 12} width="2" height="2" fill={p.secondary} />
            </>
          ) : (
            <>
              <rect x="4" y="13" width="2" height="2" fill={p.secondary} />
              <rect x="10" y="13" width="2" height="2" fill={p.secondary} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
};
