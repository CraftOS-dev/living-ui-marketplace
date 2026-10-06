/** Typed store hooks (types only from the store, so slices can use these without an import cycle). */
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { AppDispatch, RootState } from './store.ts';

export type { AppDispatch, RootState };
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
