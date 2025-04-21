// src/chatbot/handlers/navigation.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import logToFile from '../utils/logger';

export class NavigationHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, socket } = context;
        const targetUrl = args?.url as string | undefined;

        logToFile(`[${handlerId} ${socketId}] Handler: Navigation, Args: ${JSON.stringify(args)}`);

        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
            if (!socket.connected) return false;
            try {
                socket.emit('status_update', { type: 'status', step, message, details, timestamp: new Date().toISOString() });
                return true;
            } catch (error: any) { return false; }
        };

        // 1. Validation
        safeEmitStatus('validating_navigation_url', 'Validating navigation URL argument...', { args });

        if (targetUrl && typeof targetUrl === 'string' && (targetUrl.startsWith('/') || targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
            logToFile(`[${handlerId} ${socketId}] Navigation: Valid target URL: ${targetUrl}`);

            // 2. Prepare Action (Success Case)
            safeEmitStatus('navigation_action_prepared', 'Navigation action prepared.', { url: targetUrl });
            return {
                modelResponseContent: `Navigation action acknowledged. The user will be directed to the requested page (${targetUrl}).`,
                frontendAction: { type: 'navigate', url: targetUrl },
            };
        } else {
            logToFile(`[${handlerId} ${socketId}] Navigation: Invalid or missing 'url' argument: ${targetUrl}`);

            // 2. Handle Validation Failure
            safeEmitStatus('function_error', 'Invalid navigation URL provided.', { error: "Invalid or missing 'url' argument. URL must start with '/' or 'http(s)://'.", url: targetUrl });
            return {
                modelResponseContent: `Error: Invalid or missing 'url' argument provided for navigation. URL must start with '/' or 'http(s)://'. Received: "${targetUrl}"`,
                frontendAction: undefined,
            };
        }
    }
}