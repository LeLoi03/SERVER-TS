// src/chatbot/utils/languageConfig.ts
import { FunctionDeclaration } from '@google/genai'; // Assuming '@google/genai'
import { Language, AgentId, PersonalizationPayload } from '../shared/types';
import logToFile from '../../utils/logger';
import * as LangData from '../language';

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
const agentBaseSystemInstructions: Record<AgentId, Partial<Record<Language, string>>> = {
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
    },
};

// Store personalized base instructions (currently only for English HostAgent)
// You might expand this for other languages or agents if needed.
const personalizedAgentBaseSystemInstructions: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enPersonalizedHostAgentSystemInstructions, // The new personalized one
        'vi': LangData.viPersonalizedHostAgentSystemInstructions,
    }
};

const DEFAULT_LANGUAGE: Language = 'vi';
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';

export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID,
    personalizationData?: PersonalizationPayload | null // <<< Existing parameter

): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;
    let baseSystemInstructionsText: string = ""; // <<< INITIALIZE HERE
    let useEffectivePersonalizedInstructions = false;

    if (agentId === 'HostAgent' && personalizationData && Object.keys(personalizationData).length > 0) {
        const personalizedInstructionsForLang = personalizedAgentBaseSystemInstructions.HostAgent?.[targetLang];
        const personalizedInstructionsForEn = personalizedAgentBaseSystemInstructions.HostAgent?.['en'];

        if (personalizedInstructionsForLang) {
            baseSystemInstructionsText = personalizedInstructionsForLang;
            useEffectivePersonalizedInstructions = true;
            logToFile(`[Language Config] Using PERSONALIZED base instructions for HostAgent, Lang: ${targetLang}`);
        } else if (personalizedInstructionsForEn) {
            // Fallback to default personalized English if target language personalized not found
            baseSystemInstructionsText = personalizedInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            logToFile(`[Language Config] WARN: Personalized HostAgent instructions not found for Lang: ${targetLang}. Falling back to PERSONALIZED English.`);
        } else {
            // This case means even personalized English is missing, which is a config error.
            // Fallback to default non-personalized English as a last resort.
            logToFile(`[Language Config] CRITICAL ERROR: Personalized English instructions for HostAgent are missing. Falling back to DEFAULT English.`);
            baseSystemInstructionsText = LangData.enHostAgentSystemInstructions; // Default non-personalized English
            // useEffectivePersonalizedInstructions remains false
        }
    }

    // If not using personalized (either by condition or because personalized templates were missing),
    // or if it's not HostAgent, get default instructions.
    if (!useEffectivePersonalizedInstructions) {
        if (agentId === 'HostAgent') {
            const defaultHostInstructionsForLang = agentBaseSystemInstructions.HostAgent?.[targetLang];
            if (defaultHostInstructionsForLang) {
                baseSystemInstructionsText = defaultHostInstructionsForLang;
            } else {
                // Dynamic lookup as a fallback (ensure LangData keys match)
                const dynamicInstructionsKey = `${targetLang}HostAgentSystemInstructions` as keyof typeof LangData;
                const dynamicInstructions = LangData[dynamicInstructionsKey];
                if (typeof dynamicInstructions === 'string') {
                    baseSystemInstructionsText = dynamicInstructions;
                } else {
                    logToFile(`[Language Config] WARN: HostAgent system instructions not found for Lang: "${targetLang}". Falling back to DEFAULT English.`);
                    baseSystemInstructionsText = LangData.enHostAgentSystemInstructions; // Default non-personalized English
                }
            }
            logToFile(`[Language Config] Using DEFAULT base instructions for HostAgent, Lang: ${targetLang}`);
        } else { // For other agents, assume English instructions for now
            const englishInstructionsKey = `english${agentId}SystemInstructions` as keyof typeof LangData;
            const englishInstructions = LangData[englishInstructionsKey];
            if (typeof englishInstructions === 'string') {
                baseSystemInstructionsText = englishInstructions;
            } else {
                logToFile(`[Language Config] CRITICAL: English system instructions missing or not a string for agent "${agentId}".`);
                baseSystemInstructionsText = "Error: English instructions missing or malformed."; // Fallback error string
            }
        }
    }

    // At this point, baseSystemInstructionsText should always be assigned.
    // If it's still an empty string due to a major config error, the LLM will get an empty system prompt.
    if (baseSystemInstructionsText === "") {
        logToFile(`[Language Config] CRITICAL ERROR: baseSystemInstructionsText is empty for Agent: ${agentId}, Lang: ${targetLang}. This indicates a serious configuration issue.`);
        // Provide a very generic fallback to prevent crashes, though the bot's behavior will be poor.
        baseSystemInstructionsText = "You are a helpful assistant. Please respond to the user's query.";
    }


    let finalSystemInstructions = baseSystemInstructionsText;

    if (useEffectivePersonalizedInstructions && personalizationData) {
        // Ensure baseSystemInstructionsText was actually set to a personalized template
        // This check is a bit redundant if useEffectivePersonalizedInstructions is true,
        // but good for safety if logic changes.
        if (finalSystemInstructions.includes("[User's First Name]")) { // Check for a placeholder
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's First Name\]/g, personalizationData.firstName || 'User');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's Last Name\]/g, personalizationData.lastName || '');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's About Me section\]/g, personalizationData.aboutMe || 'Not specified');
            const topics = personalizationData.interestedTopics && personalizationData.interestedTopics.length > 0
                ? personalizationData.interestedTopics.join(', ')
                : 'Not specified';
            finalSystemInstructions = finalSystemInstructions.replace(/\[List of User's Interested Topics\]/g, topics);
            logToFile(`[Language Config] Injected personalization data into HostAgent instructions.`);
        } else {
            logToFile(`[Language Config] WARN: useEffectivePersonalizedInstructions was true, but the loaded baseSystemInstructionsText did not seem to be a personalized template (missing placeholders). Personalization data not injected.`);
        }
    }

    const functionDeclarations: FunctionDeclaration[] = commonEnglishFunctionDeclarations[agentId] || [];
    if (functionDeclarations.length === 0 && agentId !== 'HostAgent') {
        logToFile(`[Language Config] INFO: No specific English function declarations found for agent "${agentId}". This might be intended.`);
    }
    if (agentId === 'HostAgent' && (!functionDeclarations.find(fn => fn.name === LangData.englishRouteToAgentDeclaration.name))) {
        logToFile(`[Language Config] WARN: HostAgent is missing its 'englishRouteToAgentDeclaration'. Consider adding it if it's not implicitly handled.`);
        // Example: if (LangData.englishRouteToAgentDeclaration) functionDeclarations.push(LangData.englishRouteToAgentDeclaration);
    }

    logToFile(`[Language Config] Finalized config for Agent: ${agentId}, Lang: ${targetLang}. Personalization active: ${useEffectivePersonalizedInstructions}`);

    return {
        systemInstructions: finalSystemInstructions,
        functionDeclarations
    };
}