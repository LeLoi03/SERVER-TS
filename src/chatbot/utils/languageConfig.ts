// src/chatbot/utils/languageConfig.ts
import { FunctionDeclaration } from '@google/generative-ai';
import { Language } from '../shared/types';
import logToFile from '../../utils/logger';

// Import all language data (instructions and functions) from the language index file
import * as LangData from '../language'; // <-- Import from the new index file

// --- Define Agent IDs ---
// (Keep AgentId definition as is)
export type AgentId = 'HostAgent' | 'ConferenceAgent' | 'JournalAgent' | 'AdminContactAgent' | 'NavigationAgent' | 'WebsiteInfoAgent';

// --- Define the structure for language-specific configuration per agent ---
interface LanguageAgentConfig {
    systemInstructions: string;
    functionDeclarations: FunctionDeclaration[];
}

// --- Map configurations ---
// Update the references to use the LangData namespace
const agentLanguageConfigurations: Record<AgentId, Partial<Record<Language, LanguageAgentConfig>>> = {
    'HostAgent': {
        'en': {
            systemInstructions: LangData.englishHostAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // <-- Use LangData
            ],
        },
        'vi': {
             systemInstructions: LangData.vietnameseHostAgentSystemInstructions, // <-- Use LangData
             functionDeclarations: [
                 LangData.vietnameseRouteToAgentDeclaration, // <-- Use LangData
             ],
        },
        'zh': {
             systemInstructions: LangData.chineseHostAgentSystemInstructions, // <-- Use LangData
             functionDeclarations: [
                 LangData.chineseRouteToAgentDeclaration, // <-- Use LangData
             ],
        },
        // ... potentially add other languages if defined in the index
    },
    'ConferenceAgent': {
        'en': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // <-- Use LangData
                LangData.englishFollowUnfollowItemDeclaration, // <-- Use LangData
                LangData.englishDrawChartDeclaration, // Assuming this should be here or Host? Added based on imports
            ],
        },
        'vi': {
            systemInstructions: LangData.vietnameseConferenceAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.vietnamGetConferencesDeclaration, // <-- Use LangData (Note: original import name)
                LangData.vietnameseFollowUnfollowItemDeclaration, // <-- Use LangData
                LangData.vietnamDrawChartDeclaration, // <-- Use LangData (Note: original import name)
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseConferenceAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.chineseGetConferencesDeclaration, // <-- Use LangData
                LangData.chineseFollowUnfollowItemDeclaration, // <-- Use LangData
                LangData.chineseDrawChartDeclaration, // <-- Use LangData
            ],
        },
        // ... potentially add other languages
    },
    'JournalAgent': {
        'en': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // <-- Use LangData
                LangData.englishFollowUnfollowItemDeclaration, // <-- Use LangData
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseJournalAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.vietnamGetJournalsDeclaration, // <-- Use LangData (Note: original import name)
                LangData.vietnameseFollowUnfollowItemDeclaration, // <-- Use LangData
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseJournalAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.chineseGetJournalsDeclaration, // <-- Use LangData
                LangData.chineseFollowUnfollowItemDeclaration, // <-- Use LangData
            ],
        },
        // Add 'vi', 'zh' configs for JournalAgent if needed
    },
    'AdminContactAgent': {
        'en': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // <-- Use LangData
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseAdminContactAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.vietnameseSendEmailToAdminDeclaration, // <-- Use LangData
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseAdminContactAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.chineseSendEmailToAdminDeclaration, // <-- Use LangData
            ],
        },
        // Add 'vi', 'zh' configs if needed
    },
    'NavigationAgent': {
        'en': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // <-- Use LangData (Corrected name based on likely intent)
                LangData.englishOpenGoogleMapDeclaration, // <-- Use LangData (Corrected name based on likely intent)
            ],
        },
        'vi': {
            systemInstructions: LangData.vietnameseNavigationAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.vietnameseNavigationDeclaration, // <-- Use LangData
                LangData.vietnameseOpenGoogleMapDeclaration, // <-- Use LangData
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseNavigationAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.chineseNavigationDeclaration, // <-- Use LangData
                LangData.chineseOpenGoogleMapDeclaration, // <-- Use LangData
            ],
        },
        // Add 'vi', 'zh' configs if needed
    },
    'WebsiteInfoAgent': {
        'en': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // <-- Use LangData (Corrected name based on likely intent)
            ],
        },
         'vi': {
            systemInstructions: LangData.vietnameseWebsiteInfoAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.vietnamGetWebsiteInfoDeclaration, // <-- Use LangData (Note: original import name)
            ],
        },
         'zh': {
            systemInstructions: LangData.chineseWebsiteInfoAgentSystemInstructions, // <-- Use LangData
            functionDeclarations: [
                LangData.chineseGetWebsiteInfoDeclaration, // <-- Use LangData
            ],
        },
        // Add 'vi', 'zh' configs if needed
    }
    // ------------------------------
};

// --- Default language and agent ID for fallback ---
// (Keep defaults as is)
const DEFAULT_LANGUAGE: Language = 'en';
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';

// --- Helper function to get the configuration ---
// (Keep getAgentLanguageConfig function as is, it doesn't need changes)
export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;

    // Ensure the agentId exists in our configuration map
    const agentConfigMap = agentLanguageConfigurations[agentId];
    if (!agentConfigMap) {
        logToFile(`[Language Config] WARN: Config not found for agent "${agentId}". Falling back to agent "${DEFAULT_AGENT_ID}".`);
        // Avoid infinite recursion if DEFAULT_AGENT_ID is also missing
        if (agentId === DEFAULT_AGENT_ID) {
             logToFile(`[Language Config] CRITICAL: Default agent config missing for agent "${DEFAULT_AGENT_ID}". Returning empty config.`);
             return { systemInstructions: "Error: Critical config missing.", functionDeclarations: [] };
        }
        return getAgentLanguageConfig(targetLang, DEFAULT_AGENT_ID); // Recursive call for default agent
    }

    // Try to get the configuration for the target language
    let langConfig = agentConfigMap[targetLang];

    // If the target language config is missing, try the default language for this agent
    if (!langConfig) {
        logToFile(`[Language Config] WARN: Config not found for language "${targetLang}" in agent "${agentId}". Falling back to default language "${DEFAULT_LANGUAGE}" for this agent.`);
        langConfig = agentConfigMap[DEFAULT_LANGUAGE];

        // If even the default language is missing for this agent, handle critically
        if (!langConfig) {
            logToFile(`[Language Config] CRITICAL: Default language config missing for agent "${agentId}". Trying to return config for default agent/default language.`);
             // As a last resort, try getting the config for the absolute default agent and language
             const absoluteDefaultConfig = agentLanguageConfigurations[DEFAULT_AGENT_ID]?.[DEFAULT_LANGUAGE];
             if (absoluteDefaultConfig) {
                 return absoluteDefaultConfig;
             } else {
                 logToFile(`[Language Config] CRITICAL: Absolute default config (Agent: ${DEFAULT_AGENT_ID}, Lang: ${DEFAULT_LANGUAGE}) missing. Returning empty config.`);
                 return { systemInstructions: "Error: Config missing.", functionDeclarations: [] };
             }
        }
    }

    // Ensure the retrieved config is not undefined/null before returning
    if (!langConfig) {
         logToFile(`[Language Config] CRITICAL: Could not resolve any valid config for Agent: ${agentId}, Language: ${targetLang}. Returning empty config.`);
         return { systemInstructions: "Error: Config resolution failed.", functionDeclarations: [] };
    }

    logToFile(`[Language Config] Using configuration for Agent: ${agentId}, Language: ${targetLang}`);
    // Type assertion might be needed if TypeScript can't infer langConfig is defined
    return langConfig as LanguageAgentConfig;
}