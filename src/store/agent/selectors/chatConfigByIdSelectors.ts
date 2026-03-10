import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_AGENT_SEARCH_FC_MODEL } from '@lobechat/const';
import { isContextCachingModel, isThinkingWithToolClaudeModel } from '@lobechat/model-runtime';
import { type LobeAgentChatConfig, type RuntimeEnvMode } from '@lobechat/types';

import { type AgentStoreState } from '@/store/agent/initialState';

import { agentSelectors } from './selectors';

/**
 * ChatConfig selectors that get config by agentId parameter.
 * Used in ChatInput components where agentId is passed as prop.
 */

const getChatConfigById =
  (agentId: string) =>
  (s: AgentStoreState): LobeAgentChatConfig =>
    agentSelectors.getAgentConfigById(agentId)(s)?.chatConfig || {};

const getEnableHistoryCountById = (agentId: string) => (s: AgentStoreState) => {
  const config = agentSelectors.getAgentConfigById(agentId)(s);
  const chatConfig = getChatConfigById(agentId)(s);

  // If context caching is enabled and the current model type matches, do not enable history count
  const enableContextCaching = !chatConfig.disableContextCaching;

  if (enableContextCaching && config?.model && isContextCachingModel(config.model)) return false;

  // When search is enabled, do not enable history count for the claude 3.7 sonnet model
  const searchMode = chatConfig.searchMode || 'auto';
  const enableSearch = searchMode !== 'off';

  if (enableSearch && config?.model && isThinkingWithToolClaudeModel(config.model)) return false;

  return chatConfig.enableHistoryCount;
};

const getHistoryCountById =
  (agentId: string) =>
  (s: AgentStoreState): number => {
    const chatConfig = getChatConfigById(agentId)(s);

    return chatConfig.historyCount ?? (DEFAULT_AGENT_CHAT_CONFIG.historyCount as number);
  };

const getSearchModeById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchMode || 'auto';

const isEnableSearchById = (agentId: string) => (s: AgentStoreState) =>
  getSearchModeById(agentId)(s) !== 'off';

const getUseModelBuiltinSearchById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).useModelBuiltinSearch;

const getSearchFCModelById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).searchFCModel || DEFAULT_AGENT_SEARCH_FC_MODEL;

const getMemoryToolConfigById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory;

const isMemoryToolEnabledById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory?.enabled ?? false;

const getMemoryToolEffortById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).memory?.effort ?? 'medium';

const getRuntimeEnvConfigById = (agentId: string) => (s: AgentStoreState) =>
  getChatConfigById(agentId)(s).runtimeEnv;

const isLocalSystemEnabledById = (agentId: string) => (s: AgentStoreState) =>
  getRuntimeModeById(agentId)(s) === 'local';

/**
 * Get runtime environment mode by agent ID.
 * Defaults to 'local' on desktop if not set.
 */
const getRuntimeModeById =
  (agentId: string) =>
  (s: AgentStoreState): RuntimeEnvMode => {
    return getChatConfigById(agentId)(s).runtimeEnv?.runtimeMode ?? 'local';
  };

export const chatConfigByIdSelectors = {
  getChatConfigById,
  getEnableHistoryCountById,
  getHistoryCountById,
  getRuntimeEnvConfigById,
  getMemoryToolConfigById,
  getMemoryToolEffortById,
  getRuntimeModeById,
  getSearchFCModelById,
  getSearchModeById,
  getUseModelBuiltinSearchById,
  isEnableSearchById,
  isLocalSystemEnabledById,
  isMemoryToolEnabledById,
};
