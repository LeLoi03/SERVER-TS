// src/chatbot/handlers/subAgent.handler.ts
import { Socket } from 'socket.io';
import { Tool, Part, GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { ChatHistoryItem, StatusUpdate, FrontendAction, Language, AgentCardRequest, AgentCardResponse, AgentId, ThoughtStep, FunctionHandlerOutput } from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { executeFunction } from '../gemini/functionRegistry';
import { SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Type guard to check if a string is a valid AgentId and is present in the allowed list.
 * @param {string} id - The ID to validate.
 * @param {AgentId[]} allowedAgents - An array of allowed AgentIds.
 * @returns {boolean} True if the ID is a valid and allowed AgentId, false otherwise.
 */
function isValidAgentId(id: string, allowedAgents: AgentId[]): id is AgentId {
    return (allowedAgents as string[]).includes(id);
}

/**
 * Orchestrates the interaction with a sub-agent to fulfill a specific task.
 * This function handles sub-agent validation, prepares input for the LLM,
 * manages LLM interaction (including function calls), and processes the sub-agent's response.
 *
 * @param {AgentCardRequest} requestCard - The request object containing task details for the sub-agent.
 * @param {string} parentHandlerId - The unique ID of the parent handler (e.g., Host Agent) that initiated this sub-agent call.
 * @param {Language} language - The current language context for the interaction.
 * @param {Socket} socket - The client Socket.IO socket, used for emitting status updates.
 * @param {SubAgentHandlerCustomDeps} deps - Dependency injection object containing services and configurations for the sub-agent handler.
 * @returns {Promise<AgentCardResponse>} A Promise that resolves with the sub-agent's response,
 *                                       including status, result data, error messages, frontend actions, and collected thoughts.
 */
export async function callSubAgent(
    requestCard: AgentCardRequest,
    parentHandlerId: string,
    language: Language,
    socket: Socket,
    deps: SubAgentHandlerCustomDeps
): Promise<AgentCardResponse> {
    const {
        geminiServiceForSubAgent,
        subAgentGenerationConfig,
        logToFile, // logToFile is now available via deps, but we use direct import as per requirement.
        allowedSubAgents
    } = deps;

    const subAgentId = requestCard.receiverAgentId;
    // Generate a unique process ID for this specific sub-agent execution
    const subHandlerProcessId = `${parentHandlerId}-Sub-${subAgentId}-${Date.now()}`;
    const socketId = socket.id;
    const subAgentLocalThoughts: ThoughtStep[] = []; // Collect thoughts specific to this sub-agent execution

    /**
     * Helper function to record a thought and emit a status update for the sub-agent.
     * This ensures consistency in how status updates and thoughts are generated.
     * @param {string} step - A unique identifier for the current step (e.g., 'sub_agent_thinking').
     * @param {string} message - A human-readable message describing the step.
     * @param {object} [details] - Optional additional details to include in the status update and thought.
     */
    const recordThoughtAndEmitStatus = (step: string, message: string, details?: object): void => {
        const timestamp = new Date().toISOString();
        const thought: ThoughtStep = {
            step,
            message,
            details,
            timestamp,
            agentId: subAgentId, // Thoughts are by the sub-agent itself
        };
        subAgentLocalThoughts.push(thought);
        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Thought added: Step: ${step}, Message: ${message}`);

        if (socket.connected) {
            try {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: subAgentId, // Ensure agentId is correctly set for frontend
                };
                socket.emit('status_update', statusData);
            } catch (error: unknown) {
                const { message: errMsg } = getErrorMessageAndStack(error);
                logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Error emitting status update for event 'status_update', Step: ${step}: ${errMsg}`);
            }
        } else {
            logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Client disconnected. Skipping status update for step: ${step}`);
        }
    };

    // --- 1. Validate Sub-Agent ID ---
    recordThoughtAndEmitStatus('sub_agent_validation', `Validating sub-agent ID: ${subAgentId}.`);
    if (!isValidAgentId(subAgentId, allowedSubAgents)) {
        const errorMsg = `Invalid or disallowed sub-agent ID: "${subAgentId}".`;
        logToFile(`[${subHandlerProcessId} Socket ${socketId}] CRITICAL: ${errorMsg}`);
        recordThoughtAndEmitStatus('sub_agent_validation_failed', errorMsg, { subAgentIdAttempted: subAgentId, allowedAgents: allowedSubAgents });
        return {
            taskId: requestCard.taskId,
            conversationId: requestCard.conversationId,
            senderAgentId: subAgentId,
            receiverAgentId: requestCard.senderAgentId,
            timestamp: new Date().toISOString(),
            status: 'error',
            errorMessage: errorMsg,
            thoughts: subAgentLocalThoughts
        };
    }

    logToFile(`--- [${subHandlerProcessId} Socket ${socketId}] Calling Sub Agent: ${subAgentId} using model: ${(geminiServiceForSubAgent as any).modelName}, Task ID: ${requestCard.taskId}, Description: "${requestCard.taskDescription?.substring(0, 50)}..." ---`);

    // --- 2. Load Agent Configuration and Tools ---
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, subAgentId);
    const subAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    if (subAgentTools.length > 0) {
        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Loaded ${functionDeclarations.length} functions for sub-agent.`);
    } else {
        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] No functions loaded for sub-agent.`);
    }


    // --- 3. Validate Task Description ---
    const taskDesc = requestCard.taskDescription?.trim();
    if (!taskDesc) {
        const errorMsg = `Sub Agent ${subAgentId} received an empty task description for task ID ${requestCard.taskId}.`;
        logToFile(`[${subHandlerProcessId} Socket ${socketId}] ERROR: ${errorMsg}`);
        recordThoughtAndEmitStatus('sub_agent_input_validation_failed', errorMsg, { taskId: requestCard.taskId });
        return {
            taskId: requestCard.taskId,
            conversationId: requestCard.conversationId,
            senderAgentId: subAgentId,
            receiverAgentId: requestCard.senderAgentId,
            timestamp: new Date().toISOString(),
            status: 'error',
            errorMessage: 'Sub-agent task description cannot be empty.',
            thoughts: subAgentLocalThoughts
        };
    }

    // Prepare input for the sub-agent's LLM
    const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${taskDesc}\nPlease execute.`;
    // Original logic: wrap string in Part[] and then extract text again.
    // Keeping this structure as requested, though direct string might be simpler.
    // const subAgentInputParts: Part[] = [{ text: subAgentInputText }];
    const subAgentIsolatedHistory: ChatHistoryItem[] = []; // Sub-agents typically start with a fresh history for their specific task

    // Initialize result variables
    let subAgentResultData: any = null;
    let subAgentErrorMessage: string | undefined = undefined;
    let subAgentFrontendAction: FrontendAction | undefined = undefined;
    let subAgentStatus: 'success' | 'error' = 'error';

    // --- 4. Define `onSubAgentFunctionStatusUpdate` for `executeFunction` ---
    // This callback is passed to `executeFunction` so it can report its own steps.
    // These steps are then captured by `subAgentLocalThoughts` and emitted to frontend.
    const onSubAgentFunctionStatusUpdate = (eventName: 'status_update', data: StatusUpdate): boolean => {
        if (!socket.connected) {
            logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Client disconnected during function status update. Aborting.`);
            return false;
        }
        try {
            // Ensure agentId and handlerId are consistently set for frontend
            const effectiveAgentId = data.agentId || subAgentId;
            const effectiveHandlerId = subHandlerProcessId;

            const thought: ThoughtStep = {
                step: data.step,
                message: data.message,
                details: data.details,
                timestamp: data.timestamp || new Date().toISOString(),
                agentId: effectiveAgentId,
            };
            subAgentLocalThoughts.push(thought);
            // Emit to frontend, ensuring consistent agentId and handlerId
            socket.emit(eventName, { ...data, agentId: effectiveAgentId, handlerId: effectiveHandlerId });
            return true;
        } catch (error: unknown) {
            const { message: errMsg } = getErrorMessageAndStack(error);
            logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Error emitting function status update for event ${eventName}, Step: ${data.step}: ${errMsg}`);
            return false;
        }
    };

    try {
        recordThoughtAndEmitStatus('sub_agent_thinking', `Sub Agent ${subAgentId} processing task: ${taskDesc.substring(0, 50)}...`);

        // const nextTurnInputForSubAgent: string | Part[] = subAgentInputParts; // <<--- THAY ĐỔI DÒNG NÀY
        const nextTurnInputForSubAgent: string = subAgentInputText; // <<--- SỬA THÀNH STRING

        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Calling Gemini service for sub-agent with input type: ${typeof nextTurnInputForSubAgent === 'string' ? 'string' : 'Part[]'}`); // Log này vẫn sẽ đúng

        const subAgentLlmResult = await geminiServiceForSubAgent.generateTurn(
            nextTurnInputForSubAgent, // <<--- Bây giờ là string
            subAgentIsolatedHistory,
            subAgentGenerationConfig,
            systemInstructions,
            subAgentTools
        );

        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] LLM result: Status ${subAgentLlmResult.status}`);

        // --- 5. Process LLM Result ---
        if (subAgentLlmResult.status === "requires_function_call" && subAgentLlmResult.functionCall) {
            const functionCall = subAgentLlmResult.functionCall;
            logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] LLM requested function call: ${functionCall.name}`);
            recordThoughtAndEmitStatus('sub_agent_function_call_requested', `Sub-agent requested function: ${functionCall.name}`, { functionName: functionCall.name, args: functionCall.args });

            // Execute the function requested by the sub-agent LLM
            const functionOutput: FunctionHandlerOutput = await executeFunction(
                functionCall,
                subAgentId, // The agent making the function call
                subHandlerProcessId, // The ID of the current process
                language,
                onSubAgentFunctionStatusUpdate, // Pass our specific callback
                socket,
                // NO logger parameter here anymore
                requestCard.context // Pass through additional context
            );

            // Process the output from the executed function
            if (functionOutput.modelResponseContent && typeof functionOutput.modelResponseContent === 'string' && functionOutput.modelResponseContent.toLowerCase().startsWith('error:')) {
                subAgentErrorMessage = functionOutput.modelResponseContent;
                subAgentStatus = 'error';
                recordThoughtAndEmitStatus('sub_agent_function_execution_failed', `Function execution returned an error: ${subAgentErrorMessage.substring(0, 100)}...`, { error: subAgentErrorMessage });
            } else {
                subAgentResultData = functionOutput.modelResponseContent;
                subAgentStatus = 'success';
                subAgentFrontendAction = functionOutput.frontendAction;
                recordThoughtAndEmitStatus('sub_agent_function_execution_success', `Function execution successful.`, { resultPreview: JSON.stringify(subAgentResultData)?.substring(0, 100) });
            }

        } else if (subAgentLlmResult.status === "final_text") {
            subAgentResultData = subAgentLlmResult.text || "Sub agent provided a text response.";
            subAgentStatus = 'success';
            recordThoughtAndEmitStatus('sub_agent_text_response_generated', `Sub Agent ${subAgentId} generated a direct text response.`, { textPreview: subAgentResultData?.substring(0, 100) });
        } else {
            // LLM result is an error or unexpected status
            subAgentErrorMessage = subAgentLlmResult.errorMessage || `Error processing task in ${subAgentId}. Unexpected LLM status: ${subAgentLlmResult.status}`;
            subAgentStatus = 'error';
            recordThoughtAndEmitStatus('sub_agent_llm_error', `Sub Agent ${subAgentId} LLM error or unexpected status: ${subAgentErrorMessage}`, { error: subAgentErrorMessage, llmStatus: subAgentLlmResult.status });
        }

    } catch (error: unknown) { // Catch as unknown for safer error handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`[${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] CRITICAL Error during sub-agent processing: ${errorMessage}\nStack: ${errorStack}`);

        // If an errorMessage was already set (e.g., from validation), keep it.
        // Otherwise, set a new error message.
        if (!subAgentErrorMessage) {
            subAgentErrorMessage = `An unexpected system error occurred while Sub Agent ${subAgentId} was processing: ${errorMessage}`;
        }
        subAgentStatus = 'error'; // Ensure status is error in case of critical failure

        recordThoughtAndEmitStatus('sub_agent_critical_error', `A critical system error occurred while Sub Agent ${subAgentId} was processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
    }

    // --- 6. Final Status Update and Response ---
    recordThoughtAndEmitStatus('sub_agent_processing_complete', `Sub Agent ${subAgentId} has completed its task. Final Status: ${subAgentStatus}.`, { finalStatus: subAgentStatus, resultPreview: JSON.stringify(subAgentResultData)?.substring(0, 100) });

    const responseCard: AgentCardResponse = {
        taskId: requestCard.taskId,
        conversationId: requestCard.conversationId,
        senderAgentId: subAgentId, // The sub-agent is the sender of this response card
        receiverAgentId: requestCard.senderAgentId, // The parent agent is the receiver
        timestamp: new Date().toISOString(),
        status: subAgentStatus,
        resultData: subAgentResultData,
        errorMessage: subAgentErrorMessage,
        frontendAction: subAgentFrontendAction,
        thoughts: subAgentLocalThoughts // Return all collected thoughts
    };

    logToFile(`--- [${subHandlerProcessId} Socket ${socketId} Agent:${subAgentId}] Sub Agent finished. Status: ${responseCard.status}, Thoughts collected: ${subAgentLocalThoughts.length} ---`);
    return responseCard;
}