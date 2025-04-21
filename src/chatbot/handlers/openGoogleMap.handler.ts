// src/chatbot/handlers/openGoogleMap.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import logToFile from '../utils/logger';



export class OpenGoogleMapHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, socket } = context;
        const location = args?.location as string | undefined;

        logToFile(`[${handlerId} ${socketId}] Handler: OpenGoogleMap, Args: ${JSON.stringify(args)}`);

        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
             if (!socket.connected) return false;
             try {
                 socket.emit('status_update', { type: 'status', step, message, details, timestamp: new Date().toISOString() });
                 return true;
             } catch (error: any) { return false; }
        };

        // 1. Validation
        safeEmitStatus('validating_map_location', 'Validating location argument...', { args });

        if (location && typeof location === 'string' && location.trim() !== '') {
            const trimmedLocation = location.trim();
            logToFile(`[${handlerId} ${socketId}] OpenGoogleMap: Valid location string: ${trimmedLocation}`);

            // 2. Prepare Action (Success Case)
            safeEmitStatus('map_action_prepared', 'Google Maps action prepared.', { location: trimmedLocation });
            return {
                modelResponseContent: `Map action acknowledged. Google Maps will be opened for the location: "${trimmedLocation}".`,
                frontendAction: { type: 'openMap', location: trimmedLocation },
            };
        } else {
            logToFile(`[${handlerId} ${socketId}] OpenGoogleMap: Invalid or missing 'location' argument: ${location}`);

            // 2. Handle Validation Failure
            safeEmitStatus('function_error', 'Invalid location provided for map.', { error: 'Invalid or missing location argument', location });
            return {
                modelResponseContent: `Error: Invalid or missing 'location' argument provided for opening Google Maps. Received: "${location}"`,
                frontendAction: undefined,
            };
        }
    }
}