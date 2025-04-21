// src/chatbot/handlers/getWebsiteInfo.handler.ts
import { executeGetWebsiteInfo } from '../services/getWebsiteInfo.service'; // Corrected path
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import logToFile from '../utils/logger';



export class GetWebsiteInfoHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { handlerId, socketId, socket } = context;

        logToFile(`[${handlerId} ${socketId}] Handler: GetWebsiteInfo, Args: {}`); // No specific args expected

        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
            if (!socket.connected) return false;
            try {
                socket.emit('status_update', { type: 'status', step, message, details, timestamp: new Date().toISOString() });
                return true;
            } catch (error: any) { return false; }
        };

        // 1. Prepare & Execute Call
        if (!safeEmitStatus('retrieving_info', 'Retrieving general website information...', { target: 'general website info' })) {
             return { modelResponseContent: "Error: Disconnected during function execution.", frontendAction: undefined };
        }

        // Assuming executeGetWebsiteInformation now returns { success: boolean, data?: string, errorMessage?: string }
        const result = await executeGetWebsiteInfo();

        logToFile(`[${handlerId} ${socketId}] API result for getWebsiteInformation: Success=${result.success}`);


        // 2. Process Result
        if (result.success && result.data) {
             safeEmitStatus('data_found', 'Successfully retrieved website information.', { success: true, infoLength: result.data.length });
            return {
                modelResponseContent: result.data,
                frontendAction: undefined,
            };
        } else {
            safeEmitStatus('api_call_failed', 'Failed to retrieve website information.', { error: result.errorMessage || 'Unknown error', success: false });
            return {
                modelResponseContent: result.errorMessage || 'Error: Could not retrieve website information.',
                frontendAction: undefined,
            };
        }
    }
}
