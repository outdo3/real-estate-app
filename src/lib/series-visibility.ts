// PRODUCTION QA P0-C — pure toggle logic for the 매매/전세 chart series display
// control, extracted only so the "at least one series stays visible" policy is
// unit-testable without a component-test framework.

export interface SeriesVisibility {
  sale: boolean;
  rent: boolean;
}

// Toggles the given series, but refuses to turn off the last remaining visible
// series (returns the input unchanged in that case) — matches the project's
// "최소 하나는 항상 ON" policy for this control.
export function toggleSeriesVisibility(current: SeriesVisibility, key: 'sale' | 'rent'): SeriesVisibility {
  const next = { ...current, [key]: !current[key] };
  return next.sale || next.rent ? next : current;
}
