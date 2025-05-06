// src/handlers/getJournals.handler.ts
import { executeGetJournals } from '../services/getJournals.service'; 
import { IFunctionHandler } from '../interface/functionHandler.interface'; 
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types'; 
import logToFile from '../../utils/logger'; 

export class GetJournalsHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "journal"; // Constant for the data type

        logToFile(`${logPrefix} Handler: GetJournals, Args: ${JSON.stringify(args)}`);

        // --- Helper function để gửi status update ---
        const sendStatus = (step: string, message: string, details?: object) => {
            if (onStatusUpdate) {
                onStatusUpdate('status_update', {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp: new Date().toISOString(),
                });
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation (Guard Clause) ---
            sendStatus('validating_function_args', `Validating arguments for getting ${dataType}...`, { args });

            // Validate that searchQuery is a non-empty string
            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                const errorMsg = "Missing or empty search query.";
                logToFile(`${logPrefix} GetJournals: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg} Please provide a search query for journals.`, frontendAction: undefined };
            }
            // searchQuery is now confirmed to be a non-empty string

            // --- 2. Prepare & Execute API Call ---
            sendStatus('retrieving_info', `Retrieving ${dataType} data for query: "${searchQuery}"...`, { dataType, searchQuery });

            const apiResult = await executeGetJournals(searchQuery);
            logToFile(`${logPrefix} API Result: Success=${apiResult.success}, Query="${searchQuery}"`);

            // --- 3. Process Result ---
            let modelResponseContent: string;

            if (apiResult.success) {
                // Successfully retrieved data, check formatting
                if (apiResult.formattedData !== null) {
                    // Ideal case: data retrieved and formatted
                    modelResponseContent = apiResult.formattedData;
                    sendStatus('data_found', `Successfully retrieved and processed ${dataType} data.`, { success: true, query: searchQuery });
                } else {
                    // Data retrieved but formatting failed or returned null
                    // Use rawData if available, otherwise use errorMessage, otherwise a default message
                    modelResponseContent = apiResult.rawData ?? (apiResult.errorMessage || `Received raw ${dataType} data for "${searchQuery}", but formatting was unavailable.`);
                    const warningMsg = `Data formatting issue for ${dataType}. Displaying raw data or error message.`;
                    logToFile(`${logPrefix} Warning: ${warningMsg}`);
                    sendStatus('function_warning', warningMsg, {
                        rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 100) + '...' : '[object]',
                        errorMessage: apiResult.errorMessage,
                        query: searchQuery
                    });
                    // Still considered "data_found" but with issues
                    sendStatus('data_found', `Retrieved ${dataType} data, but with formatting issues.`, { success: true, formattingIssue: true, query: searchQuery });
                }
            } else {
                // API call failed entirely
                modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data for query: "${searchQuery}".`;
                logToFile(`${logPrefix} API call failed: ${modelResponseContent}`);
                sendStatus('api_call_failed', `API call failed for ${dataType}.`, { error: modelResponseContent, success: false, query: searchQuery });
            }

            // --- 4. Return Result ---
            return {
                modelResponseContent,
                frontendAction: undefined // No direct frontend action needed
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in GetJournalsHandler: ${errorMessage}\nStack: ${error.stack}`);
            // Use optional chaining for sendStatus in catch
            sendStatus?.('function_error', `Critical error during ${dataType} retrieval: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred while trying to get journals: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}