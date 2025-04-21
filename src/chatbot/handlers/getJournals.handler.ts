// src/handlers/getJournals.handler.ts
import { executeGetJournals } from '../services/getJournals.service'; // Adjust path if needed
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../utils/logger'; // Adjust path if needed

export class GetJournalsHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, socket } = context;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "journal";

        logToFile(`[${handlerId} ${socketId}] Handler: GetJournals, Args: ${JSON.stringify(args)}`);

        // REMOVED internal safeEmitStatus definition

        try {
            // --- Start Detailed Emits using context.onStatusUpdate ---

            // 1. Validation
             if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_function_args', message: 'Validating arguments for getJournals...', details: { args }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
             }
             // Add specific validation if needed

            // 2. Prepare & Execute API Call
            if (!onStatusUpdate('status_update', { type: 'status', step: 'retrieving_info', message: `Retrieving ${dataType} data...`, details: { dataType, searchQuery: searchQuery || 'N/A' }, timestamp: new Date().toISOString() })) {
                if (!socket?.connected) throw new Error(`Client disconnected before retrieving ${dataType} data.`);
                logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'retrieving_info' status via callback, but continuing...`);
            }

            // --- KIỂM TRA SỰ TỒN TẠI VÀ TRẢ VỀ SỚM ---
            if (!searchQuery) {
                const errorMsg = "Missing search query.";
                logToFile(`[${handlerId} ${socketId}] getJournals: Failed: ${errorMsg}`);
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Missing search query.', details: { error: errorMsg, args }, timestamp: new Date().toISOString() });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

            const apiResult = await executeGetJournals(searchQuery);
            logToFile(`[${handlerId} ${socketId}] API result: Success=${apiResult.success}`);

            // 3. Process Result & Emit Detailed Status via callback
            let modelResponseContent: string;
            if (apiResult.success) {
                modelResponseContent = apiResult.formattedData ?? apiResult.rawData;
                 if (apiResult.formattedData === null) {
                    onStatusUpdate('status_update', { type: 'status', step: 'function_warning', message: `Data formatting issue for ${dataType}. The structure might be unexpected.`, details: { rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 50) + '...' : '[object]' }, timestamp: new Date().toISOString() });
                    logToFile(`[${handlerId} ${socketId}] Warning: Formatted data is null for ${dataType}.`);
                    if (apiResult.errorMessage) {
                        modelResponseContent = apiResult.errorMessage;
                    }
                    onStatusUpdate('status_update', { type: 'status', step: 'data_found', message: `Retrieved ${dataType} data, but formatting issue occurred.`, details: { success: true, formattingIssue: true }, timestamp: new Date().toISOString() });
                } else {
                    onStatusUpdate('status_update', { type: 'status', step: 'data_found', message: `Successfully retrieved and processed ${dataType} data.`, details: { success: true }, timestamp: new Date().toISOString() });
                }
            } else {
                modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data.`;
                onStatusUpdate('status_update', { type: 'status', step: 'api_call_failed', message: `API call failed for ${dataType}.`, details: { error: apiResult.errorMessage, success: false }, timestamp: new Date().toISOString() });
            }
            // --- End Detailed Emits ---

            return {
                modelResponseContent,
                frontendAction: undefined
            };
        } catch (error: any) {
             logToFile(`[${handlerId} ${socketId}] Error in GetJournalsHandler: ${error.message}`);
             onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Error during journal retrieval: ${error.message}`, timestamp: new Date().toISOString() });
             return { modelResponseContent: `Error executing getJournals: ${error.message}`, frontendAction: undefined };
        }
    }
}