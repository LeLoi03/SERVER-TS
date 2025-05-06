// src/handlers/openGoogleMap.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed

export class OpenGoogleMapHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;
        const location = args?.location as string | undefined;

        logToFile(`${logPrefix} Handler: OpenGoogleMap, Args: ${JSON.stringify(args)}`);

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
            // --- 1. Validation (Guard Clause) ---
            sendStatus('validating_map_location', 'Validating location argument...', { args });

            // Trim and check if the location is a non-empty string
            const trimmedLocation = location?.trim();
            if (!trimmedLocation) { // Checks for null, undefined, '', or ' '
                const errorMsg = "Invalid or missing 'location' argument.";
                logToFile(`${logPrefix} OpenGoogleMap: Validation Failed - ${errorMsg} Received: "${location}"`);
                sendStatus('function_error', 'Invalid location provided for map.', { error: errorMsg, location });
                return {
                    modelResponseContent: `Error: ${errorMsg} Please provide a valid location for the map. Received: "${location || 'not provided'}"`,
                    frontendAction: undefined,
                };
            }
            // --- Location is now confirmed to be a non-empty string ---

            // --- 2. Prepare Action (Success Case) ---
            logToFile(`${logPrefix} OpenGoogleMap: Valid location string: ${trimmedLocation}`);
            sendStatus('map_action_prepared', 'Google Maps action prepared.', { location: trimmedLocation });

            return {
                modelResponseContent: `Map action acknowledged. Google Maps will be opened for the location: "${trimmedLocation}".`,
                frontendAction: { type: 'openMap', location: trimmedLocation },
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} Error in OpenGoogleMapHandler: ${errorMessage}`);
            // Use optional chaining for sendStatus in catch
            sendStatus?.('function_error', `Error during map processing: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred while preparing the map action: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}