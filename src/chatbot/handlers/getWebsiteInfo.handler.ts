// src/handlers/getWebsiteInfo.handler.ts
import { executeGetWebsiteInfo } from '../services/getWebsiteInfo.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types';
import logToFile from '../../utils/logger';

export class GetWebsiteInfoHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        // Destructure only what's needed. Args might not be used if executeGetWebsiteInfo takes no args.
        const { args, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: GetWebsiteInfo, Args: ${JSON.stringify(args)}`);

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
            // --- 1. Validation (Minimal for this handler) ---
            // Send status indicating validation step, even if no complex validation is done
            sendStatus('validating_function_args', 'Validating arguments for getWebsiteInformation...', { args });
            // Note: No specific argument validation (like searchQuery) seems needed here based on the original code.
            // If there were required args, a Guard Clause would go here.

            // --- 2. Prepare & Execute Call ---
            sendStatus('retrieving_info', 'Retrieving general website information...', { target: 'general website info' });

            // Assuming executeGetWebsiteInfo returns { success: boolean, data?: string, errorMessage?: string }
            // And it doesn't require specific arguments from 'args' based on original call
            const result = await executeGetWebsiteInfo();
            logToFile(`${logPrefix} API result: Success=${result.success}`);

            // --- 3. Process Result ---
            if (result.success && result.data) {
                // Successfully retrieved data
                sendStatus('data_found', 'Successfully retrieved website information.', { success: true, infoLength: result.data.length });
                return {
                    modelResponseContent: result.data,
                    frontendAction: undefined,
                };
            } else {
                // Handle failure: API call failed OR succeeded but returned no data
                const errorMsg = result.errorMessage || 'Failed to retrieve website information (no data or specific error returned).';
                logToFile(`${logPrefix} Failed to retrieve website info: ${errorMsg}`);
                sendStatus('api_call_failed', 'Failed to retrieve website information.', { error: errorMsg, success: result.success }); // Include success status from API if available
                return {
                    modelResponseContent: `Error: ${errorMsg}`,
                    frontendAction: undefined,
                };
            }
        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in GetWebsiteInfoHandler: ${errorMessage}\nStack: ${error.stack}`);
            // Use optional chaining for sendStatus in catch
            sendStatus?.('function_error', `Critical error during website info retrieval: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred while trying to get website information: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}