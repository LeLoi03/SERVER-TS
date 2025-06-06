// src/chatbot/handlers/hostAgent.nonStreaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, GenerateContentConfig, Content } from '@google/genai';
import {
    ChatHistoryItem, FrontendAction, Language, AgentId, ThoughtStep, StatusUpdate,
    ResultUpdate, ErrorUpdate, AgentCardRequest, AgentCardResponse, PersonalizationPayload,
    OriginalUserFileInfo
} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

interface NonStreamingHandlerResult {
    history: ChatHistoryItem[];
    action?: FrontendAction;
}

interface RouteToAgentArgs {
    targetAgent: string;
    taskDescription: string;
}

function isRouteToAgentArgs(args: any): args is RouteToAgentArgs {
    if (typeof args !== 'object' || args === null) {
        return false;
    }
    return typeof args.targetAgent === 'string' &&
        typeof args.taskDescription === 'string';
}

export async function handleNonStreaming(
    userInputParts: Part[],
    initialHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string,
        pageContextUrl?: string // <<< THÊM PARAMETER

): Promise<NonStreamingHandlerResult | void> {
    const { geminiServiceForHost, hostAgentGenerationConfig, logToFile, allowedSubAgents, maxTurnsHostAgent, callSubAgentHandler } = deps;
    const socketId = socket.id;
    const conversationIdForSubAgent = handlerId;
    const inputTextSummary = userInputParts.find(p => p.text)?.text || (userInputParts.length > 0 ? `[${userInputParts.length} parts content]` : "[No user text query]");
    const baseLogContext = `[${handlerId} NonStreaming Socket ${socketId}]`;

    logToFile(`--- ${baseLogContext} Handling inputParts: "${inputTextSummary.substring(0, 50)}...", Lang: ${language}` +
        (personalizationData ? `, Personalization: Enabled` : ``) +
        (originalUserFiles && originalUserFiles.length > 0 ? `, Files: ${originalUserFiles.map(f => f.name).join(', ')}` : ``) +
        (pageContextText ? `, PageContext: Present (len ${pageContextText.length})` : ``) + // Log page context
        ` ---`);
    if (personalizationData) logToFile(`[DEBUG ${baseLogContext}] Personalization Data: ${JSON.stringify(personalizationData)}`);

    const currentAgentId: AgentId = 'HostAgent';
    // <<< SỬA ĐỔI ĐỂ TRUYỀN PAGE CONTEXT VÀO LANGUAGE CONFIG >>>
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(
        language, 
        currentAgentId, 
        personalizationData,
        pageContextText // <<< TRUYỀN PAGE CONTEXT
    );
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let historyForApiCall: ChatHistoryItem[] = []; // Sẽ được xây dựng cẩn thận
    let completeHistoryToSave: ChatHistoryItem[] = [...initialHistoryFromSocket];

    // <<< XỬ LÝ PAGE CONTEXT CHO HISTORY API CALL >>>
    if (pageContextText) {
        const pageContextTurn: ChatHistoryItem = {
            role: 'user',
            parts: [{ text: pageContextText }],
            uuid: `context-ns-${handlerId}-${Date.now()}`,
            timestamp: new Date(Date.now() - 1000)
        };
        historyForApiCall.push(pageContextTurn);
        logToFile(`${baseLogContext} Added page context as a pseudo user turn to API history. UUID: ${pageContextTurn.uuid}`);
    }
    historyForApiCall.push(...initialHistoryFromSocket);
    // <<< KẾT THÚC XỬ LÝ PAGE CONTEXT CHO HISTORY API CALL >>>

    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;
    let currentTurn = 1;

    const currentUserTurnForHistory: ChatHistoryItem = {
        role: 'user',
        parts: userInputParts, // userInputParts đã được làm sạch ở message.handler
        timestamp: new Date(),
        uuid: frontendMessageId || `user-ns-${handlerId}-${Date.now()}`,
        userFileInfo: originalUserFiles && originalUserFiles.length > 0 ? originalUserFiles : undefined
    };

    // Logic isEditContextAndUnchanged (cần triển khai nếu muốn tránh xử lý lại tin nhắn edit không đổi)
    let isEditContextAndUnchanged = false;
    if (frontendMessageId && initialHistoryFromSocket.length > 0) {
        // const lastUserMessageInDb = initialHistoryFromSocket.findLast(m => m.role === 'user'); // ES2023
        let lastUserMessageInDb: ChatHistoryItem | undefined;
        for (let i = initialHistoryFromSocket.length - 1; i >= 0; i--) {
            if (initialHistoryFromSocket[i].role === 'user') {
                lastUserMessageInDb = initialHistoryFromSocket[i];
                break;
            }
        }
        if (lastUserMessageInDb && lastUserMessageInDb.uuid === frontendMessageId) {
            // isEditContextAndUnchanged = deepCompare(lastUserMessageInDb.parts, userInputParts); // Cần hàm deepCompare
        }
    }

    
    // Chỉ thêm currentUserTurnForHistory vào completeHistoryToSave nếu nó có nội dung
    // hoặc nếu không có parts nhưng có pageContext
    if (!isEditContextAndUnchanged && (currentUserTurnForHistory.parts.length > 0 || pageContextText)) {
        completeHistoryToSave.push(currentUserTurnForHistory);
        logToFile(`${baseLogContext} User turn added to completeHistoryToSave. UUID: ${currentUserTurnForHistory.uuid}. ` +
            `userFileInfo: ${currentUserTurnForHistory.userFileInfo ? currentUserTurnForHistory.userFileInfo.length + ' files' : 'none'}. ` +
            `Total save history: ${completeHistoryToSave.length}`);
    } else if (!isEditContextAndUnchanged) {
         logToFile(`${baseLogContext} User turn (UUID: ${currentUserTurnForHistory.uuid}) has no parts and no page context, not added to completeHistoryToSave.`);
    } else {
        logToFile(`${baseLogContext} User turn (UUID: ${frontendMessageId}) likely an edit with no content change, not re-added to completeHistoryToSave.`);
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
                dataToSend = { ...dataToSend, thoughts: [...thoughts] }; // Send a copy
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
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return { history: completeHistoryToSave, action: finalFrontendAction };

        let nextTurnInputForHost: Part[] = userInputParts;

        while (currentTurn <= maxTurnsHostAgent) {
            const turnLogContext = `${baseLogContext} Turn ${currentTurn}`;
            const currentApiHistoryForThisCall = [...historyForApiCall]; // Tạo bản sao

            logToFile(`--- ${turnLogContext} Start --- Input type: Part[] length ${nextTurnInputForHost.length}, ` +
                `API History size: ${currentApiHistoryForThisCall.length} ` +
                `(${currentApiHistoryForThisCall.map(m => m.role + (m.userFileInfo ? `[${m.userFileInfo.length}f]` : '')).join(', ')}) ---`);

            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? `Thinking based on previous action (Turn ${currentTurn})...` : 'Thinking...' })) return { history: completeHistoryToSave, action: finalFrontendAction };
            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected before Model call.`); return { history: completeHistoryToSave, action: finalFrontendAction }; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig, systemInstruction: systemInstructions, tools: tools
            };

            const modelResult = await geminiServiceForHost.generateTurn(
                nextTurnInputForHost,
                currentApiHistoryForThisCall, // Sử dụng bản sao
                combinedConfig
            );

            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after Model call.`); return { history: completeHistoryToSave, action: finalFrontendAction }; }

            // Cập nhật historyForApiCall SAU KHI gọi API
            if (currentTurn === 1) {
                if (!isEditContextAndUnchanged && (currentUserTurnForHistory.parts.length > 0 || pageContextText)) {
                    historyForApiCall.push(currentUserTurnForHistory);
                }
            } else {
                const lastFunctionResponseTurnInComplete = completeHistoryToSave.find(
                    (msg, index, arr) => index === arr.length - 1 && msg.role === 'function' && msg.parts[0] === nextTurnInputForHost[0]
                );
                if (lastFunctionResponseTurnInComplete) {
                    historyForApiCall.push(lastFunctionResponseTurnInComplete);
                } else {
                    logToFile(`${turnLogContext} WARNING: Could not find exact function response turn in completeHistoryToSave to add to historyForApiCall (non-streaming).`);
                }
            }
            logToFile(`${turnLogContext} Updated historyForApiCall (after adding current input turn, length ${historyForApiCall.length}): ${historyForApiCall.map(m => m.role + ':' + (m.uuid || 'no-uuid') + (m.userFileInfo ? `[${m.userFileInfo.length}f]` : '')).join(', ')}`);



            if (modelResult.status === "final_text") {
                statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow instructions." : "Okay.");
                const botMessageUuid = uuidv4();
                const modelResponseParts = modelResult.parts || [{ text: finalModelResponseText }];

                 const finalModelTurn: ChatHistoryItem = {
                    role: 'model', 
                    parts: modelResponseParts, 
                    uuid: botMessageUuid, 
                    timestamp: new Date(),
                    sources: [] // Khởi tạo
                };

                // <<< THÊM PAGE CONTEXT URL VÀO SOURCES CỦA MODEL >>>
                if (pageContextUrl && pageContextText) {
                     try {
                        const urlObj = new URL(pageContextUrl);
                        finalModelTurn.sources?.push({
                            name: urlObj.hostname,
                            url: pageContextUrl,
                            type: 'page_context'
                        });
                    } catch (e) {
                        logToFile(`[WARN] ${turnLogContext} Invalid pageContextUrl: ${pageContextUrl}. Cannot extract hostname.`);
                        finalModelTurn.sources?.push({
                            name: pageContextUrl,
                            url: pageContextUrl,
                            type: 'page_context'
                        });
                    }
                }

                completeHistoryToSave.push(finalModelTurn);
                logToFile(`${turnLogContext} Final Text - Appended HostAgent response. Sources: ${JSON.stringify(finalModelTurn.sources)}. Save history: ${completeHistoryToSave.length}`);
                
                const resultPayload: ResultUpdate = { // Sử dụng ResultUpdate đã được cập nhật type
                    type: 'result', 
                    message: finalModelResponseText, 
                    parts: modelResponseParts, 
                    id: botMessageUuid,
                    sources: finalModelTurn.sources // <<< TRUYỀN SOURCES
                };
                safeEmit('chat_result', resultPayload);
                return { history: completeHistoryToSave, action: finalFrontendAction };

            }
            else if (modelResult.status === "error") {
                logToFile(`${turnLogContext} Error - HostAgent model error: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `Error processing your request (Turn ${currentTurn}).`, step: 'host_llm_error' });
                return { history: completeHistoryToSave, action: finalFrontendAction };

            }
            else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                const functionCall = modelResult.functionCall;
                const modelUuid = uuidv4();
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model', parts: [{ functionCall: functionCall }], uuid: modelUuid, timestamp: new Date()
                    // userFileInfo không áp dụng cho model turn
                };

                completeHistoryToSave.push(modelFunctionCallTurn);
                historyForApiCall.push(modelFunctionCallTurn); // Cập nhật historyForApiCall cho lượt API tiếp theo
                logToFile(`${turnLogContext} HostAgent requests function: ${functionCall.name}. Save history: ${completeHistoryToSave.length}, API history: ${historyForApiCall.length}`);

                let functionResponseContentPart: Part; // This will be the single Part for the function's response


                if (functionCall.name === 'routeToAgent') {
                    // Use the type guard here
                    if (isRouteToAgentArgs(functionCall.args)) {
                        const routeArgs = functionCall.args;
                        statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: routeArgs });
                        if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                            functionResponseContentPart = {
                                functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } }
                            };
                        } else {
                            const requestCard: AgentCardRequest = {
                                taskId: uuidv4(),
                                conversationId: conversationIdForSubAgent, // Sử dụng biến đã khai báo
                                senderAgentId: 'HostAgent',
                                receiverAgentId: routeArgs.targetAgent as AgentId, // Already checked it's a string
                                timestamp: new Date().toISOString(), taskDescription: routeArgs.taskDescription, // Already checked it's a string
                                context: { userToken: socket.data.token, language }, // Pass language here
                            };
                            const subAgentResponse: AgentCardResponse = await callSubAgentHandler(requestCard, handlerId, language, socket);
                            if (subAgentResponse.thoughts) thoughts.push(...subAgentResponse.thoughts);

                            if (subAgentResponse.status === 'success') {
                                functionResponseContentPart = {
                                    functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } }
                                };
                                if (subAgentResponse.frontendAction) finalFrontendAction = subAgentResponse.frontendAction;
                            } else {
                                functionResponseContentPart = {
                                    functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } }
                                };
                            }
                        }
                    } else {
                        functionResponseContentPart = {
                            functionResponse: { name: functionCall.name, response: { error: "Routing failed: Invalid or missing arguments for routeToAgent." } }
                        };
                    }
                } else {
                    const errMsg = `Internal config error: HostAgent cannot directly call '${functionCall.name}'.`;
                    functionResponseContentPart = {
                        functionResponse: { name: functionCall.name, response: { error: errMsg } }
                    };
                }

                if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after function execution.`); return { history: completeHistoryToSave, action: finalFrontendAction }; }

                const functionResponseUuid = uuidv4();
                const functionResponseTurnForHistory: ChatHistoryItem = {
                    role: 'function', parts: [functionResponseContentPart], uuid: functionResponseUuid, timestamp: new Date()
                };
                completeHistoryToSave.push(functionResponseTurnForHistory);
                // Lượt function response này sẽ được thêm vào historyForApiCall ở ĐẦU vòng lặp tiếp theo
                // thông qua logic cập nhật historyForApiCall ở trên.
                logToFile(`${turnLogContext} Appended function response for ${functionCall.name}. Save history: ${completeHistoryToSave.length}`);

                nextTurnInputForHost = [functionResponseContentPart];
                currentTurn++;
                continue;
            }
            else { // Không nên xảy ra
                logToFile(`${turnLogContext} Error - HostAgent model unexpected status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return { history: completeHistoryToSave, action: finalFrontendAction };
            }
        } // Kết thúc vòng lặp while

        if (currentTurn > maxTurnsHostAgent) {
            logToFile(`${baseLogContext} Error - Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck in a loop.', step: 'max_turns_exceeded' });
        }
        return { history: completeHistoryToSave, action: finalFrontendAction };
    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
        logToFile(`${baseLogContext} CRITICAL Error - Lang: ${language}] ${errorMsg}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: errorMsg, step: 'unknown_handler_error' });
        return { history: completeHistoryToSave, action: finalFrontendAction };
    } finally {
        logToFile(`--- ${baseLogContext} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}