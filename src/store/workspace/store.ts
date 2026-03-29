import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import type { StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { type WorkspaceAction, createWorkspaceSlice } from './action';
import { type WorkspaceState, initialWorkspaceState } from './initialState';

//  ===============  Aggregate Store ============ //

export type WorkspaceStore = WorkspaceState & WorkspaceAction;

const createStore: StateCreator<WorkspaceStore, [['zustand/devtools', never]]> = (
  ...parameters
) => ({
  ...initialWorkspaceState,
  ...createWorkspaceSlice(...parameters),
});

//  ===============  Implement useStore ============ //

const devtools = createDevtools('workspace');

export const useWorkspaceStore = createWithEqualityFn<WorkspaceStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow,
);

expose('workspace', useWorkspaceStore);

export const getWorkspaceStoreState = () => useWorkspaceStore.getState();
