// src/chatbot/utils/languageConfig.ts
import { FunctionDeclaration } from '@google/generative-ai';
// Import AgentId from shared/types
import { Language, AgentId } from '../shared/types';
import logToFile from '../../utils/logger';

// Import all language data (instructions and functions) from the language index file
import * as LangData from '../language';

// --- Define the structure for language-specific configuration per agent ---
interface LanguageAgentConfig {
    systemInstructions: string;
    functionDeclarations: FunctionDeclaration[];
}

// --- Map configurations ---
// The keys of this record will now correctly use the imported AgentId type
const agentLanguageConfigurations: Record<AgentId, Partial<Record<Language, LanguageAgentConfig>>> = {
    'HostAgent': {
        'en': {
            systemInstructions: LangData.englishHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'vi': {
             systemInstructions: LangData.vietnameseHostAgentSystemInstructions,
             functionDeclarations: [
                 LangData.vietnameseRouteToAgentDeclaration,
             ],
        },
        'zh': {
             systemInstructions: LangData.chineseHostAgentSystemInstructions,
             functionDeclarations: [
                 LangData.chineseRouteToAgentDeclaration,
             ],
        },
    },
    'ConferenceAgent': {
        'en': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishFollowUnfollowItemDeclaration,
            ],
        },
        'vi': {
            systemInstructions: LangData.vietnameseConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.vietnamGetConferencesDeclaration,
                LangData.vietnameseFollowUnfollowItemDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.chineseGetConferencesDeclaration,
                LangData.chineseFollowUnfollowItemDeclaration,
            ],
        },
    },
    'JournalAgent': {
        'en': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishFollowUnfollowItemDeclaration,
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.vietnamGetJournalsDeclaration,
                LangData.vietnameseFollowUnfollowItemDeclaration,
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.chineseGetJournalsDeclaration,
                LangData.chineseFollowUnfollowItemDeclaration,
            ],
        },
    },
    'AdminContactAgent': {
        'en': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.vietnameseSendEmailToAdminDeclaration,
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.chineseSendEmailToAdminDeclaration,
            ],
        },
    },
    'NavigationAgent': {
        'en': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'vi': {
            systemInstructions: LangData.vietnameseNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.vietnameseNavigationDeclaration,
                LangData.vietnameseOpenGoogleMapDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.chineseNavigationDeclaration,
                LangData.chineseOpenGoogleMapDeclaration,
            ],
        },
    },
    'WebsiteInfoAgent': {
        'en': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.vietnamGetWebsiteInfoDeclaration,
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.chineseGetWebsiteInfoDeclaration,
            ],
        },
    }
};

const DEFAULT_LANGUAGE: Language = 'en';
// DEFAULT_AGENT_ID will now correctly use the imported AgentId type
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';

// The agentId parameter will now correctly use the imported AgentId type
export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID // Now uses AgentId from shared/types
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;

    const agentConfigMap = agentLanguageConfigurations[agentId];
    if (!agentConfigMap) {
        logToFile(`[Language Config] WARN: Config not found for agent "${agentId}". Falling back to agent "${DEFAULT_AGENT_ID}".`);
        if (agentId === DEFAULT_AGENT_ID) {
             logToFile(`[Language Config] CRITICAL: Default agent config missing for agent "${DEFAULT_AGENT_ID}". Returning empty config.`);
             return { systemInstructions: "Error: Critical config missing.", functionDeclarations: [] };
        }
        return getAgentLanguageConfig(targetLang, DEFAULT_AGENT_ID);
    }

    let langConfig = agentConfigMap[targetLang];

    if (!langConfig) {
        logToFile(`[Language Config] WARN: Config not found for language "${targetLang}" in agent "${agentId}". Falling back to default language "${DEFAULT_LANGUAGE}" for this agent.`);
        langConfig = agentConfigMap[DEFAULT_LANGUAGE];

        if (!langConfig) {
            logToFile(`[Language Config] CRITICAL: Default language config missing for agent "${agentId}". Trying to return config for default agent/default language.`);
             const absoluteDefaultConfig = agentLanguageConfigurations[DEFAULT_AGENT_ID]?.[DEFAULT_LANGUAGE];
             if (absoluteDefaultConfig) {
                 return absoluteDefaultConfig;
             } else {
                 logToFile(`[Language Config] CRITICAL: Absolute default config (Agent: ${DEFAULT_AGENT_ID}, Lang: ${DEFAULT_LANGUAGE}) missing. Returning empty config.`);
                 return { systemInstructions: "Error: Config missing.", functionDeclarations: [] };
             }
        }
    }

    if (!langConfig) {
         logToFile(`[Language Config] CRITICAL: Could not resolve any valid config for Agent: ${agentId}, Language: ${targetLang}. Returning empty config.`);
         return { systemInstructions: "Error: Config resolution failed.", functionDeclarations: [] };
    }

    logToFile(`[Language Config] Using configuration for Agent: ${agentId}, Language: ${targetLang}`);
    return langConfig as LanguageAgentConfig;
}