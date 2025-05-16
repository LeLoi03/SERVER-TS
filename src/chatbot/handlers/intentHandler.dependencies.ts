// src/chatbot/handlers/intentHandler.dependencies.ts
import { Socket } from 'socket.io';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from '../../config/config.service';
import { Language, HistoryItem, FrontendAction, StatusUpdate, ResultUpdate, ErrorUpdate, AgentId, ThoughtStep, AgentCardRequest, AgentCardResponse, ChatUpdate } from '../shared/types';
import type logToFileType from '../../utils/logger';
import { GenerationConfig as SDKGenerationConfig } from '@google/generative-ai'; // Đổi tên để tránh xung đột

// Dependencies chung cho cả Host và Sub Agent logic (nhưng không bao gồm Gemini instance cụ thể)
export interface BaseIntentHandlerDeps {
    configService: ConfigService;
    logToFile: typeof logToFileType;
    allowedSubAgents: AgentId[];
    maxTurnsHostAgent: number;
}

// Dependencies cho SubAgent Handler
export interface SubAgentHandlerCustomDeps extends BaseIntentHandlerDeps {
    geminiServiceForSubAgent: Gemini;
    subAgentGenerationConfig: SDKGenerationConfig;
}

// Dependencies cho HostAgent Handlers
export interface HostAgentHandlerCustomDeps extends BaseIntentHandlerDeps {
    geminiServiceForHost: Gemini;
    hostAgentGenerationConfig: SDKGenerationConfig;
    callSubAgentHandler: ( // Hàm này sẽ nhận các deps cần thiết cho sub-agent
        requestCard: AgentCardRequest,
        parentHandlerId: string,
        language: Language,
        socket: Socket
    ) => Promise<AgentCardResponse>;
}

// Type cho hàm safeEmit (ví dụ, có thể giữ nguyên)
export type SafeEmitFn = (
    eventName: 'status_update' | 'chat_result' | 'chat_error' | 'chat_update',
    data: StatusUpdate | ResultUpdate | ErrorUpdate | ChatUpdate,
    socket: Socket,
    handlerId: string,
    logToFile: typeof logToFileType,
    thoughtsRef?: ThoughtStep[],
    finalActionRef?: FrontendAction
) => boolean;