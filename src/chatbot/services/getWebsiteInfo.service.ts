// src/chatbot/services/getWebsiteInfo.service.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import logToFile from "../../utils/logger";
import { ConfigService } from '../../config/config.service';


const LOG_PREFIX = "[GetWebsiteInfoService]";


// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Lấy cấu hình từ ConfigService ---
// Đảm bảo WEBSITE_DESCRIPTION tồn tại trong config
const WEBSITE_DESCRIPTION = configService.config.WEBSITE_DESCRIPTION;
if (!WEBSITE_DESCRIPTION) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: WEBSITE_DESCRIPTION is not configured.`);
    throw new Error("WEBSITE_DESCRIPTION is not configured.");
}

// Define the return type structure (you might want a shared types file)
interface WebsiteInfoResult {
    success: boolean;
    data?: string;
    errorMessage?: string;
}

export async function executeGetWebsiteInfo(): Promise<WebsiteInfoResult> {
    const functionName = "executeGetWebsiteInfo"; // For logging context
    try {
        const description = WEBSITE_DESCRIPTION;

        if (!description) {
            const errorMsg = "Configuration error: WEBSITE_DESCRIPTION environment variable is not set.";
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
