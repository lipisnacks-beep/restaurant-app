'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';
import { setCurrencySymbol } from '@/lib/utils';
import { UtensilsCrossed } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type BrandSettings,
  type RestaurantSettings,
} from '@/lib/settings.types';

// Re-export the shared types so existing imports (`from '@/components/ui/Brand'`)
// keep working without a second source of truth.
export type { BrandSettings, RestaurantSettings };

const FALLBACK_SETTINGS: RestaurantSettings = {
  ...DEFAULT_SETTINGS,
  hours: { ...DEFAULT_SETTINGS.hours },
};

/**
 * Hook: load the FULL restaurant settings once on mount. Returns the cached
 * defaults synchronously on first render (so headers don't flash empty) and
 * the real value as soon as the fetch resolves.
 *
 * As a side effect, it also pushes the admin-configured `currencySymbol` into
 * the shared `formatCurrency()` runtime via `setCurrencySymbol()`. Because this
 * hook runs inside <Brand>, which is rendered by every portal shell (admin /
 * staff / chef), a single fetch here makes every `formatCurrency()` call across
 * the whole portal use the dynamic symbol — no need to thread the symbol
 * through each component's props.
 */
export function useSettings(): RestaurantSettings {
  const [settings, setSettings] = useState<RestaurantSettings>(FALLBACK_SETTINGS);
  useEffect(() => {
    let active = true;
    api<RestaurantSettings>('/api/settings').then(({ data, ok }) => {
      if (active && ok && data) {
        setSettings(data);
        setCurrencySymbol(data.currencySymbol);
      }
    });
    return () => { active = false; };
  }, []);
  return settings;
}

/**
 * Hook: load only the brand (name + logo) — a thin wrapper around useSettings
 * for components that render just the brand mark.
 */
export function useBrand(): BrandSettings {
  const s = useSettings();
  return { restaurantName: s.restaurantName, logoUrl: s.logoUrl };
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
