// src/chatbot/handlers/intentHandler.orchestrator.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { Socket } from 'socket.io';
// Đổi tên import GenerationConfig từ @google/generative-ai để tránh xung đột
import { GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import logToFile from '../../utils/logger';
import { HistoryItem, FrontendAction, Language, AgentId, AgentCardRequest, AgentCardResponse } from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from "../../config/config.service";
// Import các kiểu dependencies mới
import { BaseIntentHandlerDeps, HostAgentHandlerCustomDeps, SubAgentHandlerCustomDeps } from './intentHandler.dependencies';

import { callSubAgent as callSubAgentActual } from './subAgent.handler';
import { handleNonStreaming as handleNonStreamingActual } from './hostAgent.nonStreaming.handler';
import { handleStreaming as handleStreamingActual } from './hostAgent.streaming.handler';

const configService = container.resolve(ConfigService);

// --- Lấy các cấu hình từ ConfigService ---
const MAX_TURNS_HOST_AGENT = configService.config.MAX_TURNS_HOST_AGENT;
const ALLOWED_SUB_AGENTS: AgentId[] = configService.config.ALLOWED_SUB_AGENTS;
const geminiApiKey = configService.config.GEMINI_API_KEY;

// Model names
const hostAgentModelName = configService.config.GEMINI_HOST_AGENT_MODEL_NAME;
const subAgentModelName = configService.config.GEMINI_SUB_AGENT_MODEL_NAME;

// Generation configs (đã được tạo trong ConfigService)
const hostAgentGenerationConfig = configService.hostAgentGenerationConfig;
const subAgentGenerationConfig = configService.subAgentGenerationConfig;


if (!geminiApiKey) {
    logToFile("CRITICAL: GEMINI_API_KEY is not configured.");
    // throw new Error("CRITICAL: GEMINI_API_KEY is not configured.");
}
if (!hostAgentModelName) {
    logToFile(`Warning: GEMINI_HOST_AGENT_MODEL_NAME not set, intent handler might not work as expected.`);
}
if (!subAgentModelName) {
    logToFile(`Warning: GEMINI_SUB_AGENT_MODEL_NAME not set, sub-agents might not work as expected or use host's default.`);
}

// --- Khởi tạo hai instance Gemini riêng biệt ---
const GEMINI_SERVICE_FOR_HOST = new Gemini(geminiApiKey, hostAgentModelName);
const GEMINI_SERVICE_FOR_SUB_AGENT = new Gemini(geminiApiKey, subAgentModelName || hostAgentModelName); // Fallback nếu sub model không set

logToFile(`Intent Handler Orchestrator: Host Model '${hostAgentModelName}', Sub-Agent Model '${subAgentModelName || hostAgentModelName}'`);

// --- Tạo Base Dependencies ---
const baseDependencies: BaseIntentHandlerDeps = {
    configService,
    logToFile,
    allowedSubAgents: ALLOWED_SUB_AGENTS,
    maxTurnsHostAgent: MAX_TURNS_HOST_AGENT,
};

// --- Tạo Dependencies cho SubAgent ---
// Đây là object sẽ được truyền vào callSubAgentActual khi boundCallSubAgentHandler gọi nó
const subAgentHandlerDependencies: SubAgentHandlerCustomDeps = {
    ...baseDependencies,
    geminiServiceForSubAgent: GEMINI_SERVICE_FOR_SUB_AGENT,
    subAgentGenerationConfig: subAgentGenerationConfig,
};

// --- "Curried" or "Bound" version of callSubAgent ---
const boundCallSubAgentHandler = (
    requestCard: AgentCardRequest,
    parentHandlerId: string,
    language: Language,
    socket: Socket
): Promise<AgentCardResponse> => {
    // Truyền subAgentHandlerDependencies đã chuẩn bị
    return callSubAgentActual(requestCard, parentHandlerId, language, socket, subAgentHandlerDependencies);
};

// --- Tạo Dependencies cho HostAgent Handlers ---
const hostAgentDependencies: HostAgentHandlerCustomDeps = {
    ...baseDependencies,
    geminiServiceForHost: GEMINI_SERVICE_FOR_HOST,
    hostAgentGenerationConfig: hostAgentGenerationConfig,
    callSubAgentHandler: boundCallSubAgentHandler,
};

// --- Export các hàm xử lý chính đã được "wired" ---
export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    frontendMessageId?: string
): ReturnType<typeof handleNonStreamingActual> {
    return handleNonStreamingActual(
        userInput, historyForHandler, socket, language, handlerId,
        hostAgentDependencies, // Truyền dependencies của Host Agent
        frontendMessageId
    );
}

export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string
): ReturnType<typeof handleStreamingActual> {
    return handleStreamingActual(
        userInput, currentHistoryFromSocket, socket, language, handlerId,
        hostAgentDependencies, // Truyền dependencies của Host Agent
        onActionGenerated,
        frontendMessageId
    );
}