// src/handlers/getWebsiteInfo.handler.ts
import { executeGetWebsiteInfo} from '../services/getWebsiteInfo.service'; // Adjust path if needed
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../utils/logger'; // Adjust path if needed

export class GetWebsiteInfoHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, socket } = context;

        logToFile(`[${handlerId} ${socketId}] Handler: GetWebsiteInfo, Args: ${JSON.stringify(args)}`);

        // REMOVED internal safeEmitStatus definition

        try {
            // --- Start Detailed Emits using context.onStatusUpdate ---

            // 1. Validation
             if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_function_args', message: 'Validating arguments for getWebsiteInformation...', details: { args }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
             }

            // 2. Prepare & Execute Call
            if (!onStatusUpdate('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving general website information...', details: { target: 'general website info' }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected before retrieving website info.");
                 logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'retrieving_info' status via callback, but continuing...`);
            }

            // Assuming executeGetWebsiteInformation returns structured result { success: boolean, data?: string, errorMessage?: string }
            const result = await executeGetWebsiteInfo();
            logToFile(`[${handlerId} ${socketId}] API result: Success=${result.success}`);

            // 3. Process Result & Emit Detailed Status via callback
            if (result.success && result.data) {
                onStatusUpdate('status_update', { type: 'status', step: 'data_found', message: 'Successfully retrieved website information.', details: { success: true, infoLength: result.data.length }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: result.data,
                    frontendAction: undefined,
                };
            } else {
                onStatusUpdate('status_update', { type: 'status', step: 'api_call_failed', message: 'Failed to retrieve website information.', details: { error: result.errorMessage || 'Unknown error', success: false }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: result.errorMessage || 'Error: Could not retrieve website information.',
                    frontendAction: undefined,
                };
            }
            // --- End Detailed Emits ---
        } catch (error: any) {
             logToFile(`[${handlerId} ${socketId}] Error in GetWebsiteInfoHandler: ${error.message}`);
             onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Error during website info retrieval: ${error.message}`, timestamp: new Date().toISOString() });
             return { modelResponseContent: `Error executing getWebsiteInformation: ${error.message}`, frontendAction: undefined };
        }
    }
}