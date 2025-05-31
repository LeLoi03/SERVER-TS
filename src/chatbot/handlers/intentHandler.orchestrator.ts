// src/chatbot/handlers/intentHandler.orchestrator.ts
import 'reflect-metadata'; // Required for tsyringe dependency injection
import { container } from 'tsyringe';
import { Socket } from 'socket.io';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { ChatHistoryItem, FrontendAction, Language, AgentId, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { ConfigService } from "../../config/config.service";
// Import the new dependency types
import { BaseIntentHandlerDeps, HostAgentHandlerCustomDeps, SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility for robust error handling

// Import the actual handler implementations (these are the functions that will be "wired")
import { callSubAgent as callSubAgentActual } from './subAgent.handler';
import { handleNonStreaming as handleNonStreamingActual } from './hostAgent.nonStreaming.handler';
import { handleStreaming as handleStreamingActual } from './hostAgent.streaming.handler';
import { Part } from '@google/genai'; // If not already imported via shared/types

// --- Declare variables at the top level, potentially with undefined or null initial values ---
// These will be assigned within the try block. If try fails, they remain undefined/null.
let configService: ConfigService;

let MAX_TURNS_HOST_AGENT: number;
let ALLOWED_SUB_AGENTS: AgentId[];
let geminiApiKey: string; // We'll assert this is a string after the check

let hostAgentModelName: string;
let subAgentModelName: string | undefined;

let hostAgentGenerationConfig: any; // Use proper type from SDK if available
let subAgentGenerationConfig: any; // Use proper type from SDK if available

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
    // Resolve ConfigService using tsyringe container
    configService = container.resolve(ConfigService);

    // --- Retrieve configurations from ConfigService ---
    MAX_TURNS_HOST_AGENT = configService.config.MAX_TURNS_HOST_AGENT;
    ALLOWED_SUB_AGENTS = configService.config.ALLOWED_SUB_AGENTS;
    const key = configService.config.GEMINI_API_KEY;

    // --- Critical Configuration Checks ---
    if (!key) {
        const errorMsg = "CRITICAL: GEMINI_API_KEY is not configured. The application cannot proceed without an API key.";
        logToFile(errorMsg);
        // This will prevent the module from fully loading and subsequent code from running.
        throw new Error(errorMsg); // Throw an error that will be caught by the outer catch block
    }
    geminiApiKey = key; // Assert that it's a string after the check
    // logToFile(`[Orchestrator] GEMINI_API_KEY is configured.`);

    // Model names
    hostAgentModelName = configService.config.GEMINI_HOST_AGENT_MODEL_NAME;
    subAgentModelName = configService.config.GEMINI_SUB_AGENT_MODEL_NAME;

    // Generation configs (already generated/loaded within ConfigService)
    hostAgentGenerationConfig = configService.hostAgentGenerationConfig;
    subAgentGenerationConfig = configService.subAgentGenerationConfig;

    if (!hostAgentModelName) {
        logToFile(`[Orchestrator] Warning: GEMINI_HOST_AGENT_MODEL_NAME not set. Host agent intent handling might not work as expected.`);
    }
    if (!subAgentModelName) {
        logToFile(`[Orchestrator] Warning: GEMINI_SUB_AGENT_MODEL_NAME not set. Sub-agents will use the host agent's model ('${hostAgentModelName}') as fallback.`);
    }

    // --- Initialize two separate Gemini instances ---
    GEMINI_SERVICE_FOR_HOST = new Gemini(geminiApiKey, hostAgentModelName);
    GEMINI_SERVICE_FOR_SUB_AGENT = new Gemini(geminiApiKey, subAgentModelName || hostAgentModelName);

    // logToFile(`[Orchestrator] Initialized Gemini services. Host Model: '${hostAgentModelName}', Sub-Agent Model: '${subAgentModelName || hostAgentModelName}'.`);

    // --- Create Base Dependencies ---
    baseDependencies = {
        configService,
        logToFile,
        allowedSubAgents: ALLOWED_SUB_AGENTS,
        maxTurnsHostAgent: MAX_TURNS_HOST_AGENT,
    };
    // logToFile(`[Orchestrator] Base dependencies prepared.`);

    // --- Create Dependencies for SubAgent Handler ---
    subAgentHandlerDependencies = {
        ...baseDependencies,
        geminiServiceForSubAgent: GEMINI_SERVICE_FOR_SUB_AGENT,
        subAgentGenerationConfig: subAgentGenerationConfig,
    };
    // logToFile(`[Orchestrator] Sub-Agent handler dependencies prepared.`);

    /**
     * A "curried" or "bound" version of the `callSubAgentActual` function.
     * This function wraps the original `callSubAgentActual` and injects its specific dependencies.
     * It simplifies the signature for callers, as they don't need to pass all internal dependencies.
     * @param {AgentCardRequest} requestCard - The request details for the sub-agent.
     * @param {string} parentHandlerId - The ID of the parent handler initiating this sub-agent call.
     * @param {Language} language - The current language context.
     * @param {Socket} socket - The client socket.
     * @returns {Promise<AgentCardResponse>} The response from the sub-agent.
     */
    boundCallSubAgentHandler = (
        requestCard: AgentCardRequest,
        parentHandlerId: string,
        language: Language,
        socket: Socket
    ): Promise<AgentCardResponse> => {
        return callSubAgentActual(requestCard, parentHandlerId, language, socket, subAgentHandlerDependencies);
    };
    // logToFile(`[Orchestrator] 'boundCallSubAgentHandler' created.`);

    // --- Create Dependencies for HostAgent Handlers ---
    hostAgentDependencies = {
        ...baseDependencies,
        geminiServiceForHost: GEMINI_SERVICE_FOR_HOST,
        hostAgentGenerationConfig: hostAgentGenerationConfig,
        callSubAgentHandler: boundCallSubAgentHandler,
    };
    // logToFile(`[Orchestrator] Host Agent handler dependencies prepared, including bound sub-agent caller.`);

    // logToFile(`[Orchestrator] Intent handler functions ready for export.`);

} catch (err: unknown) {
    const { message, stack } = getErrorMessageAndStack(err);
    logToFile(`CRITICAL ERROR during Orchestrator initialization: ${message}\nStack: ${stack}`);
    // If orchestrator fails to initialize, the application cannot function.
    // Instead of process.exit(1) here, we re-throw to allow the calling module to handle it,
    // which is more robust for modules. The top-level application entry point
    // (e.g., `main.ts` or `app.ts`) should then catch this and call `process.exit(1)`.
    throw err; // Re-throw the error to indicate initialization failure
}

// --- Export the main "wired" handler functions at the top level ---
// These functions will now rely on the variables assigned *before* the try-catch block.
// If the try-catch block failed, these variables will remain in their initial (e.g., undefined) state,
// leading to runtime errors if the functions are called, or preventing module import if the thrown error
// is caught by the module loader.
/**
 * Handles non-streaming user input using the Host Agent.
 * This function is the entry point for non-streaming chat interactions.
 * @param {string} inputParts - The user's current input.
 * @param {ChatHistoryItem[]} historyForHandler - The relevant chat history for the handler.
 * @param {Socket} socket - The client socket.
 * @param {Language} language - The current language.
 * @param {string} handlerId - A unique ID for the current chat interaction process.
 * @param {string} [frontendMessageId] - Optional ID for correlating with frontend messages.
 * @returns {ReturnType<typeof handleNonStreamingActual>} The result of the non-streaming interaction.
 */
export async function handleNonStreaming(
    inputParts: Part[],
    historyForHandler: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[] // <<< THÊM PARAMETER
): ReturnType<typeof handleNonStreamingActual> {
    if (!hostAgentDependencies) {
        logToFile(`[Orchestrator] ERROR: handleNonStreaming called before hostAgentDependencies were initialized.`);
        throw new Error("Intent handler not initialized. Please check application startup configuration.");
    }
    logToFile(`[Orchestrator] Calling handleNonStreaming for handlerId: ${handlerId}, userId: ${socket.id}` +
              (personalizationData ? `, Personalization: Enabled` : ``) +
              (originalUserFiles && originalUserFiles.length > 0 ? `, Files: ${originalUserFiles.length}` : ``));
    return handleNonStreamingActual(
        inputParts,
        historyForHandler,
        socket,
        language,
        handlerId,
        hostAgentDependencies,
        frontendMessageId,
        personalizationData,
        originalUserFiles // <<< TRUYỀN XUỐNG
    );
}


/**
 * Handles streaming user input using the Host Agent.
 * This function is the entry point for streaming chat interactions.
 * @param {string} inputParts - The user's current input.
 * @param {ChatHistoryItem[]} currentHistoryFromSocket - The current chat history from the socket.
 * @param {Socket} socket - The client socket.
 * @param {Language} language - The current language.
 * @param {string} handlerId - A unique ID for the current chat interaction process.
 * @param {(action: FrontendAction) => void} [onActionGenerated] - Optional callback for frontend actions.
 * @param {string} [frontendMessageId] - Optional ID for correlating with frontend messages.
 * @returns {ReturnType<typeof handleStreamingActual>} The result of the streaming interaction.
 */
export async function handleStreaming(
    inputParts: Part[],
    currentHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[] // <<< THÊM PARAMETER
): ReturnType<typeof handleStreamingActual> {
    if (!hostAgentDependencies) {
        logToFile(`[Orchestrator] ERROR: handleStreaming called before hostAgentDependencies were initialized.`);
        throw new Error("Intent handler not initialized. Please check application startup configuration.");
    }
    logToFile(`[Orchestrator] Calling handleStreaming for handlerId: ${handlerId}, userId: ${socket.id}` +
              (personalizationData ? `, Personalization: Enabled` : ``) +
              (originalUserFiles && originalUserFiles.length > 0 ? `, Files: ${originalUserFiles.length}` : ``));
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
        originalUserFiles // <<< TRUYỀN XUỐNG
    );
}