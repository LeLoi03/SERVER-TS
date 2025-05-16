// src/chatbot/handlers/subAgent.handler.ts
import { Socket } from 'socket.io';
import { Tool, Part, GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { HistoryItem, StatusUpdate, FrontendAction, Language, AgentCardRequest, AgentCardResponse, AgentId, ThoughtStep, FunctionHandlerOutput } from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { executeFunction } from '../gemini/functionRegistry';
import { SubAgentHandlerCustomDeps } from './intentHandler.dependencies';

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
        logToFile,
        allowedSubAgents
    } = deps;

    const subAgentId = requestCard.receiverAgentId;
    const subHandlerProcessId = `${parentHandlerId}-Sub-${subAgentId}-${Date.now()}`;
    const socketId = socket.id;
    const subAgentLocalThoughts: ThoughtStep[] = [];

    if (!isValidAgentId(subAgentId, allowedSubAgents)) {
        logToFile(`[${subHandlerProcessId} Socket ${socketId}] CRITICAL: Invalid or disallowed subAgentId: ${subAgentId}`);
        // Return error response
        return {
            taskId: requestCard.taskId, conversationId: requestCard.conversationId,
            senderAgentId: subAgentId, receiverAgentId: requestCard.senderAgentId,
            timestamp: new Date().toISOString(), status: 'error',
            errorMessage: `Sub-agent ID "${subAgentId}" is not valid or not allowed.`,
            thoughts: [{ step: 'sub_agent_validation_failed', message: `Sub-agent ID "${subAgentId}" is not valid or not allowed.`, agentId: subAgentId, timestamp: new Date().toISOString() }]
        };
    }

    logToFile(`--- [${subHandlerProcessId} Socket ${socketId}] Calling Sub Agent: ${subAgentId} using model: ${(geminiServiceForSubAgent as any).modelName}, Task ID: ${requestCard.taskId}, Description: "${requestCard.taskDescription?.substring(0, 50)}..." ---`);
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, subAgentId);
    const subAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    const taskDesc = requestCard.taskDescription?.trim();
    if (!taskDesc) {
        logToFile(`[${subHandlerProcessId} Socket ${socketId}] ERROR: Sub Agent ${subAgentId} received an empty task description for task ID ${requestCard.taskId}.`);
        subAgentLocalThoughts.push({ step: 'sub_agent_input_validation_failed', message: 'Task description cannot be empty.', agentId: subAgentId, timestamp: new Date().toISOString() });
        return {
            taskId: requestCard.taskId, conversationId: requestCard.conversationId,
            senderAgentId: subAgentId, receiverAgentId: requestCard.senderAgentId,
            timestamp: new Date().toISOString(), status: 'error',
            errorMessage: 'Sub-agent task description cannot be empty.',
            thoughts: subAgentLocalThoughts
        };
    }

    const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${taskDesc}\nPlease execute.`;
    // subAgentInputParts[0].text bây giờ chắc chắn là string do taskDesc đã được kiểm tra
    const subAgentInputParts: Part[] = [{ text: subAgentInputText }];
    const subAgentIsolatedHistory: HistoryItem[] = [];

    
    let subAgentResultData: any = null;
    let subAgentErrorMessage: string | undefined = undefined;
    let subAgentFrontendAction: FrontendAction | undefined = undefined;
    let subAgentStatus: 'success' | 'error' = 'error';

    const onSubAgentFunctionStatusUpdate = (eventName: 'status_update', data: StatusUpdate): boolean => {
        // ... (giữ nguyên)
        if (!socket.connected) return false;
        try {
            const effectiveAgentId = data.agentId || subAgentId;
            const thought: ThoughtStep = {
                step: data.step, message: data.message, details: data.details,
                timestamp: data.timestamp || new Date().toISOString(), agentId: effectiveAgentId
            };
            subAgentLocalThoughts.push(thought);
            socket.emit(eventName, { ...data, agentId: effectiveAgentId });
            return true;
        } catch (error: any) {
            logToFile(`[${subHandlerProcessId} SubAgent Emit FAILED - ${socketId}] Event: ${eventName}, Error: ${error.message}`);
            return false;
        }
    };

    try {
        onSubAgentFunctionStatusUpdate('status_update', {
            type: 'status', step: 'sub_agent_thinking',
            message: `Sub Agent ${subAgentId} processing: ${taskDesc.substring(0, 50)}...`,
            agentId: subAgentId
        });

        // *** SỬA LỖI Ở ĐÂY ***
        // Lấy text từ Part và đảm bảo nó là string trước khi truyền
        const firstPart = subAgentInputParts[0];
        let nextTurnInputForSubAgent: string;

        // Mặc dù logic trên đã đảm bảo subAgentInputParts[0].text là string,
        // một kiểm tra tường minh hoặc khẳng định kiểu sẽ làm TypeScript hài lòng hơn.
        if (firstPart && 'text' in firstPart && typeof firstPart.text === 'string' && firstPart.text.trim() !== '') {
            nextTurnInputForSubAgent = firstPart.text;
        } else {
            // Trường hợp này không nên xảy ra nếu logic kiểm tra taskDesc ở trên là đúng.
            // Tuy nhiên, đây là một fallback an toàn.
            logToFile(`[${subHandlerProcessId} Socket ${socketId}] ERROR: Sub Agent ${subAgentId} could not derive a valid text input for LLM. Task ID ${requestCard.taskId}.`);
            subAgentErrorMessage = `Internal error: Could not prepare valid input for sub-agent ${subAgentId}.`;
            subAgentStatus = 'error';
            // Ném lỗi hoặc return sớm để không gọi LLM với input không hợp lệ
            throw new Error(subAgentErrorMessage); // Hoặc return một AgentCardResponse lỗi
        }


        const subAgentLlmResult = await geminiServiceForSubAgent.generateTurn(
            nextTurnInputForSubAgent,   // Bây giờ chắc chắn là string
            subAgentIsolatedHistory,
            subAgentGenerationConfig,
            systemInstructions,
            subAgentTools
        );
        // ... (phần còn lại của try-catch giữ nguyên)
        logToFile(`[${subHandlerProcessId}] LLM result from ${subAgentId}: Status ${subAgentLlmResult.status}`);

        if (subAgentLlmResult.status === "requires_function_call" && subAgentLlmResult.functionCall) {
            const functionCall = subAgentLlmResult.functionCall;
            logToFile(`[${subHandlerProcessId}] ${subAgentId} requests function call: ${functionCall.name}`);

            const functionOutput: FunctionHandlerOutput = await executeFunction(
                functionCall, subAgentId, subHandlerProcessId, language,
                onSubAgentFunctionStatusUpdate, socket, requestCard.context
            );

            if (functionOutput.modelResponseContent && typeof functionOutput.modelResponseContent === 'string' && functionOutput.modelResponseContent.toLowerCase().startsWith('error:')) {
                subAgentErrorMessage = functionOutput.modelResponseContent;
                subAgentStatus = 'error';
            } else {
                subAgentResultData = functionOutput.modelResponseContent;
                subAgentStatus = 'success';
                subAgentFrontendAction = functionOutput.frontendAction;
            }

        } else if (subAgentLlmResult.status === "final_text") {
            subAgentResultData = subAgentLlmResult.text || "Sub agent provided a text response.";
            subAgentStatus = 'success';
            onSubAgentFunctionStatusUpdate('status_update', {
                type: 'status', step: 'sub_agent_text_response_generated',
                message: `Sub Agent ${subAgentId} generated a direct text response.`, agentId: subAgentId
            });
        } else {
            subAgentErrorMessage = subAgentLlmResult.errorMessage || `Error processing task in ${subAgentId}. Status: ${subAgentLlmResult.status}`;
            subAgentStatus = 'error';
            onSubAgentFunctionStatusUpdate('status_update', {
                type: 'status', step: 'sub_agent_llm_error',
                message: `Sub Agent ${subAgentId} LLM error: ${subAgentErrorMessage}`,
                details: { error: subAgentErrorMessage, llmStatus: subAgentLlmResult.status }, agentId: subAgentId
            });
        }

    } catch (error: any) {
        // Nếu lỗi được ném từ kiểm tra `nextTurnInputForSubAgent`, nó sẽ được bắt ở đây.
        // Nếu `subAgentErrorMessage` đã được set trước đó, giữ nguyên nó.
        if (!subAgentErrorMessage) {
            const criticalErrorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`[${subHandlerProcessId}] CRITICAL Error calling Sub Agent ${subAgentId}: ${criticalErrorMsg}\nStack: ${error.stack}`);
            subAgentErrorMessage = `Failed to execute task via ${subAgentId}: ${criticalErrorMsg}`;
            subAgentStatus = 'error'; // Đảm bảo status là error
        }
        // `onSubAgentFunctionStatusUpdate` có thể đã được gọi nếu lỗi xảy ra sau đó
        // Nếu muốn thêm một thought cụ thể cho lỗi này:
        if (error.message.includes("Could not prepare valid input")) { // Kiểm tra thông điệp lỗi cụ thể
             onSubAgentFunctionStatusUpdate('status_update', {
                type: 'status', step: 'sub_agent_input_error',
                message: subAgentErrorMessage,
                details: { error: subAgentErrorMessage }, agentId: subAgentId
            });
        } else {
            onSubAgentFunctionStatusUpdate('status_update', {
                type: 'status', step: 'sub_agent_critical_error',
                message: `A critical error occurred while Sub Agent ${subAgentId} was processing: ${subAgentErrorMessage || error.message}`,
                details: { error: subAgentErrorMessage || error.message }, agentId: subAgentId
            });
        }
    }

    onSubAgentFunctionStatusUpdate('status_update', {
        type: 'status', step: 'sub_agent_processing_complete',
        message: `Sub Agent ${subAgentId} has completed its task. Status: ${subAgentStatus}`,
        details: { finalStatus: subAgentStatus, resultPreview: JSON.stringify(subAgentResultData)?.substring(0, 100) },
        agentId: subAgentId
    });

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

    logToFile(`--- [${subHandlerProcessId}] Sub Agent ${subAgentId} finished. Status: ${responseCard.status}, Thoughts collected: ${subAgentLocalThoughts.length} ---`);
    return responseCard;
}