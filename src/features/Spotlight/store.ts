import { create } from 'zustand';

interface SpotlightState {
  activePlugins: string[];
  agentId: string;
  currentModel: { model: string; provider: string };
  groupId?: string;
  inputValue: string;
  messages: { content: string; id: string; loading?: boolean; role: 'user' | 'assistant' }[];
  streaming: boolean;
  topicId: string | null;
  viewState: 'input' | 'chat';
}

interface SpotlightActions {
  reset: () => void;
  setCurrentModel: (model: { model: string; provider: string }) => void;
  setInputValue: (value: string) => void;
  setViewState: (state: 'input' | 'chat') => void;
  togglePlugin: (pluginId: string) => void;
}

const initialState: SpotlightState = {
  activePlugins: [],
  agentId: 'default',
  currentModel: { model: '', provider: '' },
  inputValue: '',
  messages: [],
  streaming: false,
  topicId: null,
  viewState: 'input',
};

export const useSpotlightStore = create<SpotlightState & SpotlightActions>()((set) => ({
  ...initialState,

  reset: () => set(initialState),

  setCurrentModel: (model) => set({ currentModel: model }),

  setInputValue: (value) => set({ inputValue: value }),

  setViewState: (viewState) => {
    set({ viewState });
    window.electronAPI?.invoke?.('spotlight:setChatState', viewState === 'chat');
  },

  togglePlugin: (pluginId) =>
    set((state) => ({
      activePlugins: state.activePlugins.includes(pluginId)
        ? state.activePlugins.filter((id) => id !== pluginId)
        : [...state.activePlugins, pluginId],
    })),
}));
