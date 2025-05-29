// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
// Import types from the new SDK
import {
    Tool,
    Part,
    FunctionCall,
    FunctionResponse,
    GenerateContentResponse, // New SDK type for stream chunks
    GenerateContentConfig
} from '@google/genai';

import {
    ChatHistoryItem,
    FrontendAction,
    Language,
    AgentId,
    ThoughtStep,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    ChatUpdate,
    AgentCardRequest,
    AgentCardResponse,
    PersonalizationPayload // <<< IMPORT

} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

// Define RouteToAgentArgs if it's not already defined elsewhere accessible
interface RouteToAgentArgs {
    targetAgent: string;
    taskDescription: string;
}

// Type guard to check if the args object is a valid RouteToAgentArgs
function isRouteToAgentArgs(args: any): args is RouteToAgentArgs {
    if (typeof args !== 'object' || args === null) {
        return false;
    }
    return typeof args.targetAgent === 'string' &&
        typeof args.taskDescription === 'string';
}


export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null // <<< ADDED

): Promise<ChatHistoryItem[] | void> {
    const {
        geminiServiceForHost,
        hostAgentGenerationConfig, // Should be compatible with GenerateContentConfig
        logToFile,
        allowedSubAgents,
        maxTurnsHostAgent,
        callSubAgentHandler
    } = deps;

    const socketId = socket.id;
    const conversationId = handlerId;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput.substring(0, 50)}...", Lang: ${language}` + (personalizationData ? `, Personalization: Enabled` : ``) + ` ---`);
    if (personalizationData) {
        logToFile(`[DEBUG ${handlerId}] Streaming Personalization Data: ${JSON.stringify(personalizationData)}`);
    }

    const currentAgentIdForHost: AgentId = 'HostAgent';
    // VVV PASS personalizationData to getAgentLanguageConfig VVV
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(
        language,
        currentAgentIdForHost,
        personalizationData // <<< PASS
    );

    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let history: ChatHistoryItem[] = [...currentHistoryFromSocket];
    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const isEditContextOrAlreadyProcessed = frontendMessageId &&
        history.length > 0 &&
        history[history.length - 1].role === 'user' &&
        history[history.length - 1].uuid === frontendMessageId &&
        history[history.length - 1].parts[0]?.text === userInput;

    if (!isEditContextOrAlreadyProcessed) {
        logToFile(`[${handlerId} Streaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}`);
        history.push({
            role: 'user', parts: [{ text: userInput }],
            timestamp: new Date(), uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
        });
    } else {
        logToFile(`[${handlerId} Streaming - UserTurn] Skipping adding userTurn (edit/processed). frontendMessageId: ${frontendMessageId}`);
    }

    const safeEmitStreaming = (
        eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Streaming Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && data.type === 'status') {
                if (!data.agentId || data.agentId === 'HostAgent') { // Only add HostAgent thoughts here
                    allThoughtsCollectedStreaming.push({
                        step: data.step, message: data.message, agentId: 'HostAgent',
                        timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                    });
                }
                // Ensure agentId is set for the emitted event, defaulting to HostAgent if not specified by a sub-agent
                dataToSend.agentId = data.agentId || 'HostAgent';
            }

            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend.thoughts = [...allThoughtsCollectedStreaming]; // Send all collected thoughts
                if (eventName === 'chat_result' && finalFrontendActionStreaming) {
                    (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
                }
            }
            socket.emit(eventName, dataToSend);
            logToFile(`[${handlerId} Streaming Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}, Agent: ${dataToSend.agentId || 'N/A'}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Streaming Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`);
            return false;
        }
    };

    const hostAgentStreamingStatusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        // Ensure agentId is HostAgent for status updates originating from here
        return safeEmitStreaming(eventName, { ...data, agentId: 'HostAgent' });
    };

    // Updated to use GenerateContentResponse from the new SDK
    async function processAndEmitStream(stream: AsyncGenerator<GenerateContentResponse>): Promise<{ fullText: string } | null> {
        let accumulatedText = "";
        let streamFinishedSuccessfully = false; // Changed variable name for clarity
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) return null;

        try {
            for await (const chunk of stream) {
                if (!socket.connected) { logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected.`); return null; }
                // Use the .text getter from the new SDK's GenerateContentResponse
                const chunkText = chunk.text; // text is a getter in the new SDK
                if (chunkText !== undefined) { // Getter might return undefined
                    accumulatedText += chunkText;
                    if (!safeEmitStreaming('chat_update', { type: 'partial_result', textChunk: chunkText })) return null;
                }
                // Check for function calls or other data in chunks if necessary, though typically stream is for text.
                // The primary function call check is done on the *first* chunk before calling this function.
            }
            streamFinishedSuccessfully = true;
            logToFile(`[${handlerId} Stream Processing - ${socketId}] Stream finished successfully. Accumulated text length: ${accumulatedText.length}`);
            return { fullText: accumulatedText };
        } catch (error: any) {
            logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
            // Do not re-throw here, let the caller handle it or return null
            // based on socket connection status.
            if (socket.connected) {
                safeEmitStreaming('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_processing_error' });
            }
            return null; // Indicate failure
        } finally {
            if (!streamFinishedSuccessfully) {
                logToFile(`[${handlerId} Stream Processing Warn - ${socketId}] Stream loop exited unexpectedly or with an error.`);
            }
        }
    }

    try {
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        let nextTurnInputForHost: string | Part[] = userInput;
        let currentHostTurn = 1;

        while (currentHostTurn <= maxTurnsHostAgent) {
            logToFile(`--- [${handlerId} HostAgent Streaming Turn ${currentHostTurn} Start - Socket ${socketId}] Input type: ${typeof nextTurnInputForHost === 'string' ? 'string' : 'Part[]'}, History size: ${history.length} ---`);
            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process based on previous action (Turn ${currentHostTurn})...` : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected before Host model call.`); return; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | import('@google/genai').Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig,
                systemInstruction: systemInstructions, // This now potentially includes personalization
                tools: hostAgentTools
            };

            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForHost,
                history,
                combinedConfig
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after Host model call initiated.`); return; }

            if (hostAgentLLMResult.error) {
                logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] HostAgent model error: ${hostAgentLLMResult.error}`);
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return history; // Return current history on error
            } else if (hostAgentLLMResult.functionCall) { // Note: gemini.ts returns singular functionCall
                const functionCall = hostAgentLLMResult.functionCall; // Already singular
                const modelFunctionCallTurn: ChatHistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} Streaming T${currentHostTurn}] HostAgent requests function: ${functionCall.name}. History size: ${history.length}`);

                let functionResponsePartForHistory: Part;
                // let functionErrorOccurred = false; // Not strictly needed

                if (functionCall.name === 'routeToAgent') {
                    if (isRouteToAgentArgs(functionCall.args)) {
                        const routeArgs = functionCall.args;
                        hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: routeArgs });

                        if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                            functionResponsePartForHistory = {
                                functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } }
                            };
                            // functionErrorOccurred = true;
                        } else {
                            const requestCard: AgentCardRequest = {
                                taskId: uuidv4(), conversationId, senderAgentId: 'HostAgent',
                                receiverAgentId: routeArgs.targetAgent as AgentId,
                                timestamp: new Date().toISOString(), taskDescription: routeArgs.taskDescription,
                                context: { userToken: socket.data.token, language },
                            };
                            const subAgentResponse: AgentCardResponse = await callSubAgentHandler(
                                requestCard, handlerId, language, socket
                            );

                            if (subAgentResponse.thoughts && subAgentResponse.thoughts.length > 0) {
                                // Add sub-agent thoughts to the main collection

                                allThoughtsCollectedStreaming.push(...subAgentResponse.thoughts);
                            }

                            if (subAgentResponse.status === 'success') {
                                functionResponsePartForHistory = {
                                    functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } }
                                };
                                if (subAgentResponse.frontendAction) {
                                    finalFrontendActionStreaming = subAgentResponse.frontendAction;
                                    onActionGenerated?.(finalFrontendActionStreaming);
                                }
                            } else {
                                functionResponsePartForHistory = {
                                    functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } }
                                };
                                // functionErrorOccurred = true;
                            }
                        }
                    } else { // Invalid args for routeToAgent
                        functionResponsePartForHistory = {
                            functionResponse: { name: functionCall.name, response: { error: "Routing failed: Invalid or missing arguments for routeToAgent." } }
                        };
                        // functionErrorOccurred = true;
                        logToFile(`[${handlerId} Streaming T${currentHostTurn}] Invalid or missing routeToAgent args: ${JSON.stringify(functionCall.args)}`);
                        hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: 'Failed to understand routing instruction.', details: functionCall.args });
                    }
                } else { // Function name not 'routeToAgent'
                    const errMsg = `Internal config error: HostAgent (streaming) cannot directly call '${functionCall.name}'.`;
                    functionResponsePartForHistory = {
                        functionResponse: { name: functionCall.name, response: { error: errMsg } }
                    };
                    // functionErrorOccurred = true;
                    hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'host_agent_config_error', message: errMsg, details: { functionName: functionCall.name } });
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after routing/function execution.`); return; }

                const functionResponseTurn: ChatHistoryItem = { role: 'function', parts: [functionResponsePartForHistory] };
                history.push(functionResponseTurn);
                logToFile(`[${handlerId} Streaming T${currentHostTurn}] Appended function response for ${functionCall.name}. History size: ${history.length}`);

                nextTurnInputForHost = ""; // Reset input for next turn
                currentHostTurn++;
                continue; // Continue to the next iteration of the while loop

            } else if (hostAgentLLMResult.stream) { // Stream is available for text response
                hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);

                if (streamOutput && socket.connected) {
                    const botMessageUuid = uuidv4();
                    const finalModelTurn: ChatHistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }], uuid: botMessageUuid, timestamp: new Date() };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} Streaming - Final Result] Thoughts collected: ${JSON.stringify(allThoughtsCollectedStreaming)}`);
                    safeEmitStreaming('chat_result', { type: 'result', message: streamOutput.fullText, id: botMessageUuid });
                    return history; // Successfully processed and returned history
                } else { // Stream processing failed or client disconnected
                    logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] Failed to process final stream or client disconnected.`);
                    if (socket.connected) { // Only emit error if still connected
                        safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to process final stream response.', step: 'streaming_response_error' });
                    }
                    return history; // Return current history
                }
            } else { // Unexpected response from geminiService.generateStream
                logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] HostAgent model unexpected response (streaming).`);
                safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response (streaming).', step: 'unknown_host_llm_status_stream' });
                return history; // Return current history
            }
        } // End while loop

        if (currentHostTurn > maxTurnsHostAgent) {
            logToFile(`[${handlerId} Streaming Error] Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop (streaming).', step: 'max_turns_exceeded_stream' });
            return history; // Return current history
        }

    } catch (error: any) {
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        logToFile(`[${handlerId} Streaming CRITICAL Error - ${socketId} Lang: ${language}] ${criticalErrorMsg}\nStack: ${error.stack}`);
        if (socket.connected) {
            safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'unknown_handler_error_stream' });
        }
        return history; // Return current history on critical error
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }

    // This part should ideally not be reached

    logToFile(`[${handlerId} Streaming WARN] Reached end of handler unexpectedly. Returning current history.`);
    return history;
}