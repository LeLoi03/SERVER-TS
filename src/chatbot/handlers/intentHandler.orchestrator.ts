// src/chatbot/handlers/intentHandler.orchestrator.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Socket } from 'socket.io';
import logToFile from '../../utils/logger';
import { ChatHistoryItem, FrontendAction, Language, AgentId, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from "../../config/config.service";
import { BaseIntentHandlerDeps, HostAgentHandlerCustomDeps, SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { Part } from '@google/genai';

import { callSubAgent as callSubAgentActual } from './subAgent.handler';
import { handleNonStreaming as handleNonStreamingActual } from './hostAgent.nonStreaming.handler';
import { handleStreaming as handleStreamingActual } from './hostAgent.streaming.handler';

// ... (khai báo biến và try-catch block giữ nguyên) ...
let configService: ConfigService;
let MAX_TURNS_HOST_AGENT: number;
let ALLOWED_SUB_AGENTS: AgentId[];
let geminiApiKey: string; 
let hostAgentModelName: string;
let subAgentModelName: string | undefined;
let hostAgentGenerationConfig: any; 
let subAgentGenerationConfig: any; 
let GEMINI_SERVICE_FOR_HOST: Gemini;
let GEMINI_SERVICE_FOR_SUB_AGENT: Gemini;
let baseDependencies: BaseIntentHandlerDeps;
let subAgentHandlerDependencies: SubAgentHandlerCustomDeps;
let hostAgentDependencies: HostAgentHandlerCustomDeps;
let boundCallSubAgentHandler: (
    requestCard: AgentCardRequest,
    parentHandlerId: string,
    language: Language,
    socket: Socket
) => Promise<AgentCardResponse>;

try {
    configService = container.resolve(ConfigService);
    MAX_TURNS_HOST_AGENT = configService.config.MAX_TURNS_HOST_AGENT;
    ALLOWED_SUB_AGENTS = configService.config.ALLOWED_SUB_AGENTS;
    const key = configService.config.GEMINI_API_KEY;
    if (!key) {
        const errorMsg = "CRITICAL: GEMINI_API_KEY is not configured. The application cannot proceed without an API key.";
        logToFile(errorMsg);
        throw new Error(errorMsg); 
    }
    geminiApiKey = key; 
    hostAgentModelName = configService.config.GEMINI_HOST_AGENT_MODEL_NAME;
    subAgentModelName = configService.config.GEMINI_SUB_AGENT_MODEL_NAME;
    hostAgentGenerationConfig = configService.hostAgentGenerationConfig;
    subAgentGenerationConfig = configService.subAgentGenerationConfig;
    if (!hostAgentModelName) {
        logToFile(`[Orchestrator] Warning: GEMINI_HOST_AGENT_MODEL_NAME not set. Host agent intent handling might not work as expected.`);
    }
    if (!subAgentModelName) {
        logToFile(`[Orchestrator] Warning: GEMINI_SUB_AGENT_MODEL_NAME not set. Sub-agents will use the host agent's model ('${hostAgentModelName}') as fallback.`);
    }
    GEMINI_SERVICE_FOR_HOST = new Gemini(geminiApiKey, hostAgentModelName);
    GEMINI_SERVICE_FOR_SUB_AGENT = new Gemini(geminiApiKey, subAgentModelName || hostAgentModelName);
    baseDependencies = {
        configService,
        logToFile,
        allowedSubAgents: ALLOWED_SUB_AGENTS,
        maxTurnsHostAgent: MAX_TURNS_HOST_AGENT,
    };
    subAgentHandlerDependencies = {
        ...baseDependencies,
        geminiServiceForSubAgent: GEMINI_SERVICE_FOR_SUB_AGENT,
        subAgentGenerationConfig: subAgentGenerationConfig,
    };
    boundCallSubAgentHandler = (
        requestCard: AgentCardRequest,
        parentHandlerId: string,
        language: Language,
        socket: Socket
    ): Promise<AgentCardResponse> => {
        return callSubAgentActual(requestCard, parentHandlerId, language, socket, subAgentHandlerDependencies);
    };
    hostAgentDependencies = {
        ...baseDependencies,
        geminiServiceForHost: GEMINI_SERVICE_FOR_HOST,
        hostAgentGenerationConfig: hostAgentGenerationConfig,
        callSubAgentHandler: boundCallSubAgentHandler,
    };
} catch (err: unknown) {
    const { message, stack } = getErrorMessageAndStack(err);
    logToFile(`CRITICAL ERROR during Orchestrator initialization: ${message}\nStack: ${stack}`);
    throw err; 
}


export async function handleNonStreaming(
    inputParts: Part[],
    historyForHandler: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string // <<< THÊM PARAMETER
): ReturnType<typeof handleNonStreamingActual> {
    if (!hostAgentDependencies) {
        logToFile(`[Orchestrator] ERROR: handleNonStreaming called before hostAgentDependencies were initialized.`);
        throw new Error("Intent handler not initialized. Please check application startup configuration.");
    }
    logToFile(`[Orchestrator] Calling handleNonStreaming for handlerId: ${handlerId}, userId: ${socket.id}` +
              (personalizationData ? `, Personalization: Enabled` : ``) +
              (originalUserFiles && originalUserFiles.length > 0 ? `, Files: ${originalUserFiles.length}` : ``) +
              (pageContextText ? `, PageContext: Present (len ${pageContextText.length})` : ``)); // Log page context
    return handleNonStreamingActual(
        inputParts,
        historyForHandler,
        socket,
        language,
        handlerId,
        hostAgentDependencies,
        frontendMessageId,
        personalizationData,
        originalUserFiles,
        pageContextText // <<< TRUYỀN XUỐNG
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
    pageContextText?: string // <<< THÊM PARAMETER
): ReturnType<typeof handleStreamingActual> {
    if (!hostAgentDependencies) {
        logToFile(`[Orchestrator] ERROR: handleStreaming called before hostAgentDependencies were initialized.`);
        throw new Error("Intent handler not initialized. Please check application startup configuration.");
    }
    logToFile(`[Orchestrator] Calling handleStreaming for handlerId: ${handlerId}, userId: ${socket.id}` +
              (personalizationData ? `, Personalization: Enabled` : ``) +
              (originalUserFiles && originalUserFiles.length > 0 ? `, Files: ${originalUserFiles.length}` : ``) +
              (pageContextText ? `, PageContext: Present (len ${pageContextText.length})` : ``)); // Log page context
    return handleStreamingActual(
        inputParts,
        currentHistoryFromSocket,
        socket,
        language,
        handlerId,
        hostAgentDependencies,
        onActionGenerated,
        frontendMessageId,
        personalizationData,
        originalUserFiles,
        pageContextText // <<< TRUYỀN XUỐNG
    );
}