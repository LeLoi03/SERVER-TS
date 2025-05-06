// src/handlers/getConferences.handler.ts
import { executeGetConferences } from '../services/getConferences.service'; 
import { IFunctionHandler } from '../interface/functionHandler.interface'; 
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; 
import logToFile from '../../utils/logger'; 

export class GetConferencesHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "conference"; // Consider making this a const if used elsewhere

        logToFile(`${logPrefix} Handler: GetConferences, Args: ${JSON.stringify(args)}`);

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

            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                const errorMsg = "Missing or empty search query.";
                logToFile(`${logPrefix} GetConferences: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg} Please provide a search query.`, frontendAction: undefined };
            }
            // searchQuery is now confirmed to be a non-empty string

            // --- 2. Prepare & Execute API Call ---
            sendStatus('retrieving_info', `Retrieving ${dataType} data for query: "${searchQuery}"...`, { dataType, searchQuery });

            const apiResult = await executeGetConferences(searchQuery);
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
                    modelResponseContent = apiResult.rawData ?? (apiResult.errorMessage || `Received raw ${dataType} data for "${searchQuery}", but formatting was unavailable.`);
                    const warningMsg = `Data formatting issue for ${dataType}. Displaying raw data or error message.`;
                    logToFile(`${logPrefix} Warning: ${warningMsg}`);
                    sendStatus('function_warning', warningMsg, {
                        rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 100) + '...' : '[object]',
                        errorMessage: apiResult.errorMessage,
                        query: searchQuery
                    });
                    // Still considered a "find" but with issues
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
            logToFile(`${logPrefix} CRITICAL Error in GetConferencesHandler: ${errorMessage}\nStack: ${error.stack}`);
            // Use optional chaining for sendStatus in catch
            sendStatus?.('function_error', `Critical error during ${dataType} retrieval: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred while trying to get conferences: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}