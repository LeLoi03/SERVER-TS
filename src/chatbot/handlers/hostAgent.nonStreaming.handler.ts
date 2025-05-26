// src/chatbot/handlers/hostAgent.nonStreaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
    Tool,
    Part,
    FunctionResponse,
    GenerateContentConfig,
    FunctionCall // Ensure FunctionCall is imported if not already via gemini.ts
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
    AgentCardRequest,
    AgentCardResponse
} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

interface NonStreamingHandlerResult {
    history: ChatHistoryItem[];
    action?: FrontendAction;
}

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


export async function handleNonStreaming(
    userInput: string,
    historyForHandler: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    frontendMessageId?: string
): Promise<NonStreamingHandlerResult | void> {
    const {
        geminiServiceForHost,
        hostAgentGenerationConfig,
        logToFile,
        allowedSubAgents,
        maxTurnsHostAgent,
        callSubAgentHandler
    } = deps;

    const socketId = socket.id;
    const conversationId = handlerId;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput.substring(0, 50)}...", Lang: ${language} ---`);

    const currentAgentId: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let history: ChatHistoryItem[] = [...historyForHandler];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;
    let currentTurn = 1;

    const isEditContextOrAlreadyProcessed = frontendMessageId &&
        history.length > 0 &&
        history[history.length - 1].role === 'user' &&
        history[history.length - 1].uuid === frontendMessageId &&
        history[history.length - 1].parts[0]?.text === userInput;

    if (!isEditContextOrAlreadyProcessed) {
        logToFile(`[${handlerId} NonStreaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}`);
        history.push({
            role: 'user', parts: [{ text: userInput }],
            timestamp: new Date(), uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
        });
    } else {
        logToFile(`[${handlerId} NonStreaming - UserTurn] Skipping adding userTurn (edit/processed). frontendMessageId: ${frontendMessageId}`);
    }

    const safeEmit = (eventName: 'status_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({
                    step: data.step, message: data.message, agentId: currentAgentId,
                    timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                });
            }
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && !dataToSend.agentId) dataToSend.agentId = currentAgentId;

            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend = { ...dataToSend, thoughts: [...thoughts] };
                if (eventName === 'chat_result' && finalFrontendAction) {
                    (dataToSend as ResultUpdate).action = finalFrontendAction;
                }
            }
            socket.emit(eventName, dataToSend);
            logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}, Agent: ${dataToSend.agentId || 'N/A'}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
            return false;
        }
    };

    const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmit(eventName, data);
    };

    try {
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        let nextTurnInputForHost: string | Part[] = userInput;

        while (currentTurn <= maxTurnsHostAgent) {
            logToFile(`--- [${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Input type: ${typeof nextTurnInputForHost === 'string' ? 'string' : 'Part[]'}, History size: ${history.length} ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? `Thinking based on previous action (Turn ${currentTurn})...` : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected before Model call.`); return; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | import('@google/genai').Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig,
                systemInstruction: systemInstructions,
                tools: tools
            };

            const modelResult = await geminiServiceForHost.generateTurn(
                nextTurnInputForHost,
                history,
                combinedConfig
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected after Model call.`); return; }

            if (modelResult.status === "final_text") {
                statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow instructions." : "Okay.");
                const botMessageUuid = uuidv4();
                const finalModelTurn: ChatHistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }], uuid: botMessageUuid, timestamp: new Date() };
                history.push(finalModelTurn);
                logToFile(`[${handlerId} NonStreaming - Final Text] Appended final HostAgent response. History size: ${history.length}`);
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText, id: botMessageUuid });
                return { history: history, action: finalFrontendAction };
            }
            else if (modelResult.status === "error") {
                logToFile(`[${handlerId} NonStreaming Error T${currentTurn}] HostAgent model error: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `Error processing your request (Turn ${currentTurn}).`, step: 'host_llm_error' });
                return { history: history };
            }
            else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                const functionCall = modelResult.functionCall;
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model',
                    parts: [{ functionCall: functionCall }]
                };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} NonStreaming T${currentTurn}] HostAgent requests function: ${functionCall.name}. History size: ${history.length}`);

                let functionResponsePartForHistory: Part;
                let functionErrorOccurred = false;

                if (functionCall.name === 'routeToAgent') {
                    // Use the type guard here
                    if (isRouteToAgentArgs(functionCall.args)) {
                        const routeArgs = functionCall.args; // Now safely typed as RouteToAgentArgs
                        statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: routeArgs });

                        // The original checks for routeArgs.targetAgent and routeArgs.taskDescription
                        // are implicitly covered by the type guard, but explicit checks can remain for clarity if desired.
                        // if (!routeArgs.targetAgent || !routeArgs.taskDescription) { ... } // This condition is less likely if isRouteToAgentArgs passed

                        if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                            functionResponsePartForHistory = {
                                functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } }
                            };
                            functionErrorOccurred = true;
                            logToFile(`[${handlerId} NonStreaming T${currentTurn}] Disallowed agent: ${routeArgs.targetAgent}`);
                        } else {
                            const requestCard: AgentCardRequest = {
                                taskId: uuidv4(), conversationId, senderAgentId: 'HostAgent',
                                receiverAgentId: routeArgs.targetAgent as AgentId, // Already checked it's a string
                                timestamp: new Date().toISOString(), taskDescription: routeArgs.taskDescription, // Already checked it's a string
                                context: { userToken: socket.data.token, language },
                            };
                            const subAgentResponse: AgentCardResponse = await callSubAgentHandler(
                                requestCard, handlerId, language, socket
                            );

                            if (subAgentResponse.thoughts && subAgentResponse.thoughts.length > 0) {
                                thoughts.push(...subAgentResponse.thoughts);
                            }

                            if (subAgentResponse.status === 'success') {
                                functionResponsePartForHistory = {
                                    functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } }
                                };
                                if (subAgentResponse.frontendAction) {
                                    finalFrontendAction = subAgentResponse.frontendAction;
                                }
                            } else {
                                functionResponsePartForHistory = {
                                    functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } }
                                };
                                functionErrorOccurred = true;
                            }
                        }
                    } else {
                        // Handle cases where args are not in the expected RouteToAgentArgs format
                        functionResponsePartForHistory = {
                            functionResponse: { name: functionCall.name, response: { error: "Routing failed: Invalid or missing arguments for routeToAgent." } }
                        };
                        functionErrorOccurred = true;
                        logToFile(`[${handlerId} NonStreaming T${currentTurn}] Invalid or missing routeToAgent args: ${JSON.stringify(functionCall.args)}`);
                        statusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: 'Failed to understand routing instruction.', details: functionCall.args });
                    }
                } else {
                    const errMsg = `Internal config error: HostAgent cannot directly call '${functionCall.name}'.`;
                    functionResponsePartForHistory = {
                        functionResponse: { name: functionCall.name, response: { error: errMsg } }
                    };
                    functionErrorOccurred = true;
                    statusUpdateCallback('status_update', { type: 'status', step: 'host_agent_config_error', message: errMsg, details: { functionName: functionCall.name } });
                    logToFile(`[${handlerId} NonStreaming T${currentTurn}] HostAgent invalid direct call: ${functionCall.name}`);
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected after function execution.`); return; }

                const functionResponseTurn: ChatHistoryItem = {
                    role: 'function',
                    parts: [functionResponsePartForHistory]
                };
                history.push(functionResponseTurn);
                logToFile(`[${handlerId} NonStreaming T${currentTurn}] Appended function response for ${functionCall.name}. History size: ${history.length}`);

                nextTurnInputForHost = "";
                currentTurn++;
                continue;
            }
            else {
                logToFile(`[${handlerId} NonStreaming Error T${currentTurn}] HostAgent model unexpected status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return { history: history };
            }
        }

        if (currentTurn > maxTurnsHostAgent) {
            logToFile(`[${handlerId} NonStreaming Error] Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck in a loop.', step: 'max_turns_exceeded' });
            return { history: history };
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
        logToFile(`[${handlerId} NonStreaming CRITICAL Error - ${socketId}] ${errorMsg}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: errorMsg, step: 'unknown_handler_error' });
        return { history: history };
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }

    logToFile(`[${handlerId} NonStreaming WARN] Reached end of handler unexpectedly. Returning current history.`);
    return { history: history, action: finalFrontendAction };
}