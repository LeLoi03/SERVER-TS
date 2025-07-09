// src/chatbot/handlers/intentHandler.orchestrator.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Socket } from 'socket.io';
import { ChatHistoryItem, FrontendAction, Language, AgentId, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from "../../config/config.service";
import { BaseIntentHandlerDeps, HostAgentHandlerCustomDeps, SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { Part, GenerateContentConfig } from '@google/genai'; // <<< THÊM GenerateContentConfig

import { callSubAgent as callSubAgentActual } from './subAgent.handler';
import { handleNonStreaming as handleNonStreamingActual } from './hostAgent.nonStreaming.handler';
import { handleStreaming as handleStreamingActual } from './hostAgent.streaming.handler';

let configService: ConfigService;
let MAX_TURNS_HOST_AGENT: number;
let ALLOWED_SUB_AGENTS: AgentId[];
let geminiApiKey: string;
let defaultHostAgentModelName: string;
let subAgentModelName: string | undefined;
// Bỏ hostAgentGenerationConfig ở đây, sẽ lấy từ configService và điều chỉnh khi cần
let subAgentGenerationConfig: any;
let GEMINI_SERVICE_FOR_SUB_AGENT: Gemini;
let baseDependencies: BaseIntentHandlerDeps;
let subAgentHandlerDependencies: SubAgentHandlerCustomDeps;

// Giá trị model của Mercury
const MERCURY_MODEL_VALUE = 'gemini-2.5-flash-preview-05-20';

try {
    configService = container.resolve(ConfigService);
    MAX_TURNS_HOST_AGENT = configService.maxTurnsHostAgent;
    ALLOWED_SUB_AGENTS = configService.allowedSubAgents;
    const key = configService.primaryGeminiApiKey;
    if (!key) {
        const errorMsg = "CRITICAL: GEMINI_API_KEY is not configured.";
    
        throw new Error(errorMsg);
    }
    geminiApiKey = key;
    defaultHostAgentModelName = configService.hostAgentModelName;
    subAgentModelName = configService.subAgentModelName;
    // hostAgentGenerationConfig sẽ được lấy và điều chỉnh trong getHostAgentDependencies
    subAgentGenerationConfig = configService.subAgentGenerationConfig; // Giữ nguyên cho sub-agent

    if (!defaultHostAgentModelName) {
    
    }
    if (!subAgentModelName) {
    
    }

    GEMINI_SERVICE_FOR_SUB_AGENT = new Gemini(geminiApiKey, subAgentModelName || defaultHostAgentModelName);

    baseDependencies = {
        configService,
        allowedSubAgents: ALLOWED_SUB_AGENTS,
        maxTurnsHostAgent: MAX_TURNS_HOST_AGENT,
    };
    subAgentHandlerDependencies = {
        ...baseDependencies,
        geminiServiceForSubAgent: GEMINI_SERVICE_FOR_SUB_AGENT,
        subAgentGenerationConfig: subAgentGenerationConfig,
    };

} catch (err: unknown) {
    const { message, stack } = getErrorMessageAndStack(err);

    throw err;
}

const getHostAgentDependencies = (userSelectedModel?: string): HostAgentHandlerCustomDeps => {
    const modelForHost = userSelectedModel || defaultHostAgentModelName;
    if (!modelForHost) {
        const errorMsg = "CRITICAL: No model specified for Host Agent (neither user-selected nor default in config).";
    
        throw new Error(errorMsg);
    }

    const geminiServiceForHost = new Gemini(geminiApiKey, modelForHost);

    // Lấy generation config gốc từ configService
    let currentHostAgentGenerationConfig: GenerateContentConfig = { ...configService.hostAgentGenerationConfig };

    // Kiểm tra nếu model được chọn là Mercury và thêm/ghi đè thinkingConfig
    if (modelForHost === MERCURY_MODEL_VALUE) {
    
        currentHostAgentGenerationConfig = {
            ...currentHostAgentGenerationConfig,
            thinkingConfig: { // Thêm hoặc ghi đè thinkingConfig
                thinkingBudget: 8000,
            },
        };
    
    } else {
        
    }
    // Log toàn bộ config sẽ được sử dụng (cẩn thận nếu có thông tin nhạy cảm)
    //


    const boundCallSubAgentHandler = (
        requestCard: AgentCardRequest,
        parentHandlerId: string,
        language: Language,
        socket: Socket
    ): Promise<AgentCardResponse> => {
        return callSubAgentActual(requestCard, parentHandlerId, language, socket, subAgentHandlerDependencies);
    };

    return {
        ...baseDependencies,
        geminiServiceForHost: geminiServiceForHost,
        hostAgentGenerationConfig: currentHostAgentGenerationConfig, // <<< SỬ DỤNG CONFIG ĐÃ ĐIỀU CHỈNH
        callSubAgentHandler: boundCallSubAgentHandler,
    };
};


export async function handleNonStreaming(
    inputParts: Part[],
    historyForHandler: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string,
    pageContextUrl?: string,
    userSelectedModel?: string
): ReturnType<typeof handleNonStreamingActual> {
    const hostAgentDeps = getHostAgentDependencies(userSelectedModel);
    if (!hostAgentDeps) {
        const errorMsg = "[Orchestrator] ERROR: handleNonStreaming - hostAgentDependencies could not be initialized.";
    
        throw new Error(errorMsg);
    }

    return handleNonStreamingActual(
        inputParts,
        historyForHandler,
        socket,
        language,
        handlerId,
        hostAgentDeps,
        frontendMessageId,
        personalizationData,
        originalUserFiles,
        pageContextText,
        pageContextUrl
    );
}

export async function handleStreaming(
    inputParts: Part[],
    currentHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string,
    pageContextUrl?: string,
    userSelectedModel?: string
): ReturnType<typeof handleStreamingActual> {
    const hostAgentDeps = getHostAgentDependencies(userSelectedModel);
    if (!hostAgentDeps) {
        const errorMsg = "[Orchestrator] ERROR: handleStreaming - hostAgentDependencies could not be initialized.";
        throw new Error(errorMsg);
    }
    
    return handleStreamingActual(
        inputParts,
        currentHistoryFromSocket,
        socket,
        language,
        handlerId,
        hostAgentDeps,
        onActionGenerated,
        frontendMessageId,
        personalizationData,
        originalUserFiles,
        pageContextText,
        pageContextUrl
    );
}