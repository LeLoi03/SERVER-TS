// src/chatbot/utils/languageConfig.ts
import { FunctionDeclaration } from '@google/genai'; // Assuming '@google/genai'
import { Language, AgentId, PersonalizationPayload } from '../shared/types';
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
        'zh': LangData.zhHostAgentSystemInstructionsWithPageContext,
        'de': LangData.deHostAgentSystemInstructionsWithPageContext,
        'fr': LangData.frHostAgentSystemInstructionsWithPageContext,
        'es': LangData.esHostAgentSystemInstructionsWithPageContext,
        'ru': LangData.ruHostAgentSystemInstructionsWithPageContext,
        'ja': LangData.jaHostAgentSystemInstructionsWithPageContext,
        'ko': LangData.koHostAgentSystemInstructionsWithPageContext,
        'ar': LangData.arHostAgentSystemInstructionsWithPageContext,
    },
};

// Store personalized base instructions (currently only for English HostAgent)
// You might expand this for other languages or agents if needed.
const personalizedAgentBaseSystemInstructions: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enPersonalizedHostAgentSystemInstructions, // <<< TẠO TEMPLATE NÀY
        'vi': LangData.viPersonalizedHostAgentSystemInstructions, // <<< TẠO TEMPLATE NÀY
        'zh': LangData.zhPersonalizedHostAgentSystemInstructions,
        'de': LangData.dePersonalizedHostAgentSystemInstructions,
        'fr': LangData.frPersonalizedHostAgentSystemInstructions,
        'es': LangData.esPersonalizedHostAgentSystemInstructions,
        'ru': LangData.ruPersonalizedHostAgentSystemInstructions,
        'ja': LangData.jaPersonalizedHostAgentSystemInstructions,
        'ko': LangData.koPersonalizedHostAgentSystemInstructions,
        'ar': LangData.arPersonalizedHostAgentSystemInstructions,
    }
};

// System instructions KHI CÓ PAGE CONTEXT VÀ PERSONALIZATION
const personalizedAgentBaseSystemInstructionsWithPageContext: Record<AgentId, Partial<Record<Language, string>>> = {
    'HostAgent': {
        'en': LangData.enPersonalizedHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        'vi': LangData.viPersonalizedHostAgentSystemInstructionsWithPageContext, // <<< TẠO TEMPLATE NÀY
        'zh': LangData.zhPersonalizedHostAgentSystemInstructionsWithPageContext,
        'de': LangData.dePersonalizedHostAgentSystemInstructionsWithPageContext,
        'fr': LangData.frPersonalizedHostAgentSystemInstructionsWithPageContext,
        'es': LangData.esPersonalizedHostAgentSystemInstructionsWithPageContext,
        'ru': LangData.ruPersonalizedHostAgentSystemInstructionsWithPageContext,
        'ja': LangData.jaPersonalizedHostAgentSystemInstructionsWithPageContext,
        'ko': LangData.koPersonalizedHostAgentSystemInstructionsWithPageContext,
        'ar': LangData.arPersonalizedHostAgentSystemInstructionsWithPageContext,
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
            
        } else if (personalizedWithContextInstructionsForEn) {
            baseSystemInstructionsText = personalizedWithContextInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            usingPageContextInstructions = true;
            
        }
        // Nếu không tìm thấy, sẽ rơi xuống các block sau
    }

    if (!usingPageContextInstructions && pageContextText && agentId === 'HostAgent') {
        const contextInstructionsForLang = agentBaseSystemInstructionsWithPageContext.HostAgent?.[targetLang];
        const contextInstructionsForEn = agentBaseSystemInstructionsWithPageContext.HostAgent?.['en'];

        if (contextInstructionsForLang) {
            baseSystemInstructionsText = contextInstructionsForLang;
            usingPageContextInstructions = true;
            
        } else if (contextInstructionsForEn) {
            baseSystemInstructionsText = contextInstructionsForEn;
            usingPageContextInstructions = true;
            
        }
        // Nếu không tìm thấy, sẽ rơi xuống các block sau
    }

    if (!usingPageContextInstructions && !useEffectivePersonalizedInstructions && agentId === 'HostAgent' && personalizationData && Object.keys(personalizationData).length > 0) {
        const personalizedInstructionsForLang = personalizedAgentBaseSystemInstructions.HostAgent?.[targetLang];
        const personalizedInstructionsForEn = personalizedAgentBaseSystemInstructions.HostAgent?.['en'];

        if (personalizedInstructionsForLang) {
            baseSystemInstructionsText = personalizedInstructionsForLang;
            useEffectivePersonalizedInstructions = true;
            
        } else if (personalizedInstructionsForEn) {
            baseSystemInstructionsText = personalizedInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            
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
                    
                    baseSystemInstructionsText = LangData.enHostAgentSystemInstructions;
                }
            }
            
        } else {
            const englishInstructionsKey = `english${agentId}SystemInstructions` as keyof typeof LangData;
            const englishInstructions = LangData[englishInstructionsKey];
            if (typeof englishInstructions === 'string') {
                baseSystemInstructionsText = englishInstructions;
            } else {
                
                baseSystemInstructionsText = "Error: English instructions missing or malformed.";
            }
        }
    }

    if (baseSystemInstructionsText === "") {
        
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
            
        } else if (useEffectivePersonalizedInstructions) { // Log warning nếu cờ bật nhưng template không khớp
            
        }
    }

    const functionDeclarations: FunctionDeclaration[] = commonEnglishFunctionDeclarations[agentId] || [];
    if (functionDeclarations.length === 0 && agentId !== 'HostAgent') {
        
    }
    if (agentId === 'HostAgent' && (!functionDeclarations.find(fn => fn.name === LangData.englishRouteToAgentDeclaration.name))) {
        
    }

    

    return {
        systemInstructions: finalSystemInstructions,
        functionDeclarations
    };
}