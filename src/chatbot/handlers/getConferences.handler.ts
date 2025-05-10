// src/chatbot/handlers/getConferences.handler.ts
import { executeGetConferences } from '../services/getConferences.service'; // Điều chỉnh đường dẫn nếu cần
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Điều chỉnh đường dẫn nếu cần
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    StatusUpdate,
    ThoughtStep,
    AgentId // Đảm bảo AgentId được import hoặc định nghĩa
} from '../shared/types'; // Điều chỉnh đường dẫn nếu cần
import logToFile from '../../utils/logger'; // Điều chỉnh đường dẫn nếu cần

export class GetConferencesHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const {
            args,
            handlerId: handlerProcessId, // ID của tiến trình xử lý, không phải ID của Agent
            socketId,
            onStatusUpdate,
            agentId // ID của Sub Agent đang thực thi (ví dụ: 'ConferenceAgent')
        } = context;

        const logPrefix = `[${handlerProcessId} ${socketId} Handler:GetConferences Agent:${agentId}]`;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "conference";
        const localThoughts: ThoughtStep[] = [];

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}`);

        // --- Helper function để gửi status update VÀ thu thập thought ---
        const reportStep = (step: string, message: string, details?: object): void => {
            const timestamp = new Date().toISOString();

            // 1. Thu thập ThoughtStep
            const thought: ThoughtStep = {
                step,
                message,
                details,
                timestamp,
                agentId: agentId // Gắn ID của agent đang thực thi vào thought
            };
            localThoughts.push(thought);
            logToFile(`${logPrefix} Thought added: Step: ${step}, Agent: ${agentId}`);

            // 2. Gửi StatusUpdate (nếu callback tồn tại)
            if (onStatusUpdate) {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: agentId // Gắn ID của agent vào status update để frontend biết
                };
                // Callback `onStatusUpdate` được truyền từ `executeFunction`
                // và đã được bọc để tự động thêm agentId (nếu thiết kế theo cách đó),
                // hoặc chúng ta thêm trực tiếp ở đây.
                // Để nhất quán, hãy đảm bảo agentId được thêm vào statusData.
                onStatusUpdate('status_update', statusData);
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate callback not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation (Guard Clause) ---
            reportStep('validating_function_args', `Validating arguments for getting ${dataType}...`, { args });

            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                const errorMsg = "Missing or empty search query for conferences.";
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                // Ghi lại bước lỗi như một thought
                reportStep('function_error', `Invalid arguments: ${errorMsg}`, { error: errorMsg, args });
                return {
                    modelResponseContent: `Error: ${errorMsg} Please provide a search query for conferences.`,
                    frontendAction: undefined,
                    thoughts: localThoughts // Trả về các thoughts đã thu thập
                };
            }

            // --- 2. Prepare & Execute API Call ---
            reportStep('retrieving_info', `Retrieving ${dataType} data for query: "${searchQuery}"...`, { dataType, searchQuery });

            // Giả sử executeGetConferences là một async call đến service/API
            // Nếu service này có các bước nội bộ, lý tưởng nhất là nó cũng trả về thoughts
            // hoặc gọi một callback để reportStep. Để đơn giản, ta coi nó là một khối.
            const apiResult = await executeGetConferences(searchQuery);
            logToFile(`${logPrefix} API Result: Success=${apiResult.success}, Query="${searchQuery}"`);

            // --- 3. Process Result ---
            let modelResponseContent: string;

            if (apiResult.success) {
                reportStep('api_call_success', `API call for ${dataType} succeeded. Processing data...`, { query: searchQuery });
                if (apiResult.formattedData !== null) {
                    modelResponseContent = apiResult.formattedData;
                    reportStep('data_found', `Successfully retrieved and processed ${dataType} data.`, { success: true, query: searchQuery, resultPreview: modelResponseContent.substring(0,100) + "..."});
                } else {
                    modelResponseContent = apiResult.rawData ?? (apiResult.errorMessage || `Received raw ${dataType} data for "${searchQuery}", but formatting was unavailable.`);
                    const warningMsg = `Data formatting issue for ${dataType}. Displaying raw data or error message.`;
                    logToFile(`${logPrefix} Warning: ${warningMsg}`);
                    reportStep('function_warning', warningMsg, {
                        rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 100) + '...' : '[object]',
                        errorMessage: apiResult.errorMessage,
                        query: searchQuery
                    });
                    // Vẫn coi là tìm thấy dữ liệu, nhưng có vấn đề về định dạng
                    reportStep('data_found', `Retrieved ${dataType} data, but with formatting issues.`, { success: true, formattingIssue: true, query: searchQuery });
                }
            } else {
                // API call failed entirely
                modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data for query: "${searchQuery}".`;
                logToFile(`${logPrefix} API call failed: ${modelResponseContent}`);
                reportStep('api_call_failed', `API call failed for ${dataType}: ${modelResponseContent}`, { error: modelResponseContent, success: false, query: searchQuery });
            }

            // --- 4. Return Result ---
            // Bước cuối cùng trước khi trả về, có thể là "function_result_prepared"
            reportStep('function_result_prepared', `Result for GetConferences prepared.`, { success: apiResult.success });
            return {
                modelResponseContent,
                frontendAction: undefined, // Không có action frontend trực tiếp từ hàm này
                thoughts: localThoughts // Trả về tất cả thoughts đã thu thập
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error: ${errorMessage}\nStack: ${error.stack}`);
            // Ghi lại bước lỗi nghiêm trọng như một thought
            reportStep('function_error', `Critical error during ${dataType} retrieval: ${errorMessage}`, { error: errorMessage });
            return {
                modelResponseContent: `An unexpected error occurred while trying to get conferences: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts // Trả về các thoughts đã thu thập, bao gồm cả thought lỗi
            };
        }
    }
}