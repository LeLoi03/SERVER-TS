// src/chatbot/handlers/intentHandler.orchestrator.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Socket } from 'socket.io';
import { ChatHistoryItem, FrontendAction, Language, AgentId, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from "../../config/config.service";
import { BaseIntentHandlerDeps, HostAgentHandlerCustomDeps, SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { Part, GenerationConfig } from '@google/genai';
import { Logger } from 'pino'; // <<< ĐÃ THÊM

import { callSubAgent as callSubAgentActual } from './subAgent.handler';
import { handleNonStreaming as handleNonStreamingActual } from './hostAgent.nonStreaming.handler';
import { handleStreaming as handleStreamingActual } from './hostAgent.streaming.handler';

let configService: ConfigService;
let MAX_TURNS_HOST_AGENT: number;
let ALLOWED_SUB_AGENTS: AgentId[];
let geminiApiKey: string;
let defaultHostAgentModelName: string;
let subAgentModelName: string | undefined;
let subAgentGenerationConfig: any;
let GEMINI_SERVICE_FOR_SUB_AGENT: Gemini;
let baseDependencies: BaseIntentHandlerDeps;
let subAgentHandlerDependencies: SubAgentHandlerCustomDeps;

const MERCURY_MODEL_VALUE = 'gemini-2.5-pro';
const SIRIUS_MODEL_VALUE = 'gemini-2.5-flash';
const NEBULA_MODEL_VALUE = 'gemini-2.5-flash-lite';


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
    subAgentGenerationConfig = configService.subAgentGenerationConfig;
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
    // Re-throw the error to be handled by the application's main error handler
    throw err;
}

const getHostAgentDependencies = (userSelectedModel?: string): HostAgentHandlerCustomDeps => {
    const modelForHost = userSelectedModel || defaultHostAgentModelName;
    if (!modelForHost) {
        const errorMsg = "CRITICAL: No model specified for Host Agent (neither user-selected nor default in config).";
        throw new Error(errorMsg);
    }

    const geminiServiceForHost = new Gemini(geminiApiKey, modelForHost);

    let currentHostAgentGenerationConfig: GenerationConfig = { ...configService.hostAgentGenerationConfig };

    // Điều chỉnh thinkingBudget dựa trên modelForHost
    if (modelForHost === MERCURY_MODEL_VALUE) {
        currentHostAgentGenerationConfig = {
            ...currentHostAgentGenerationConfig,
            thinkingConfig: {
                thinkingBudget: 4096,
            },
        };
    } else if (modelForHost === SIRIUS_MODEL_VALUE) { // Thêm điều kiện cho Sirius
        currentHostAgentGenerationConfig = {
            ...currentHostAgentGenerationConfig,
            thinkingConfig: {
                thinkingBudget: 2048,
            },
        };
    } else if (modelForHost === NEBULA_MODEL_VALUE) { // Thêm điều kiện cho NEBULA
        currentHostAgentGenerationConfig = {
            ...currentHostAgentGenerationConfig,
            thinkingConfig: {
                thinkingBudget: 0,
            },
        };
    }


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
        hostAgentGenerationConfig: currentHostAgentGenerationConfig,
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
    userSelectedModel?: string,
    logger?: Logger, // <<< THÊM MỚI
    performanceCallback?: (metrics: { prep: number, ai: number }) => void // <<< THÊM MỚI
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
        pageContextUrl,
        // <<< TRUYỀN userSelectedModel XUỐNG ĐÂY >>>
        userSelectedModel,
        logger,
        performanceCallback
    );
}