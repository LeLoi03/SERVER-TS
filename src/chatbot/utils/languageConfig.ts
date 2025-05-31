// src/chatbot/utils/languageConfig.ts
import { FunctionDeclaration, Tool, GoogleSearch, GoogleSearchRetrieval, DynamicRetrievalConfigMode } from '@google/genai'; // Thêm các type cần thiết
import { Language, AgentId, PersonalizationPayload } from '../shared/types';
import logToFile from '../../utils/logger';
import * as LangData from '../language';

interface LanguageAgentConfig {
    systemInstructions: string;
    tools: Tool[];
}

// --- Common English Function Declarations for other agents (NON-GROUNDING TOOLS) ---
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
    'HostAgent': [ // Các function call tùy chỉnh của HostAgent (nếu có, ngoài grounding)
        LangData.englishRouteToAgentDeclaration,
    ]
};

// --- Google Search Tools for Grounding (theo type SDK) ---

// Tool cho Google Search cơ bản (grounding)
const googleSearchBasicGroundingTool: Tool = {
    googleSearch: {} // Theo SDK, đây là một object GoogleSearch rỗng
};

// Tool cho Google Search Retrieval với cấu hình động
const googleSearchDynamicRetrievalTool: Tool = {
    googleSearchRetrieval: { // Đây là một object GoogleSearchRetrieval
        dynamicRetrievalConfig: {
            dynamicThreshold: 0.3, // Ví dụ threshold
            mode: DynamicRetrievalConfigMode.MODE_DYNAMIC // Sử dụng enum từ SDK nếu có, hoặc string "MODE_DYNAMIC"
        }
    }
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
    personalizationData?: PersonalizationPayload | null
): LanguageAgentConfig {
    const targetLang = lang || DEFAULT_LANGUAGE;
    let baseSystemInstructionsText: string = "";
    let useEffectivePersonalizedInstructions = false;

    if (agentId === 'HostAgent' && personalizationData?.isPersonalizationEnabled && (personalizationData.userProfile && Object.keys(personalizationData.userProfile).length > 0)) {
        const personalizedInstructionsForLang = personalizedAgentBaseSystemInstructions.HostAgent?.[targetLang];
        const personalizedInstructionsForEn = personalizedAgentBaseSystemInstructions.HostAgent?.['en'];

        if (personalizedInstructionsForLang) {
            baseSystemInstructionsText = personalizedInstructionsForLang;
            useEffectivePersonalizedInstructions = true;
        } else if (personalizedInstructionsForEn) {
            baseSystemInstructionsText = personalizedInstructionsForEn;
            useEffectivePersonalizedInstructions = true;
            logToFile(`[Language Config] WARN: Personalized HostAgent instructions not found for Lang: ${targetLang}. Falling back to PERSONALIZED English.`);
        } else {
            logToFile(`[Language Config] CRITICAL ERROR: Personalized English instructions for HostAgent are missing. Falling back to DEFAULT English.`);
            baseSystemInstructionsText = LangData.enHostAgentSystemInstructions;
        }
    }

    if (!useEffectivePersonalizedInstructions) {
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
            if (!useEffectivePersonalizedInstructions) {
                logToFile(`[Language Config] Using DEFAULT base instructions for HostAgent, Lang: ${targetLang}`);
            }
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
        logToFile(`[Language Config] CRITICAL ERROR: baseSystemInstructionsText is empty for Agent: ${agentId}, Lang: ${targetLang}.`);
        baseSystemInstructionsText = "You are a helpful assistant. Please respond to the user's query.";
    }

    let finalSystemInstructions = baseSystemInstructionsText;

    if (useEffectivePersonalizedInstructions && personalizationData?.isPersonalizationEnabled && personalizationData.userProfile) {
        if (finalSystemInstructions.includes("[User's First Name]")) {
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's First Name\]/g, personalizationData.userProfile.firstName || 'User');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's Last Name\]/g, personalizationData.userProfile.lastName || '');
            finalSystemInstructions = finalSystemInstructions.replace(/\[User's About Me section\]/g, personalizationData.userProfile.aboutMe || 'Not specified');
            const topics = personalizationData.userProfile.interestedTopics && personalizationData.userProfile.interestedTopics.length > 0
                ? personalizationData.userProfile.interestedTopics.join(', ')
                : 'Not specified';
            finalSystemInstructions = finalSystemInstructions.replace(/\[List of User's Interested Topics\]/g, topics);
        } else {
            logToFile(`[Language Config] WARN: useEffectivePersonalizedInstructions was true, but the loaded baseSystemInstructionsText did not seem to be a personalized template.`);
        }
    }

    // --- Xây dựng tools ---
    const tools: Tool[] = [];

    // Thêm các function declarations tùy chỉnh (NON-GROUNDING)
    const customFunctionDeclarations: FunctionDeclaration[] = commonEnglishFunctionDeclarations[agentId] || [];
    if (customFunctionDeclarations.length > 0) {
        tools.push({ functionDeclarations: customFunctionDeclarations });
    }

    // Thêm Google Search Grounding Tools cho HostAgent nếu được bật
    if (agentId === 'HostAgent' && personalizationData?.isGoogleSearchEnabled) {
        // Bạn có thể chọn một hoặc cả hai, hoặc có logic để quyết định dùng cái nào
        // Ví dụ: chỉ dùng basic grounding
        tools.push(googleSearchBasicGroundingTool);
        logToFile(`[Language Config] Added GoogleSearch Basic Grounding Tool for HostAgent.`);

        // Hoặc nếu bạn muốn dùng dynamic retrieval (như yêu cầu ban đầu của bạn)
        // tools.push(googleSearchDynamicRetrievalTool);
        // logToFile(`[Language Config] Added GoogleSearch Dynamic Retrieval Tool for HostAgent.`);

        // Hoặc cả hai nếu API cho phép và có ý nghĩa (thường thì không cần cả hai cùng lúc)
        // tools.push(googleSearchBasicGroundingTool);
        // tools.push(googleSearchDynamicRetrievalTool);

        // QUAN TRỌNG: System instruction của bạn nên hướng dẫn mô hình cách sử dụng
        // các tool này một cách hiệu quả. Nếu bạn cung cấp cả hai,
        // system instruction có thể cần phải rõ ràng hơn về việc khi nào dùng tool nào,
        // mặc dù thường thì mô hình sẽ tự quyết định.
        // Để đơn giản, thường chỉ cần một loại Google Search grounding tool.
    } else if (agentId === 'HostAgent') {
        logToFile(`[Language Config] Google Search Grounding is DISABLED for HostAgent.`);
    }

    logToFile(`[Language Config] Finalized config for Agent: ${agentId}, Lang: ${targetLang}. Personalization active: ${useEffectivePersonalizedInstructions}, Google Search active: ${!!personalizationData?.isGoogleSearchEnabled}. Tools count: ${tools.length}`);
    if (tools.length > 0) {
        tools.forEach(tool => {
            if (tool.functionDeclarations) {
                logToFile(`[Language Config] Tool: FunctionDeclarations (${tool.functionDeclarations.map(fd => fd.name).join(', ')})`);
            } else if (tool.googleSearch) {
                logToFile(`[Language Config] Tool: GoogleSearch (Basic Grounding)`);
            } else if (tool.googleSearchRetrieval) {
                logToFile(`[Language Config] Tool: GoogleSearchRetrieval (Dynamic Retrieval)`);
            }
        });
    }

    return {
        systemInstructions: finalSystemInstructions,
        tools
    };
}