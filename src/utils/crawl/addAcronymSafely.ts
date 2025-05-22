// src/utils/crawl/addAcronymSafely.ts

import { Mutex } from 'async-mutex';
// import logToFileBase from '../logger'; // Import the base logger
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

const acronymMutex = new Mutex();

/**
 * Adds an acronym to a Set in a thread-safe manner, automatically appending '_N'
 * if the acronym already exists, to ensure uniqueness.
 *
 * @param {Set<string>} set - The Set to which the acronym should be added.
 * @param {string} acronymIndex - The acronym string to add.
 * @param {(message: string) => void} [logFn=logToFileBase] - Optional: A logging function to use (defaults to global logToFile).
 * @returns {Promise<string>} A Promise that resolves with the adjusted (and added) acronym.
 *          Returns an empty string (`""`) if the input is invalid or an unexpected error occurs.
 *          Returns `${baseAcronym}_limit_reached` if the counter exceeds the safety limit.
 */
export const addAcronymSafely = async (
    set: Set<string>,
    acronymIndex: string,
    // logFn: (message: string) => void = logToFileBase // Default to base logger
): Promise<string> => {
    const logContext = `[AcronymUtility][addAcronymSafely][${acronymIndex}]`;

    // Strict input validation
    if (!(set instanceof Set)) {
        // logFn(`[ERROR] ${logContext} Input 'set' is not a valid Set object. Received type: ${typeof set}. Returning empty string.`);
        return "";
    }
    if (typeof acronymIndex !== 'string' || acronymIndex.trim() === '') {
        // logFn(`[ERROR] ${logContext} Input 'acronymIndex' must be a non-empty string. Received value: "${acronymIndex}". Returning empty string.`);
        return "";
    }

    // Use Mutex to ensure only one check-and-add operation occurs at a time
    const release = await acronymMutex.acquire();
    // logFn(`[TRACE] ${logContext} Acquired mutex for acronym check.`);

    try {
        let adjustedAcronym = acronymIndex.trim();
        let counter = 1;
        // Remove existing _N suffix (if any) to get the base acronym
        const baseAcronym = adjustedAcronym.replace(/_\d+$/, '');

        // Start checking from the base acronym
        adjustedAcronym = baseAcronym;

        // Check if the base acronym or its _N versions already exist in the set
        if (set.has(adjustedAcronym)) {
            // logFn(`[DEBUG] ${logContext} Base acronym "${adjustedAcronym}" already exists. Starting conflict resolution.`);
            const MAX_ACRONYM_ATTEMPTS = 10000; // Define a safety limit for counter
            do {
                adjustedAcronym = `${baseAcronym}_${counter}`;
                counter++;
                // Add a safety limit to prevent potential infinite loops
                if (counter > MAX_ACRONYM_ATTEMPTS) {
                    // logFn(`[WARNING] ${logContext} Excessive conflict resolution attempts (${MAX_ACRONYM_ATTEMPTS} reached) for base acronym "${baseAcronym}". Potential infinite loop or very high collision rate. Returning special value.`);
                    return `${baseAcronym}_limit_reached`; // Indicate a severe issue
                }
            } while (set.has(adjustedAcronym));
            // logFn(`[DEBUG] ${logContext} Found non-conflicting acronym "${adjustedAcronym}" for original "${acronymIndex}".`);
        } else {
            // logFn(`[DEBUG] ${logContext} Base acronym "${adjustedAcronym}" does not exist. Using it directly.`);
        }

        // Add the adjusted acronym to the Set
        set.add(adjustedAcronym);
        // logFn(`[INFO] ${logContext} Successfully added acronym "${adjustedAcronym}" to set. Set size: ${set.size}.`);
        return adjustedAcronym; // Return the successfully added acronym

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        // logFn(`[ERROR] ${logContext} An unexpected error occurred within the critical section: "${errorMessage}". Stack: ${errorStack}. Returning empty string.`);
        return ""; // Return empty string on unexpected processing error
    } finally {
        // Always release the mutex, regardless of success or failure
        release();
        // logFn(`[TRACE] ${logContext} Released mutex for acronym check.`);
    }
};