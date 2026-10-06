/**
 * NetSentry's store (v4 §17): Redux Toolkit, the way CraftBot's own frontend does it — server data is
 * cached in the store and refreshed by the server's own push (PocketBase realtime), so changing pages or
 * tabs shows what you saw at once instead of loading again.
 *   collections — records, by collection + filter (store/collections.ts)
 *   resources   — operation answers and server reads, by what was asked (store/resources.ts)
 */
import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { collectionsReducer } from './collections.ts';
import { resourcesReducer } from './resources.ts';

const rootReducer = combineReducers({ collections: collectionsReducer, resources: resourcesReducer });

export const store = configureStore({
  reducer: rootReducer,
  // Records and answers are plain JSON from the server; the dev-only checks would walk them on every action.
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
