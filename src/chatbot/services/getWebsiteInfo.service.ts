// src/chatbot/services/getWebsiteInfo.service.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import logToFile from "../../utils/logger"; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility
import { ConfigService } from '../../config/config.service';


const LOG_PREFIX = "[GetWebsiteInfoService]";

// Define the return type structure
// It's good practice to define this in a shared types file (`../shared/types.ts`)
// if it's used across multiple modules. For now, keeping it here as per original.
interface WebsiteInfoResult {
    success: boolean;
    data?: string;
    errorMessage?: string;
}

// --- Get ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Retrieve configuration from ConfigService ---
// Ensure WEBSITE_DESCRIPTION exists in config
const WEBSITE_DESCRIPTION: string | undefined = configService.config.WEBSITE_DESCRIPTION;

// Critical check for WEBSITE_DESCRIPTION at module load time
if (!WEBSITE_DESCRIPTION) {
    const errorMsg = `${LOG_PREFIX} CRITICAL ERROR: WEBSITE_DESCRIPTION is not configured.`;
    logToFile(errorMsg);
    // Throwing an error here will prevent the module from loading
    // and thus prevent the application from starting in an unconfigured state.
    throw new Error(errorMsg);
} else {
    logToFile(`${LOG_PREFIX} WEBSITE_DESCRIPTION configured.`);
}

/**
 * Retrieves general website information from the application's configuration.
 * This service directly accesses a pre-configured description, rather than making an API call.
 *
 * @returns {Promise<WebsiteInfoResult>} A Promise that resolves with an object containing
 *                                      the success status, the website description (if successful),
 *                                      or an error message (if unsuccessful).
 */
export async function executeGetWebsiteInfo(): Promise<WebsiteInfoResult> {
    const functionName = "executeGetWebsiteInfo"; // For logging context within the function
    try {
        const description = WEBSITE_DESCRIPTION; // Already checked for existence at module load

        // While WEBSITE_DESCRIPTION is checked at module load, a redundant check here ensures
        // consistency if the variable state could somehow change, though unlikely in this pattern.
        // Keeping the original 'if (!description)' check as per existing logic.
        if (!description) {
            // This path should ideally not be hit if the module-level check works.
            const errorMsg = "Configuration error: WEBSITE_DESCRIPTION environment variable is not set.";
            logToFile(`[${LOG_PREFIX} ${functionName}] Warning: ${errorMsg}`);
            return {
                success: false,
                errorMessage: "Website information configuration is missing. Please contact support." // User-friendly error
            };
        }

        logToFile(`[${LOG_PREFIX} ${functionName}] Successfully retrieved website description.`);
        return {
            success: true,
            data: description
        };

    } catch (error: unknown) { // Catch as unknown for safer handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`[${LOG_PREFIX} ${functionName}] Unexpected error retrieving website information: ${errorMessage}\nStack: ${errorStack}`);
        return {
            success: false,
            // Provide a generic error to the model/user for security/simplicity,
            // but log the specific internal error for debugging.
            errorMessage: `An unexpected error occurred while retrieving website information.`
        };
    }
}