// src/handlers/navigation.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed

export class NavigationHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, socket } = context;
        const targetUrl = args?.url as string | undefined;

        logToFile(`[${handlerId} ${socketId}] Handler: Navigation, Args: ${JSON.stringify(args)}`);

        // REMOVED internal safeEmitStatus definition

        try {
            // --- Start Detailed Emits using context.onStatusUpdate ---

            // 1. Validation
             if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_navigation_url', message: 'Validating navigation URL argument...', details: { args }, timestamp: new Date().toISOString() })) {
                  if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
             }

            if (targetUrl && typeof targetUrl === 'string' && (targetUrl.startsWith('/') || targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
                logToFile(`[${handlerId} ${socketId}] Navigation: Valid target URL: ${targetUrl}`);

                // 2. Prepare Action (Success Case)
                onStatusUpdate('status_update', { type: 'status', step: 'navigation_action_prepared', message: 'Navigation action prepared.', details: { url: targetUrl }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: `Navigation action acknowledged. The user will be directed to the requested page (${targetUrl}).`,
                    frontendAction: { type: 'navigate', url: targetUrl },
                };
            } else {
                logToFile(`[${handlerId} ${socketId}] Navigation: Invalid or missing 'url' argument: ${targetUrl}`);

                // 2. Handle Validation Failure
                const errorMsg = "Invalid or missing 'url' argument. URL must start with '/' or 'http(s)://'.";
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Invalid navigation URL provided.', details: { error: errorMsg, url: targetUrl }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: `Error: ${errorMsg} Received: "${targetUrl}"`,
                    frontendAction: undefined,
                };
            }
            // --- End Detailed Emits ---
        } catch (error: any) {
             logToFile(`[${handlerId} ${socketId}] Error in NavigationHandler: ${error.message}`);
             onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Error during navigation processing: ${error.message}`, timestamp: new Date().toISOString() });
             return { modelResponseContent: `Error executing navigation: ${error.message}`, frontendAction: undefined };
        }
    }
}