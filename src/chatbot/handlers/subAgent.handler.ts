// src/chatbot/handlers/subAgent.handler.ts
import { Socket } from 'socket.io';
import {
    Tool,
    Part,
    GenerateContentConfig,
    FunctionCall // Make sure this is imported
} from '@google/genai';

import {
    ChatHistoryItem,
    StatusUpdate,
    FrontendAction,
    Language,
    AgentCardRequest,
    AgentCardResponse,
    AgentId,
    ThoughtStep,
    FunctionHandlerOutput
} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { executeFunction } from '../gemini/functionRegistry';
import { SubAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

function isValidAgentId(id: string, allowedAgents: AgentId[]): id is AgentId {
    return (allowedAgents as string[]).includes(id);
}

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
        allowedSubAgents
    } = deps;

    const subAgentId = requestCard.receiverAgentId;
    const subHandlerProcessId = `${parentHandlerId}-Sub-${subAgentId}-${Date.now()}`;
    const subAgentLocalThoughts: ThoughtStep[] = [];

    const recordThoughtAndEmitStatus = (step: string, message: string, details?: object): void => {
        const timestamp = new Date().toISOString();
        const thought: ThoughtStep = {
            step,
            message,
            details,
            timestamp,
            agentId: subAgentId,
        };
        subAgentLocalThoughts.push(thought);
        

        if (socket.connected) {
            try {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: subAgentId,
                };
                socket.emit('status_update', statusData);
            } catch (error: unknown) {
                const { message: errMsg } = getErrorMessageAndStack(error);
                
            }
        } else {
            
        }
    };

    recordThoughtAndEmitStatus('sub_agent_validation', `Validating sub-agent ID: ${subAgentId}.`);
    if (!isValidAgentId(subAgentId, allowedSubAgents)) {
        const errorMsg = `Invalid or disallowed sub-agent ID: "${subAgentId}".`;
        
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

    

    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, subAgentId);
    const subAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    if (subAgentTools.length > 0) {
        
    } else {
        
    }

    const taskDesc = requestCard.taskDescription?.trim();
    if (!taskDesc) {
        const errorMsg = `Sub Agent ${subAgentId} received an empty task description for task ID ${requestCard.taskId}.`;
        
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

    const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${taskDesc}\nPlease execute.`;
    const subAgentIsolatedHistory: ChatHistoryItem[] = [];

    let subAgentResultData: any = null;
    let subAgentErrorMessage: string | undefined = undefined;
    let subAgentFrontendAction: FrontendAction | undefined = undefined;
    let subAgentStatus: 'success' | 'error' = 'error';

    const onSubAgentFunctionStatusUpdate = (eventName: 'status_update', data: StatusUpdate): boolean => {
        if (!socket.connected) {
            
            return false;
        }
        try {
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
            socket.emit(eventName, { ...data, agentId: effectiveAgentId, handlerId: effectiveHandlerId });
            return true;
        } catch (error: unknown) {
            const { message: errMsg } = getErrorMessageAndStack(error);
            
            return false;
        }
    };

    try {
        recordThoughtAndEmitStatus('sub_agent_thinking', `Sub Agent ${subAgentId} processing task: ${taskDesc.substring(0, 50)}...`);

        const nextTurnInputForSubAgent: string = subAgentInputText;

        

        const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | import('@google/genai').Content; tools?: Tool[] } = {
            ...subAgentGenerationConfig,
            systemInstruction: systemInstructions,
            tools: subAgentTools
        };

        const subAgentLlmResult = await geminiServiceForSubAgent.generateTurn(
            nextTurnInputForSubAgent,
            subAgentIsolatedHistory,
            combinedConfig
        );

        

        if (subAgentLlmResult.status === "requires_function_call" && subAgentLlmResult.functionCall) {
            const functionCallFromLLM = subAgentLlmResult.functionCall; // This is of type FunctionCall from SDK

            // **FIX APPLIED HERE**
            if (typeof functionCallFromLLM.name === 'string') {
                // Now functionCallFromLLM.name is guaranteed to be a string
                const validFunctionCall = {
                    name: functionCallFromLLM.name,
                    args: functionCallFromLLM.args || {} // Ensure args is an object
                };

                
                recordThoughtAndEmitStatus('sub_agent_function_call_requested', `Sub-agent requested function: ${validFunctionCall.name}`, { functionName: validFunctionCall.name, args: validFunctionCall.args });

                const functionOutput: FunctionHandlerOutput = await executeFunction(
                    validFunctionCall, // Pass the validated object
                    subAgentId,
                    subHandlerProcessId,
                    language,
                    onSubAgentFunctionStatusUpdate,
                    socket,
                    requestCard.context
                );

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
            } else {
                // Handle the case where functionCall.name is undefined (should be rare if model behaves)
                subAgentErrorMessage = `LLM returned a function call without a name.`;
                subAgentStatus = 'error';
                
                recordThoughtAndEmitStatus('sub_agent_llm_error', subAgentErrorMessage, { args: functionCallFromLLM.args });
            }

        } else if (subAgentLlmResult.status === "final_text") {
            subAgentResultData = subAgentLlmResult.text || "Sub agent provided a text response.";
            subAgentStatus = 'success';
            recordThoughtAndEmitStatus('sub_agent_text_response_generated', `Sub Agent ${subAgentId} generated a direct text response.`, { textPreview: String(subAgentResultData)?.substring(0, 100) });
        } else {
            subAgentErrorMessage = subAgentLlmResult.errorMessage || `Error processing task in ${subAgentId}. Unexpected LLM status: ${subAgentLlmResult.status}`;
            subAgentStatus = 'error';
            recordThoughtAndEmitStatus('sub_agent_llm_error', `Sub Agent ${subAgentId} LLM error or unexpected status: ${subAgentErrorMessage}`, { error: subAgentErrorMessage, llmStatus: subAgentLlmResult.status });
        }

    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
        if (!subAgentErrorMessage) {
            subAgentErrorMessage = `An unexpected system error occurred while Sub Agent ${subAgentId} was processing: ${errorMessage}`;
        }
        subAgentStatus = 'error';
        recordThoughtAndEmitStatus('sub_agent_critical_error', `A critical system error occurred while Sub Agent ${subAgentId} was processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
    }

    recordThoughtAndEmitStatus('sub_agent_processing_complete', `Sub Agent ${subAgentId} has completed its task. Final Status: ${subAgentStatus}.`, { finalStatus: subAgentStatus, resultPreview: JSON.stringify(subAgentResultData)?.substring(0, 100) });

    const responseCard: AgentCardResponse = {
        taskId: requestCard.taskId,
        conversationId: requestCard.conversationId,
        senderAgentId: subAgentId,
        receiverAgentId: requestCard.senderAgentId,
        timestamp: new Date().toISOString(),
        status: subAgentStatus,
        resultData: subAgentResultData,
        errorMessage: subAgentErrorMessage,
        frontendAction: subAgentFrontendAction,
        thoughts: subAgentLocalThoughts
    };

    
    return responseCard;
}