// src/handlers/openGoogleMap.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed

export class OpenGoogleMapHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, socket } = context;
        const location = args?.location as string | undefined;

        logToFile(`[${handlerId} ${socketId}] Handler: OpenGoogleMap, Args: ${JSON.stringify(args)}`);

        // REMOVED internal safeEmitStatus definition

        try {
            // --- Start Detailed Emits using context.onStatusUpdate ---

            // 1. Validation
             if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_map_location', message: 'Validating location argument...', details: { args }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
             }

            if (location && typeof location === 'string' && location.trim() !== '') {
                const trimmedLocation = location.trim();
                logToFile(`[${handlerId} ${socketId}] OpenGoogleMap: Valid location string: ${trimmedLocation}`);

                // 2. Prepare Action (Success Case)
                onStatusUpdate('status_update', { type: 'status', step: 'map_action_prepared', message: 'Google Maps action prepared.', details: { location: trimmedLocation }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: `Map action acknowledged. Google Maps will be opened for the location: "${trimmedLocation}".`,
                    frontendAction: { type: 'openMap', location: trimmedLocation },
                };
            } else {
                logToFile(`[${handlerId} ${socketId}] OpenGoogleMap: Invalid or missing 'location' argument: ${location}`);

                // 2. Handle Validation Failure
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Invalid location provided for map.', details: { error: 'Invalid or missing location argument', location }, timestamp: new Date().toISOString() });
                return {
                    modelResponseContent: `Error: Invalid or missing 'location' argument provided for opening Google Maps. Received: "${location}"`,
                    frontendAction: undefined,
                };
            }
            // --- End Detailed Emits ---
        } catch (error: any) {
            logToFile(`[${handlerId} ${socketId}] Error in OpenGoogleMapHandler: ${error.message}`);
            onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Error during map processing: ${error.message}`, timestamp: new Date().toISOString() });
            return { modelResponseContent: `Error executing openGoogleMap: ${error.message}`, frontendAction: undefined };
        }
    }
}