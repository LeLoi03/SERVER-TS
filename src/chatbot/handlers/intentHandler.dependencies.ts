// src/chatbot/handlers/intentHandler.dependencies.ts
import { Socket } from 'socket.io';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from '../../config/config.service';
import {
    Language,
    FrontendAction,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    AgentId,
    ThoughtStep,
    AgentCardRequest,
    AgentCardResponse,
    ChatUpdate
} from '../shared/types';
import { GenerationConfig as SDKGenerationConfig } from '@google/genai'; // Renamed to avoid conflicts

/**
 * Defines the base set of common dependencies shared across all intent handlers (Host and Sub Agents).
 */
export interface BaseIntentHandlerDeps {
    /** An instance of the configuration service to access application settings. */
    configService: ConfigService;
    /** The logging utility function for writing logs to a file. */
    /** A list of allowed sub-agent IDs that the Host Agent can delegate to. */
    allowedSubAgents: AgentId[];
    /** The maximum number of turns the Host Agent can take before potentially escalating or stopping. */
    maxTurnsHostAgent: number;
}

/**
 * Defines custom dependencies specifically for Sub-Agent handlers.
 * Extends `BaseIntentHandlerDeps` and adds Gemini-related specifics for sub-agents.
 */
export interface SubAgentHandlerCustomDeps extends BaseIntentHandlerDeps {
    /** The Gemini service instance configured for sub-agent interactions. */
    geminiServiceForSubAgent: Gemini;
    /** The generation configuration specific to sub-agent Gemini calls. */
    subAgentGenerationConfig: SDKGenerationConfig;
}

/**
 * Defines custom dependencies specifically for Host Agent handlers.
 * Extends `BaseIntentHandlerDeps` and adds Gemini-related specifics for the host agent,
 * along with the ability to call sub-agents.
 */
export interface HostAgentHandlerCustomDeps extends BaseIntentHandlerDeps {
    /** The Gemini service instance configured for host agent interactions. */
    geminiServiceForHost: Gemini;
    /** The generation configuration specific to host agent Gemini calls. */
    hostAgentGenerationConfig: SDKGenerationConfig;
    /**
     * A "bound" function to initiate a sub-agent call.
     * This abstracts away the sub-agent's internal dependencies from the host agent.
     * @param {AgentCardRequest} requestCard - The request details for the sub-agent.
     * @param {string} parentHandlerId - The ID of the parent handler (host agent) initiating this call.
     * @param {Language} language - The current language context.
     * @param {Socket} socket - The client socket.
     * @returns {Promise<AgentCardResponse>} A promise resolving to the sub-agent's response.
     */
    callSubAgentHandler: (
        requestCard: AgentCardRequest,
        parentHandlerId: string,
        language: Language,
        socket: Socket
    ) => Promise<AgentCardResponse>;
}

/**
 * Type definition for a safe emit function, typically used to send updates to the frontend
 * while ensuring logging and error handling.
 * @param {'status_update' | 'chat_result' | 'chat_error' | 'chat_update'} eventName - The name of the socket event to emit.
 * @param {StatusUpdate | ResultUpdate | ErrorUpdate | ChatUpdate} data - The data payload for the event.
 * @param {Socket} socket - The Socket.IO client socket.
 * @param {string} handlerId - A unique ID for the current handler process.
 * @param {ThoughtStep[]} [thoughtsRef] - Optional reference to an array for collecting thought steps.
 * @param {FrontendAction} [finalActionRef] - Optional reference to a final frontend action.
 * @returns {boolean} True if the emit was successful, false otherwise (e.g., if client disconnected).
 */
export type SafeEmitFn = (
    eventName: 'status_update' | 'chat_result' | 'chat_error' | 'chat_update',
    data: StatusUpdate | ResultUpdate | ErrorUpdate | ChatUpdate,
    socket: Socket,
    handlerId: string,
    thoughtsRef?: ThoughtStep[],
    finalActionRef?: FrontendAction
) => boolean;