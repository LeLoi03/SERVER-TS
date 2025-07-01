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

// System instructions KHI CÓ PAGE CONTEXT
const agentBaseSystemInstructionsWithPageContext: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        'vi': LangData.viHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        // ... các ngôn ngữ khác
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

// System instructions KHI CÓ PAGE CONTEXT VÀ PERSONALIZATION
const personalizedAgentBaseSystemInstructionsWithPageContext: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enPersonalizedHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        'vi': LangData.viPersonalizedHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        // ... các ngôn ngữ khác
    }
};

const DEFAULT_LANGUAGE: Language = 'vi';
const DEFAULT_AGENT_ID: AgentId = 'HostAgent';


export function getAgentLanguageConfig(
    lang: Language | undefined,
    agentId: AgentId = DEFAULT_AGENT_ID,
    personalizationData?: PersonalizationPayload | null,
    pageContextText?: string // <<< THÊM PARAMETER
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;
    let baseSystemInstructionsText: string = "";
    let useEffectivePersonalizedInstructions = false;
    let usingPageContextInstructions = false;

    // Ưu tiên: Page Context + Personalization > Page Context > Personalization > Default
    if (pageContextText && agentId === 'HostAgent' && personalizationData && Object.keys(personalizationData).length > 0) {
        const personalizedWithContextInstructionsForLang = personalizedAgentBaseSystemInstructionsWithPageContext.HostAgent?.[targetLang];
        const personalizedWithContextInstructionsForEn = personalizedAgentBaseSystemInstructionsWithPageContext.HostAgent?.['en'];

        if (personalizedWithContextInstructionsForLang) {
            baseSystemInstructionsText = personalizedWithContextInstructionsForLang;
            useEffectivePersonalizedInstructions = true;
            usingPageContextInstructions = true;
            logToFile(`[Language Config] Using PERSONALIZED + PAGE_CONTEXT base instructions for HostAgent, Lang: ${targetLang}`);
        } else if (personalizedWithContextInstructionsForEn) {
            baseSystemInstructionsText = personalizedWithContextInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            usingPageContextInstructions = true;
            logToFile(`[Language Config] WARN: Personalized + PageContext HostAgent instructions not found for Lang: ${targetLang}. Falling back to PERSONALIZED + PAGE_CONTEXT English.`);
        }
        // Nếu không tìm thấy, sẽ rơi xuống các block sau
    }
    
    if (!usingPageContextInstructions && pageContextText && agentId === 'HostAgent') {
        const contextInstructionsForLang = agentBaseSystemInstructionsWithPageContext.HostAgent?.[targetLang];
        const contextInstructionsForEn = agentBaseSystemInstructionsWithPageContext.HostAgent?.['en'];

        if (contextInstructionsForLang) {
            baseSystemInstructionsText = contextInstructionsForLang;
            usingPageContextInstructions = true;
            logToFile(`[Language Config] Using PAGE_CONTEXT base instructions for HostAgent, Lang: ${targetLang}`);
        } else if (contextInstructionsForEn) {
            baseSystemInstructionsText = contextInstructionsForEn;
            usingPageContextInstructions = true;
            logToFile(`[Language Config] WARN: PageContext HostAgent instructions not found for Lang: ${targetLang}. Falling back to PAGE_CONTEXT English.`);
        }
        // Nếu không tìm thấy, sẽ rơi xuống các block sau
    }

    if (!usingPageContextInstructions && !useEffectivePersonalizedInstructions && agentId === 'HostAgent' && personalizationData && Object.keys(personalizationData).length > 0) {
        const personalizedInstructionsForLang = personalizedAgentBaseSystemInstructions.HostAgent?.[targetLang];
        const personalizedInstructionsForEn = personalizedAgentBaseSystemInstructions.HostAgent?.['en'];

        if (personalizedInstructionsForLang) {
            baseSystemInstructionsText = personalizedInstructionsForLang;
            useEffectivePersonalizedInstructions = true;
            logToFile(`[Language Config] Using PERSONALIZED base instructions for HostAgent, Lang: ${targetLang}`);
        } else if (personalizedInstructionsForEn) {
            baseSystemInstructionsText = personalizedInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            logToFile(`[Language Config] WARN: Personalized HostAgent instructions not found for Lang: ${targetLang}. Falling back to PERSONALIZED English.`);
        }
        // Nếu không tìm thấy, sẽ rơi xuống block default
    }

    // Default (không context, không personalization, hoặc các agent khác HostAgent)
    if (!usingPageContextInstructions && !useEffectivePersonalizedInstructions) {
        if (agentId === 'HostAgent') {
            const defaultHostInstructionsForLang = agentBaseSystemInstructions.HostAgent?.[targetLang];
            if (defaultHostInstructionsForLang) {
                baseSystemInstructionsText = defaultHostInstructionsForLang;
            } else {
                const dynamicInstructionsKey = `${targetLang}HostAgentSystemInstructions` as keyof typeof LangData;
                const dynamicInstructions = LangData[dynamicInstructionsKey];
                if (typeof dynamicInstructions === 'string') {
                    baseSystemInstructionsText = dynamicInstructions;
                } else {
                    logToFile(`[Language Config] WARN: HostAgent system instructions not found for Lang: "${targetLang}". Falling back to DEFAULT English.`);
                    baseSystemInstructionsText = LangData.enHostAgentSystemInstructions;
                }
            }
            logToFile(`[Language Config] Using DEFAULT base instructions for HostAgent, Lang: ${targetLang}`);
        } else { 
            const englishInstructionsKey = `english${agentId}SystemInstructions` as keyof typeof LangData;
            const englishInstructions = LangData[englishInstructionsKey];
            if (typeof englishInstructions === 'string') {
                baseSystemInstructionsText = englishInstructions;
            } else {
                logToFile(`[Language Config] CRITICAL: English system instructions missing or not a string for agent "${agentId}".`);
                baseSystemInstructionsText = "Error: English instructions missing or malformed.";
            }
        }
    }
    
    if (baseSystemInstructionsText === "") {
        logToFile(`[Language Config] CRITICAL ERROR: baseSystemInstructionsText is empty for Agent: ${agentId}, Lang: ${targetLang}. This indicates a serious configuration issue.`);
        baseSystemInstructionsText = "You are a helpful assistant. Please respond to the user's query.";
    }

    let finalSystemInstructions = baseSystemInstructionsText;

    if (useEffectivePersonalizedInstructions && personalizationData) {
        // Chỉ inject nếu template có placeholder (dấu hiệu của template personalized)
        if (finalSystemInstructions.includes("[User's First Name]")) { 
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's First Name\]/g, personalizationData.firstName || 'User');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's Last Name\]/g, personalizationData.lastName || '');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's About Me section\]/g, personalizationData.aboutMe || 'Not specified');
            const topics = personalizationData.interestedTopics && personalizationData.interestedTopics.length > 0
                ? personalizationData.interestedTopics.join(', ')
                : 'Not specified';
            finalSystemInstructions = finalSystemInstructions.replace(/\[List of User's Interested Topics\]/g, topics);
            logToFile(`[Language Config] Injected personalization data into HostAgent instructions.`);
        } else if (useEffectivePersonalizedInstructions) { // Log warning nếu cờ bật nhưng template không khớp
             logToFile(`[Language Config] WARN: useEffectivePersonalizedInstructions was true, but the loaded baseSystemInstructionsText did not seem to be a personalized template (missing placeholders). Personalization data not injected.`);
        }
    }

    const functionDeclarations: FunctionDeclaration[] = commonEnglishFunctionDeclarations[agentId] || [];
    if (functionDeclarations.length === 0 && agentId !== 'HostAgent') {
        logToFile(`[Language Config] INFO: No specific English function declarations found for agent "${agentId}". This might be intended.`);
    }
    if (agentId === 'HostAgent' && (!functionDeclarations.find(fn => fn.name === LangData.englishRouteToAgentDeclaration.name))) {
        logToFile(`[Language Config] WARN: HostAgent is missing its 'englishRouteToAgentDeclaration'. Consider adding it if it's not implicitly handled.`);
    }

    logToFile(`[Language Config] Finalized config for Agent: ${agentId}, Lang: ${targetLang}. Personalization: ${useEffectivePersonalizedInstructions}, PageContext: ${usingPageContextInstructions}`);

    return {
        systemInstructions: finalSystemInstructions,
        functionDeclarations
    };
}