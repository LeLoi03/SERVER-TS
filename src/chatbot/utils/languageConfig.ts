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
            systemInstructions: LangData.vietnameseHostAgentSystemInstructions, // Giữ tiếng Việt cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'zh': {
            systemInstructions: LangData.chineseSimplifiedHostAgentSystemInstructions, // Giữ tiếng Trung cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'de': {
            systemInstructions: LangData.germanHostAgentSystemInstructions, // Giữ tiếng Đức cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'fr': {
            systemInstructions: LangData.frenchHostAgentSystemInstructions, // Giữ tiếng Pháp cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'es': {
            systemInstructions: LangData.spanishHostAgentSystemInstructions, // Giữ tiếng Tây Ban Nha cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'ru': {
            systemInstructions: LangData.russianHostAgentSystemInstructions, // Giữ tiếng Nga cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'ja': {
            systemInstructions: LangData.japaneseHostAgentSystemInstructions, // Giữ tiếng Nhật cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'ko': {
            systemInstructions: LangData.koreanHostAgentSystemInstructions, // Giữ tiếng Hàn cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'ar': {
            systemInstructions: LangData.arabicHostAgentSystemInstructions, // Giữ tiếng Ả Rập cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
        'fa': {
            systemInstructions: LangData.persianHostAgentSystemInstructions, // Giữ tiếng Ba Tư cho HostAgent system instructions
            functionDeclarations: [
                LangData.englishRouteToAgentDeclaration, // Giữ tiếng Anh cho function declarations
            ],
        },
    },
    'ConferenceAgent': {
        'en': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions,
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration,
                LangData.englishManageFollowDeclaration,
                LangData.englishManageCalendarDeclaration,
                LangData.englishManageBlacklistDeclaration
            ],
        },
        'vi': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh

            ],
        },
        'zh': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh

            ],
        },
        'de': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh

            ],
        },
        'fr': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh

            ],
        },
        'es': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
            ],
        },
        'ru': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
            ],
        },
        'ja': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
            ],
        },
        'ko': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
            ],
        },
        'ar': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
            ],
        },
        'fa': {
            systemInstructions: LangData.englishConferenceAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetConferencesDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageCalendarDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageBlacklistDeclaration // Luôn dùng tiếng Anh
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
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'zh': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'de': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fr': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'es': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ru': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ja': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ko': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ar': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fa': {
            systemInstructions: LangData.englishJournalAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetJournalsDeclaration, // Luôn dùng tiếng Anh
                LangData.englishManageFollowDeclaration, // Luôn dùng tiếng Anh
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
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'zh': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'de': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fr': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'es': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ru': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ja': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ko': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ar': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fa': {
            systemInstructions: LangData.englishAdminContactAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishSendEmailToAdminDeclaration, // Luôn dùng tiếng Anh
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
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'zh': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'de': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fr': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'es': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ru': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ja': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ko': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ar': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fa': {
            systemInstructions: LangData.englishNavigationAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishNavigationDeclaration, // Luôn dùng tiếng Anh
                LangData.englishOpenGoogleMapDeclaration, // Luôn dùng tiếng Anh
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
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'zh': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'de': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fr': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'es': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ru': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ja': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ko': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'ar': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
            ],
        },
        'fa': {
            systemInstructions: LangData.englishWebsiteInfoAgentSystemInstructions, // Luôn dùng tiếng Anh
            functionDeclarations: [
                LangData.englishGetWebsiteInfoDeclaration, // Luôn dùng tiếng Anh
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

    // Special handling for HostAgent systemInstructions based on targetLang
    let systemInstructionsForAgent: any;
    if (agentId === 'HostAgent') {
        // Try to get the HostAgent instructions in the requested language
        systemInstructionsForAgent = LangData[`${targetLang}HostAgentSystemInstructions` as keyof typeof LangData] || LangData.englishHostAgentSystemInstructions; // Fallback to English if specific language not found
    } else {
        // For other agents, always use the English system instructions
        systemInstructionsForAgent = LangData[`english${agentId}SystemInstructions` as keyof typeof LangData] || "Error: English instructions missing."; // Fallback to error message
    }

    // Always use English function declarations for all agents
    const functionDeclarationsForAgent: FunctionDeclaration[] = [];
    // Populate functionDeclarationsForAgent from the English configuration
    const englishConfig = agentConfigMap['en'];
    if (englishConfig && englishConfig.functionDeclarations) {
         functionDeclarationsForAgent.push(...englishConfig.functionDeclarations);
    } else {
         logToFile(`[Language Config] CRITICAL: English function declarations missing for agent "${agentId}".`);
    }


    // If a language-specific config exists for this agent, we still use its systemInstructions (overridden above for HostAgent)
    // and ignore its functionDeclarations (always using English)
    if (langConfig) {
        logToFile(`[Language Config] Using configuration for Agent: ${agentId}, Language: ${targetLang} (System Instructions based on language, Functions are English)`);
        return {
            systemInstructions: systemInstructionsForAgent,
            functionDeclarations: functionDeclarationsForAgent
        };
    }

    // If no specific language config exists for this agent (shouldn't happen with the current structure, but for robustness)
    // We still return the correct systemInstructions (language-dependent for HostAgent, English otherwise)
    // and the English function declarations.
     logToFile(`[Language Config] WARn: Language config not found for Agent: ${agentId}, Language: ${targetLang}. Using resolved System Instructions and English Functions.`);
     return {
         systemInstructions: systemInstructionsForAgent,
         functionDeclarations: functionDeclarationsForAgent
     };

}