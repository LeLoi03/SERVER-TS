// src/chatbot/handlers/getConferences.handler.ts
import { executeGetConferences } from '../services/getConferences.service'; // Corrected path
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import logToFile from '../utils/logger';

export class GetConferencesHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId } = context;
        const searchQuery = args?.searchQuery;
        const dataType = "conference";

        logToFile(`[${handlerId} ${socketId}] Handler: GetConferences, Args: ${JSON.stringify(args)}`);

        // We can keep the status emit helper here or have the registry handle it.
        // Let's keep it simple for now and allow handlers to emit progress if needed.
        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
             if (!context.socket.connected) return false;
             try {
                 context.socket.emit('status_update', { type: 'status', step, message, details });
                 return true;
             } catch (error: any) { return false; }
        };

        if (!safeEmitStatus('retrieving_info', `Retrieving ${dataType} data...`)) {
            return { modelResponseContent: "Error: Disconnected during function execution.", frontendAction: undefined };
        }

        const apiResult = await executeGetConferences(searchQuery);

        logToFile(`[${handlerId} ${socketId}] API result for getConferences('${searchQuery}'): Success=${apiResult.success}, FormattedData=${apiResult.formattedData !== null}, ErrorMsg=${apiResult.errorMessage}`);

        let modelResponseContent: string;
        if (apiResult.success) {
            modelResponseContent = apiResult.formattedData ?? apiResult.rawData;
            if (apiResult.formattedData === null) {
                logToFile(`[${handlerId} ${socketId}] Warning: Formatted data is null for ${dataType}. Sending raw data/error back to model.`);
                if (apiResult.errorMessage) {
                    modelResponseContent = apiResult.errorMessage;
                    safeEmitStatus('function_warning', `Data formatting issue for ${dataType}.`);
                }
            }
        } else {
            modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data.`;
            safeEmitStatus('function_error', `API call failed for ${dataType}.`);
        }

        return {
            modelResponseContent,
            frontendAction: undefined // No frontend action for this function
        };
    }
}