// src/chatbot/handlers/getJournals.handler.ts
import { executeGetJournals } from '../services/getJournals.service'; // Corrected path
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import logToFile from '../utils/logger';


export class GetJournalsHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, socket } = context;
        const searchQuery = args?.searchQuery as string ;
        const dataType = "journal";

        logToFile(`[${handlerId} ${socketId}] Handler: GetJournals, Args: ${JSON.stringify(args)}`);

        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
            if (!socket.connected) return false;
            try {
                socket.emit('status_update', { type: 'status', step, message, details, timestamp: new Date().toISOString() }); // Added timestamp
                return true;
            } catch (error: any) { return false; }
        };

        // 1. Validation (Optional but good practice)
        safeEmitStatus('validating_function_args', 'Validating arguments for getJournals...', { args });
        // Add any specific validation for searchQuery if needed here

        // 2. Prepare & Execute API Call
        if (!safeEmitStatus('retrieving_info', `Retrieving ${dataType} data...`, { dataType, searchQuery: searchQuery || 'N/A' })) {
            return { modelResponseContent: "Error: Disconnected during function execution.", frontendAction: undefined };
        }

        const apiResult = await executeGetJournals(searchQuery);

        logToFile(`[${handlerId} ${socketId}] API result for getJournals('${searchQuery}'): Success=${apiResult.success}, FormattedData=${apiResult.formattedData !== null}, ErrorMsg=${apiResult.errorMessage}`);

        // 3. Process Result
        let modelResponseContent: string;
        if (apiResult.success) {
            modelResponseContent = apiResult.formattedData ?? apiResult.rawData;
            if (apiResult.formattedData === null) {
                logToFile(`[${handlerId} ${socketId}] Warning: Formatted data is null for ${dataType}. Sending raw data/error back to model.`);
                safeEmitStatus('function_warning', `Data formatting issue for ${dataType}. The structure might be unexpected.`, { rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 50) + '...' : '[object]' }); // Send warning
                if (apiResult.errorMessage) { // Prefer specific error message if transformation failed
                    modelResponseContent = apiResult.errorMessage;
                }
            } else {
                 safeEmitStatus('data_found', `Successfully retrieved and processed ${dataType} data.`, { success: true }); // Success step
            }
        } else {
            // API call failed
            modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data.`;
            safeEmitStatus('api_call_failed', `API call failed for ${dataType}.`, { error: apiResult.errorMessage, success: false }); // Failure step
        }

        return {
            modelResponseContent,
            frontendAction: undefined // No frontend action for this function
        };
    }
}