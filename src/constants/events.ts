
// User Profile Events
export const USER_PROFILE_EVENTS = {
  UPDATED: 'profile-updated',
  SYNC_START: 'profile-sync-start',
  SYNC_END: 'profile-sync-end',
  ERROR: 'profile-error'
} as const;

// Weekly List Events (preparado para futuro)
export const WEEKLY_LIST_EVENTS = {
  UPDATED: 'weekly-list-updated',
  SYNC_START: 'weekly-list-sync-start',
  SYNC_END: 'weekly-list-sync-end',
  ERROR: 'weekly-list-error'
} as const;

// Favorites Events (preparado para futuro)
export const FAVORITES_EVENTS = {
  UPDATED: 'favorites-updated',
  SYNC_START: 'favorites-sync-start',
  SYNC_END: 'favorites-sync-end',
  ERROR: 'favorites-error'
} as const;

// Tipos para todos los eventos
export type UserProfileEvent = typeof USER_PROFILE_EVENTS[keyof typeof USER_PROFILE_EVENTS];
export type WeeklyListEvent = typeof WEEKLY_LIST_EVENTS[keyof typeof WEEKLY_LIST_EVENTS];
export type FavoritesEvent = typeof FAVORITES_EVENTS[keyof typeof FAVORITES_EVENTS];

// Tipo unión para todos los eventos del sistema
export type UserDataEvent = UserProfileEvent | WeeklyListEvent | FavoritesEvent;
