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
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseSimplifiedHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'de': {
            systemInstructions: LangData.germanHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'fr': {
            systemInstructions: LangData.frenchHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'es': {
            systemInstructions: LangData.spanishHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'ru': {
            systemInstructions: LangData.russianHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'ja': {
            systemInstructions: LangData.japaneseHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'ko': {
            systemInstructions: LangData.koreanHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'ar': {
            systemInstructions: LangData.arabicHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
        'fa': {
            systemInstructions: LangData.persianHostAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration,
            ],
        },
    },
    'ConferenceAgent': {
        'en': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'vi': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'zh': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'de': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'fr': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'es': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'ru': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'ja': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'ko': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'ar': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },
        'fa': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration
            ],
        },


    },
    'JournalAgent': {
        'en': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'vi': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'de': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'fr': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'es': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'ru': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'ja': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'ko': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'ar': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'fa': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
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
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'de': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'fr': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'es': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration,
                LangData.englishManageFollowDeclaration,
            ],
        },
        'ru': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'ja': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'ko': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'ar': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
            ],
        },
        'fa': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration,
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
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'de': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'fr': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'es': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'ru': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'ja': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'ko': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'ar': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
            ],
        },
        'fa': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishNavigationDeclaration,
                LangData.englishOpenGoogleMapDeclaration,
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
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'zh': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'de': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'fr': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'es': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'ru': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'ja': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'ko': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'ar': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
        'fa': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration,
            ],
        },
    }
};


const DEFAULT_LANGUAGE: Language = 'vi';
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