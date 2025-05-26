// src/chatbot/utils/languageConfig.ts

// Import types from the NEW SDK
import { FunctionDeclaration, Type, Schema } from '@google/genai'; // Assuming '@google/genai'
// If Schema and Type are not directly exported, you might need to adjust the import path
// based on how the new SDK structures its type exports.
// The provided library code shows 'Type' and 'Schema' interfaces.

import { Language, AgentId } from '../shared/types';
import logToFile from '../../utils/logger';
import * as LangData from '../language'; // CRITICAL: Objects in LangData MUST be updated

// --- Define the structure for language-specific configuration per agent ---
interface LanguageAgentConfig {
    systemInstructions: string;
    functionDeclarations: FunctionDeclaration[]; // Now uses new SDK's FunctionDeclaration
}

// --- Common English Function Declarations for all agents ---
// This assumes that the objects in LangData (e.g., englishGetConferencesDeclaration)
// will be updated to conform to the new SDK's FunctionDeclaration structure.
const commonEnglishFunctionDeclarations: Record<AgentId, FunctionDeclaration[]> = {
    'ConferenceAgent': [
        LangData.englishGetConferencesDeclaration,
        LangData.englishManageFollowDeclaration,
        LangData.englishManageCalendarDeclaration,
        LangData.englishManageBlacklistDeclaration
    ],
    'JournalAgent': [
        LangData.englishGetJournalsDeclaration,
        LangData.englishManageFollowDeclaration,
    ],
    'AdminContactAgent': [
        LangData.englishSendEmailToAdminDeclaration,
    ],
    'NavigationAgent': [
        LangData.englishNavigationDeclaration,
        LangData.englishOpenGoogleMapDeclaration,
    ],
    'WebsiteInfoAgent': [
        LangData.englishGetWebsiteInfoDeclaration,
    ],
    'HostAgent': [
        LangData.englishRouteToAgentDeclaration,
    ]
};

// --- Map configurations (chỉ cho systemInstructions thay đổi theo ngôn ngữ) ---
const agentLanguageConfigurations: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enHostAgentSystemInstructions,
        'vi': LangData.viHostAgentSystemInstructions,
        'zh': LangData.zhHostAgentSystemInstructions,
        'de': LangData.deHostAgentSystemInstructions,
        'fr': LangData.frHostAgentSystemInstructions,
        'es': LangData.esHostAgentSystemInstructions,
        'ru': LangData.ruHostAgentSystemInstructions,
        'ja': LangData.jaHostAgentSystemInstructions,
        'ko': LangData.koHostAgentSystemInstructions,
        'ar': LangData.arHostAgentSystemInstructions,
        'fa': LangData.faHostAgentSystemInstructions,
    },
};

const DEFAULT_LANGUAGE: Language = 'vi';
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';

export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;
    let systemInstructions: string;

    if (agentId === 'HostAgent') {
        const hostConfig = agentLanguageConfigurations.HostAgent;
        systemInstructions = hostConfig?.[targetLang] || '';
        if (!systemInstructions) {
            const dynamicInstructions = LangData[`${targetLang}HostAgentSystemInstructions` as keyof typeof LangData];
            if (typeof dynamicInstructions === 'string') {
                systemInstructions = dynamicInstructions;
            } else {
                logToFile(`[Language Config] WARN: HostAgent system instructions not found for language "${targetLang}" or malformed. Falling back to English.`);
                systemInstructions = LangData.enHostAgentSystemInstructions;
            }
        }
    } else {
        const englishInstructions = LangData[`english${agentId}SystemInstructions` as keyof typeof LangData];
        if (typeof englishInstructions === 'string') {
            systemInstructions = englishInstructions;
        } else {
            logToFile(`[Language Config] CRITICAL: English system instructions missing or not a string for agent "${agentId}".`);
            systemInstructions = "Error: English instructions missing or malformed.";
        }
    }

    const functionDeclarations: FunctionDeclaration[] = commonEnglishFunctionDeclarations[agentId] || [];
    if (functionDeclarations.length === 0 && agentId !== 'HostAgent') { // HostAgent might legitimately have no functions other than routeToAgent if that's handled differently
        // Consider if HostAgent should always have at least englishRouteToAgentDeclaration
        // For now, keeping original logic but noting the log message.
        logToFile(`[Language Config] INFO: No specific English function declarations found for agent "${agentId}". This might be intended.`);
    }
     if (agentId === 'HostAgent' && (!functionDeclarations || functionDeclarations.length === 0 || !functionDeclarations.includes(LangData.englishRouteToAgentDeclaration))) {
        logToFile(`[Language Config] CRITICAL: HostAgent is missing its 'englishRouteToAgentDeclaration'.`);
        // Potentially add it here if it's always required and might be missing from commonEnglishFunctionDeclarations setup
        // functionDeclarations = [LangData.englishRouteToAgentDeclaration];
    }


    logToFile(`[Language Config] Using configuration for Agent: ${agentId}, Language: ${targetLang} (System Instructions: ${agentId === 'HostAgent' ? 'language-dependent' : 'English'}, Functions: English)`);

    return {
        systemInstructions,
        functionDeclarations // This is now typed with the new SDK's FunctionDeclaration
    };
}