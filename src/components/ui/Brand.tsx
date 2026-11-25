'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { UtensilsCrossed } from 'lucide-react';

/**
 * Public brand settings (restaurant name + logo). Fetched once from
 * /api/settings (public, cached server-side) and reused across every portal
 * header so the brand is dynamic and editable from the admin Settings tab.
 */
export interface BrandSettings {
  restaurantName: string;
  logoUrl: string | null;
}

const FALLBACK: BrandSettings = { restaurantName: 'Lipi Snacks', logoUrl: null };

/**
 * Hook: load brand settings once on mount. Returns the cached fallback
 * synchronously on first render (so headers don't flash empty) and the real
 * value as soon as the fetch resolves.
 */
export function useBrand(): BrandSettings {
  const [brand, setBrand] = useState<BrandSettings>(FALLBACK);
  useEffect(() => {
    let active = true;
    api<BrandSettings>('/api/settings').then(({ data, ok }) => {
      if (active && ok && data) {
        setBrand({ restaurantName: data.restaurantName || 'Lipi Snacks', logoUrl: data.logoUrl || null });
      }
    });
    return () => { active = false; };
  }, []);
  return brand;
}

interface BrandProps {
  /** Tailwind size class for the logo / icon, e.g. "w-6 h-6". */
  iconSize?: string;
  /** Extra classes for the name text (e.g. text color). */
  nameClassName?: string;
  /** When true the brand is shown on a colored header — logo gets a white ring. */
  onColor?: boolean;
  /** Explicit brand override (skip the fetch); used by server components that
   *  already loaded settings via getSettings(). */
  brand?: BrandSettings;
}

/**
 * Inline brand mark: logo image if set, otherwise a utensils icon. Pairs with
 * the restaurant name. Drop into any header.
 */
export default function Brand({ iconSize = 'w-6 h-6', nameClassName = '', onColor = false, brand }: BrandProps) {
  const b = brand ?? useBrand();
  return (
    <>
      {b.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={b.logoUrl}
          alt={`${b.restaurantName} logo`}
          className={`${iconSize} rounded-md object-contain ${onColor ? 'bg-white/95 p-0.5 ring-1 ring-white/40' : ''}`}
        />
      ) : (
        <UtensilsCrossed className={iconSize} />
      )}
      <span className={`font-semibold ${nameClassName}`}>{b.restaurantName}</span>
    </>
  );
}
