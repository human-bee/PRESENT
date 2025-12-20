export function useFeatureFlags() {
  return {
    isLoaded: true,
    flags: {
      fairies: { enabled: true },
      fairies_purchase: { enabled: true },
    },
  };
}
