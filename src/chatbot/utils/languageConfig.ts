// src/chatbot/utils/languageConfig.ts 

import { FunctionDeclaration } from "@google/generative-ai";
import { Language } from '../shared/types'; 
import logToFile from '../utils/logger'; 


import {
    englishSystemInstructions, english_getConferencesDeclaration, english_getJournalsDeclaration, english_getWebsiteInformationDeclaration, 
    english_navigationDeclaration, english_openGoogleMapDeclaration, english_followUnfollowItemDeclaration,
    vietnameseSystemInstructions, vietnam_getConferencesDeclaration, vietnam_getJournalsDeclaration, vietnam_getWebsiteInformationDeclaration, 
    chineseSystemInstructions, china_getConferencesDeclaration, china_getJournalsDeclaration, china_getWebsiteInformationDeclaration, china_drawChartDeclaration, 
    english_sendEmailToAdminDeclaration
} from "../gemini/functionDeclarations";

// --- Define the structure for language-specific configuration ---
interface LanguageConfig {
    systemInstructions: string; // Or potentially a more complex structure if needed
    functionDeclarations: FunctionDeclaration[];
}

// --- Map language codes to their configurations ---
const languageConfigurations: Record<Language, LanguageConfig> = {
    'en': {
        systemInstructions: englishSystemInstructions,
        functionDeclarations: [
            english_getConferencesDeclaration,
            english_getJournalsDeclaration,
            english_getWebsiteInformationDeclaration,
            english_navigationDeclaration,
            english_openGoogleMapDeclaration,
            english_followUnfollowItemDeclaration,
            english_sendEmailToAdminDeclaration

        ],
    },
    'vi': {
        systemInstructions: vietnameseSystemInstructions,
        functionDeclarations: [
            vietnam_getConferencesDeclaration,
            vietnam_getJournalsDeclaration,
            vietnam_getWebsiteInformationDeclaration,
        ],
    },
    'zh': { 
        systemInstructions: chineseSystemInstructions,
        functionDeclarations: [
            china_getConferencesDeclaration,
            china_getJournalsDeclaration,
            china_getWebsiteInformationDeclaration,
            // china_drawChartDeclaration, 
        ],
    },
    // Add configurations for other supported languages here
};

// --- Default language for fallback ---
const DEFAULT_LANGUAGE: Language = 'vi';

// --- Helper function to get the configuration for a given language ---
export function getLanguageConfig(lang: Language | undefined): LanguageConfig {
    const targetLang = lang && languageConfigurations[lang] ? lang : DEFAULT_LANGUAGE;

    if (!lang || !languageConfigurations[lang]) {
        logToFile(`[Language Config] WARN: Config not found for requested language "${lang}". Falling back to default "${DEFAULT_LANGUAGE}".`);
    } else {
         logToFile(`[Language Config] Using configuration for language: ${targetLang}`);
    }

    return languageConfigurations[targetLang];
}



