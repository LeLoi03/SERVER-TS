// src/managers/confirmationManager.ts
import { Socket } from 'socket.io';
import logToFile from '../utils/logger';
import { ConfirmSendEmailAction } from '../shared/types'; // Assuming types are in shared/types
import { executeSendEmailToAdmin } from '../services/sendEmailToAdmin.service'; // Adjust path

// Interface for the stored confirmation data
interface PendingConfirmationInfo {
    details: ConfirmSendEmailAction;
    userToken: string | null;
    socketId: string;
    handlerId: string; // For logging context
    timeoutHandle: NodeJS.Timeout;
    status: 'pending' | 'confirmed' | 'cancelled' | 'timedout' | 'error';
}

// Use a Map to store pending confirmations globally or within a class instance
const pendingEmailConfirmations: Map<string, PendingConfirmationInfo> = new Map();

/**
 * Initiates the email confirmation process.
 * Stores the details and starts the timeout.
 */
export function stageEmailConfirmation(
    payload: ConfirmSendEmailAction,
    userToken: string | null,
    socketId: string,
    handlerId: string,
    io: any // Pass the io instance to potentially emit timeout results
): void {
    const confirmationId = payload.confirmationId;
    logToFile(`[${handlerId} ${socketId}] Staging email confirmation ID: ${confirmationId} with timeout ${payload.timeoutMs}ms`);

    if (pendingEmailConfirmations.has(confirmationId)) {
        logToFile(`[${handlerId} ${socketId}] Warning: Confirmation ID ${confirmationId} already exists. Overwriting.`);
        const existingEntry = pendingEmailConfirmations.get(confirmationId);
        if (existingEntry?.timeoutHandle) {
            clearTimeout(existingEntry.timeoutHandle);
        }
    }

    const timeoutHandle = setTimeout(() => {
        handleEmailConfirmationTimeout(confirmationId, io);
    }, payload.timeoutMs);

    const newEntry: PendingConfirmationInfo = {
        details: payload,
        userToken,
        socketId,
        handlerId,
        timeoutHandle,
        status: 'pending',
    };

    pendingEmailConfirmations.set(confirmationId, newEntry);
    logToFile(`[${handlerId} ${socketId}] Confirmation ${confirmationId} stored. Status: pending.`);
}

/**
 * Handles the timeout for an email confirmation.
 */
export function handleEmailConfirmationTimeout(confirmationId: string, io: any): void {
    const entry = pendingEmailConfirmations.get(confirmationId);

    if (!entry || entry.status !== 'pending') {
        // Already handled (confirmed, cancelled) or doesn't exist
        logToFile(`[Confirmation Timeout] ID ${confirmationId}: Not found or already handled (Status: ${entry?.status}). Ignoring timeout.`);
        return;
    }

    entry.status = 'timedout';
    logToFile(`[${entry.handlerId} ${entry.socketId}] Email confirmation ${confirmationId} timed out.`);

    // Optionally notify the specific client if still connected
    io.to(entry.socketId).emit('email_confirmation_result', {
        confirmationId: confirmationId,
        status: 'timedout',
        message: 'The email confirmation request timed out.',
    });

    // Clean up (remove after a short delay to ensure message delivery if needed, or immediately)
    // We might keep it briefly for debugging or remove immediately
    setTimeout(() => {
        pendingEmailConfirmations.delete(confirmationId);
        logToFile(`[Confirmation Timeout] Cleaned up timed-out entry ${confirmationId}.`);
    }, 5000); // Keep for 5s for potential debugging, then remove
}

/**
 * Handles user confirmation via Socket event.
 */
export async function handleUserEmailConfirmation(confirmationId: string, socket: Socket): Promise<void> {
    const entry = pendingEmailConfirmations.get(confirmationId);
    const socketId = socket.id;

    if (!entry || entry.socketId !== socketId) {
        logToFile(`[User Confirm ${socketId}] Invalid or mismatched confirmation ID: ${confirmationId}. Entry: ${JSON.stringify(entry)}`);
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: 'Invalid or expired confirmation request.',
        });
        return;
    }

     if (entry.status !== 'pending') {
        logToFile(`[User Confirm ${socketId}] Confirmation ID ${confirmationId} already handled (Status: ${entry.status}). Ignoring.`);
         socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: entry.status, // Send current status (e.g., timedout, cancelled)
            message: `This request was already ${entry.status}.`,
        });
        return;
    }


    logToFile(`[${entry.handlerId} ${socketId}] User confirmed email ID: ${confirmationId}. Proceeding to send.`);
    entry.status = 'confirmed'; // Mark as confirmed first
    clearTimeout(entry.timeoutHandle); // Clear the timeout

    try {
        // Actually send the email
        const sendResult = await executeSendEmailToAdmin(entry.details, entry.userToken);

        if (sendResult.success) {
            logToFile(`[${entry.handlerId} ${socketId}] Email ${confirmationId} sent successfully.`);
            socket.emit('email_confirmation_result', {
                confirmationId: confirmationId,
                status: 'success',
                message: `Email with subject "${entry.details.subject}" sent successfully to the administrator.`,
            });
            // --- Here you could potentially trigger a new model turn if needed ---
            // E.g., send a system message back into the chat flow for this socketId
            // sendSystemMessageToChat(socketId, `System: Email with subject "${entry.details.subject}" was sent.`);

        } else {
            logToFile(`[${entry.handlerId} ${socketId}] Failed to send email ${confirmationId}: ${sendResult.message}`);
            entry.status = 'error'; // Mark as error after failed send attempt
            socket.emit('email_confirmation_result', {
                confirmationId: confirmationId,
                status: 'error',
                message: `Failed to send email: ${sendResult.message}`,
            });
        }
    } catch (error: any) {
        logToFile(`[${entry.handlerId} ${socketId}] CRITICAL Error sending email ${confirmationId}: ${error.message}`);
         entry.status = 'error'; // Mark as error
         socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: `An unexpected error occurred while sending the email: ${error.message}`,
        });
    } finally {
         // Clean up the entry after processing
        pendingEmailConfirmations.delete(confirmationId);
        logToFile(`[User Confirm ${socketId}] Cleaned up entry ${confirmationId} after processing (Status: ${entry.status}).`);
    }
}

/**
 * Handles user cancellation via Socket event.
 */
export function handleUserEmailCancellation(confirmationId: string, socket: Socket): void {
     const entry = pendingEmailConfirmations.get(confirmationId);
     const socketId = socket.id;

     if (!entry || entry.socketId !== socketId) {
        logToFile(`[User Cancel ${socketId}] Invalid or mismatched confirmation ID: ${confirmationId}.`);
         socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: 'Invalid or expired confirmation request.',
        });
        return;
    }

     if (entry.status !== 'pending') {
        logToFile(`[User Cancel ${socketId}] Confirmation ID ${confirmationId} already handled (Status: ${entry.status}). Ignoring.`);
         socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: entry.status,
            message: `This request was already ${entry.status}.`,
        });
        return;
    }


    logToFile(`[${entry.handlerId} ${socketId}] User cancelled email ID: ${confirmationId}.`);
    entry.status = 'cancelled';
    clearTimeout(entry.timeoutHandle);

    socket.emit('email_confirmation_result', {
        confirmationId: confirmationId,
        status: 'cancelled',
        message: 'Okay, the email has been cancelled and will not be sent.',
    });

     // Clean up the entry
    pendingEmailConfirmations.delete(confirmationId);
    logToFile(`[User Cancel ${socketId}] Cleaned up cancelled entry ${confirmationId}.`);

     // --- Optionally trigger a model turn ---
     // sendSystemMessageToChat(socketId, `System: Email with subject "${entry.details.subject}" was cancelled by the user.`);
}

// Optional helper function to send a system message back into the chat flow
// This would likely involve calling handleNonStreaming or handleStreaming again
// with a system-originated input. This can be complex.
// function sendSystemMessageToChat(socketId: string, message: string) {
//    logToFile(`[System Msg ${socketId}] TODO: Implement sending "${message}" back to model/chat history.`);
//    // Find the socket, get history, add system message, call handler...
// }