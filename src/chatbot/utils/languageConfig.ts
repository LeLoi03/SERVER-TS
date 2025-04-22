// src/chatbot/utils/languageConfig.ts 
import { FunctionDeclaration } from '@google/generative-ai';
import { Language } from '../shared/types';
import logToFile from '../utils/logger';


import {
    // englishSystemInstructions as englishMonolithicSystemInstructions,
    englishHostAgentSystemInstructions, // New Host Agent instructions
    englishConferenceAgentSystemInstructions, // New Conference Agent instructions
    routeToAgentDeclaration, // New routing function
    english_getConferencesDeclaration,
    english_getJournalsDeclaration,
    english_getWebsiteInfoDeclaration,
    english_navigationDeclaration,
    english_openGoogleMapDeclaration,
    english_followUnfollowItemDeclaration,
    englishJournalAgentSystemInstructions,
    englishAdminContactAgentSystemInstructions,
    englishNavigationAgentSystemInstructions, 
    englishWebsiteInfoAgentSystemInstructions,
    vietnameseSystemInstructions, vietnam_getConferencesDeclaration, vietnam_getJournalsDeclaration, vietnam_getWebsiteInfoDeclaration,
    chineseSystemInstructions, china_getConferencesDeclaration, china_getJournalsDeclaration, china_getWebsiteInfoDeclaration, china_drawChartDeclaration,
    english_sendEmailToAdminDeclaration
} from "../gemini/functionDeclarations";

// --- Define Agent IDs ---
export type AgentId = 'HostAgent' | 'ConferenceAgent' | 'JournalAgent' | 'AdminContactAgent' | 'NavigationAgent' | 'WebsiteInfoAgent'; // <-- Add

// --- Define the structure for language-specific configuration per agent ---
interface LanguageAgentConfig {
    systemInstructions: string;
    functionDeclarations: FunctionDeclaration[];
}


// --- Map configurations ---
const agentLanguageConfigurations: Record<AgentId, Partial<Record<Language, LanguageAgentConfig>>> = {
    'HostAgent': {
        'en': {
            systemInstructions: englishHostAgentSystemInstructions, // <-- Will update this below
            functionDeclarations: [
                routeToAgentDeclaration,
            ],
        },
        // ... other languages for HostAgent ...
    },
    'ConferenceAgent': {
        'en': {
            systemInstructions: englishConferenceAgentSystemInstructions, // <-- Will update this below
            functionDeclarations: [
                english_getConferencesDeclaration,
                english_followUnfollowItemDeclaration, // <-- Add follow tool here
            ],
        },
        // ... other languages for ConferenceAgent ...
    },
    // --- Add JournalAgent Config ---
    'JournalAgent': {
        'en': {
            systemInstructions: englishJournalAgentSystemInstructions,
            functionDeclarations: [
                english_getJournalsDeclaration,
                english_followUnfollowItemDeclaration, // <-- Add follow tool here
            ],
        },
        // Add 'vi', 'zh' configs for JournalAgent if needed
    },
    'AdminContactAgent': {
        'en': {
            systemInstructions: englishAdminContactAgentSystemInstructions,
            functionDeclarations: [
                english_sendEmailToAdminDeclaration,
            ],
        },
        // Add 'vi', 'zh' configs if needed
    },

    'NavigationAgent': {
        'en': {
            systemInstructions: englishNavigationAgentSystemInstructions,
            functionDeclarations: [
                english_navigationDeclaration,
                english_openGoogleMapDeclaration,
            ],
        },
        // Add 'vi', 'zh' configs if needed
    },
    'WebsiteInfoAgent': {
        'en': {
            systemInstructions: englishWebsiteInfoAgentSystemInstructions,
            functionDeclarations: [
                english_getWebsiteInfoDeclaration,
            ],
        },
        // Add 'vi', 'zh' configs if needed
    }
    // ------------------------------
};

// --- Default language and agent ID for fallback ---
const DEFAULT_LANGUAGE: Language = 'en'; // Or 'vi' based on your preference
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';

// --- Helper function to get the configuration ---
export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID // Default to HostAgent
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;
    const agentConfig = agentLanguageConfigurations[agentId];

    if (!agentConfig) {
        logToFile(`[Language Config] WARN: Config not found for agent "${agentId}". Falling back to agent "${DEFAULT_AGENT_ID}".`);
        return getAgentLanguageConfig(targetLang, DEFAULT_AGENT_ID); // Recursive call for default agent
    }

    const langConfig = agentConfig[targetLang];

    if (!langConfig) {
        logToFile(`[Language Config] WARN: Config not found for language "${targetLang}" in agent "${agentId}". Falling back to default language "${DEFAULT_LANGUAGE}" for this agent.`);
        // Fallback to default language within the same agent if possible
        const fallbackLangConfig = agentConfig[DEFAULT_LANGUAGE];
        if (fallbackLangConfig) {
            return fallbackLangConfig;
        } else {
            // Critical fallback if even default language is missing for the agent
            logToFile(`[Language Config] CRITICAL: Default language config missing for agent "${agentId}". Returning empty config.`);
            return { systemInstructions: "Error: Config missing.", functionDeclarations: [] };
        }
    }

    logToFile(`[Language Config] Using configuration for Agent: ${agentId}, Language: ${targetLang}`);
    return langConfig;
}