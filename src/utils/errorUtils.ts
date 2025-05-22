// src/utils/errorUtils.ts

/**
 * Extracts error message and stack from an unknown error object.
 * This utility helps in consistently logging and handling errors caught from `try...catch` blocks.
 *
 * @param {unknown} error - The error object caught from a catch block.
 * @returns {{ message: string, stack?: string }} An object containing the error message and optional stack trace.
 */
export function getErrorMessageAndStack(error: unknown): { message: string; stack?: string } {
    if (error instanceof Error) {
        return {
            message: error.message,
            stack: error.stack,
        };
    }
    // If it's not an Error instance, convert it to a string.
    return {
        message: String(error),
        stack: undefined, // No stack if it's not an Error object
    };
}