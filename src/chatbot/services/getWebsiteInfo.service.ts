// src/chatbot/services/getWebsiteInfo.service.ts
import logToFile from "../../utils/logger";
import { CONFERENCE_WEBSITE_DESCRIPTION } from "../../config";

// Define the return type structure (you might want a shared types file)
interface WebsiteInfoResult {
    success: boolean;
    data?: string;
    errorMessage?: string;
}

export async function executeGetWebsiteInfo(): Promise<WebsiteInfoResult> {
    const functionName = "executeGetWebsiteInfo"; // For logging context
    try {
        const description = CONFERENCE_WEBSITE_DESCRIPTION;

        if (!description) {
            const errorMsg = "Configuration error: CONFERENCE_WEBSITE_DESCRIPTION environment variable is not set.";
            logToFile(`[${functionName}] Warning: ${errorMsg}`);
            return {
                success: false,
                errorMessage: "Website information configuration is missing. Please contact support." // User-friendly error
            };
        }

        logToFile(`[${functionName}] Successfully retrieved website description from environment variable.`);
        return {
            success: true,
            data: description
        };

    } catch (error: any) {
        const errorMsg = `Unexpected error retrieving website information: ${error.message}`;
        logToFile(`[${functionName}] Error: ${errorMsg}`); // Log the full error object too
        return {
            success: false,
            // Provide a generic error to the model/user, but log the specific one
            errorMessage: `An unexpected error occurred while retrieving website information.`
        };
    }
}
