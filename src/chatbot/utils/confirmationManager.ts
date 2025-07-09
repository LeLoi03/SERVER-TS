// src/chatbot/utils/confirmationManager.ts
import { Socket } from 'socket.io';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility
import { ConfirmSendEmailAction } from '../shared/types'; // Assuming types are in shared/types
import { executeSendEmailToAdmin } from '../services/sendEmailToAdmin.service'; // Adjust path

/**
 * @interface PendingConfirmationInfo
 * Defines the structure for storing information about an email confirmation request
 * that is currently pending user action.
 */
interface PendingConfirmationInfo {
    /** The details of the email to be sent, as provided by the AI. */
    details: ConfirmSendEmailAction;
    /** The authentication token of the user who initiated the request. */
    userToken: string | null;
    /** The Socket.IO ID of the client session. */
    socketId: string;
    /** The unique ID of the handler process that initiated this confirmation request. */
    handlerId: string;
    /** The handle for the setTimeout, allowing it to be cleared if confirmed/cancelled. */
    timeoutHandle: NodeJS.Timeout;
    /** The current status of the confirmation request. */
    status: 'pending' | 'confirmed' | 'cancelled' | 'timedout' | 'error';
}

/**
 * A Map to store pending email confirmation requests.
 * The key is the `confirmationId` from the `ConfirmSendEmailAction`.
 */
const pendingEmailConfirmations: Map<string, PendingConfirmationInfo> = new Map();

/**
 * Stages an email confirmation request, storing its details and setting a timeout.
 * This function is called when the AI requests a user confirmation before sending an email.
 *
 * @param {ConfirmSendEmailAction} payload - The details of the email and confirmation request.
 * @param {string | null} userToken - The authentication token of the user.
 * @param {string} socketId - The Socket.IO ID of the client.
 * @param {string} handlerId - The unique ID of the handler process.
 * @param {any} io - The Socket.IO server instance, used for emitting timeout results.
 */
export function stageEmailConfirmation(
    payload: ConfirmSendEmailAction,
    userToken: string | null,
    socketId: string,
    handlerId: string,
    io: any // Pass the io instance to potentially emit timeout results
): void {
    const confirmationId = payload.confirmationId;
    

    // If a confirmation with this ID already exists, clear its timeout and overwrite it.
    if (pendingEmailConfirmations.has(confirmationId)) {
        
        const existingEntry = pendingEmailConfirmations.get(confirmationId);
        if (existingEntry?.timeoutHandle) {
            clearTimeout(existingEntry.timeoutHandle);
        }
    }

    // Set a timeout for the confirmation. If the user doesn't respond, it will be handled as 'timedout'.
    const timeoutHandle = setTimeout(() => {
        handleEmailConfirmationTimeout(confirmationId, io);
    }, payload.timeoutMs);

    // Create and store the new pending confirmation entry.
    const newEntry: PendingConfirmationInfo = {
        details: payload,
        userToken,
        socketId,
        handlerId,
        timeoutHandle,
        status: 'pending',
    };

    pendingEmailConfirmations.set(confirmationId, newEntry);
    
}

/**
 * Handles the event when an email confirmation request times out.
 * Notifies the client if still connected and cleans up the pending request.
 *
 * @param {string} confirmationId - The ID of the timed-out confirmation request.
 * @param {any} io - The Socket.IO server instance for emitting messages.
 */
export function handleEmailConfirmationTimeout(confirmationId: string, io: any): void {
    const entry = pendingEmailConfirmations.get(confirmationId);

    // If entry not found or already handled (confirmed, cancelled, error), just log and return.
    if (!entry || entry.status !== 'pending') {
        
        return;
    }

    entry.status = 'timedout'; // Update status to timed out
    

    // Emit a result to the specific client if they are still connected.
    if (io.sockets.sockets.get(entry.socketId)) { // Check if socket is still connected
        io.to(entry.socketId).emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'timedout',
            message: 'The email confirmation request timed out. Please try again if you still wish to send it.',
        });
        
    } else {
        
    }

    // Clean up the entry from the map after a short delay to ensure message delivery.
    setTimeout(() => {
        pendingEmailConfirmations.delete(confirmationId);
        
    }, 5000); // Keep for 5 seconds for potential client to receive message, then remove.
}

/**
 * Handles the user's explicit confirmation for sending an email via a Socket event.
 * If confirmed, it attempts to send the email and notifies the user of the result.
 *
 * @param {string} confirmationId - The ID of the confirmation request being handled.
 * @param {Socket} socket - The Socket.IO client socket from which the confirmation was received.
 * @returns {Promise<void>}
 */
export async function handleUserEmailConfirmation(confirmationId: string, socket: Socket): Promise<void> {
    const entry = pendingEmailConfirmations.get(confirmationId);
    const socketId = socket.id;

    // Validate if the entry exists and belongs to the current socket.
    if (!entry || entry.socketId !== socketId) {
        
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: 'Invalid or expired confirmation request. Please try your request again.',
        });
        return;
    }

    // Check if the request has already been handled (e.g., timed out, already confirmed/cancelled).
    if (entry.status !== 'pending') {
        
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: entry.status, // Send back the current status
            message: `This request was already ${entry.status}. No further action taken.`,
        });
        return;
    }

    
    entry.status = 'confirmed'; // Mark as confirmed immediately to prevent re-processing or timeout
    clearTimeout(entry.timeoutHandle); // Clear the associated timeout

    try {
        // Execute the email sending operation.
        const sendResult = await executeSendEmailToAdmin(entry.details, entry.userToken);

        if (sendResult.success) {
            
            socket.emit('email_confirmation_result', {
                confirmationId: confirmationId,
                status: 'success',
                message: `Email with subject "${entry.details.subject}" sent successfully to the administrator.`,
            });
            // Optional: Trigger a new model turn or chat update here if needed,
            // e.g., to inform the AI that the email was sent successfully.
        } else {
            // Email sending failed.
            
            entry.status = 'error'; // Update status to error
            socket.emit('email_confirmation_result', {
                confirmationId: confirmationId,
                status: 'error',
                message: `Failed to send email with subject "${entry.details.subject}": ${sendResult.message}`,
            });
        }
    } catch (error: unknown) { // Catch any unexpected errors during the email sending process
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
        entry.status = 'error'; // Update status to error
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: `An unexpected error occurred while trying to send the email: ${errorMessage}`,
        });
    } finally {
        // Clean up the entry from the map regardless of success or failure.
        pendingEmailConfirmations.delete(confirmationId);
        
    }
}

/**
 * Handles the user's explicit cancellation of an email confirmation via a Socket event.
 * Clears the pending request and notifies the user.
 *
 * @param {string} confirmationId - The ID of the confirmation request being cancelled.
 * @param {Socket} socket - The Socket.IO client socket from which the cancellation was received.
 */
export function handleUserEmailCancellation(confirmationId: string, socket: Socket): void {
    const entry = pendingEmailConfirmations.get(confirmationId);
    const socketId = socket.id;

    // Validate if the entry exists and belongs to the current socket.
    if (!entry || entry.socketId !== socketId) {
        
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: 'error',
            message: 'Invalid or expired confirmation request. Please try your request again.',
        });
        return;
    }

    // Check if the request has already been handled.
    if (entry.status !== 'pending') {
        
        socket.emit('email_confirmation_result', {
            confirmationId: confirmationId,
            status: entry.status,
            message: `This request was already ${entry.status}. No further action taken.`,
        });
        return;
    }

    
    entry.status = 'cancelled'; // Mark as cancelled
    clearTimeout(entry.timeoutHandle); // Clear the associated timeout

    socket.emit('email_confirmation_result', {
        confirmationId: confirmationId,
        status: 'cancelled',
        message: 'Okay, the email has been cancelled and will not be sent.',
    });

    // Clean up the entry from the map.
    pendingEmailConfirmations.delete(confirmationId);
    

    // Optional: Trigger a new model turn or chat update if needed,
    // e.g., to inform the AI that the email was cancelled.
}

// Optional helper function example (not implemented here as it involves complex chat flow integration)
// function sendSystemMessageToChat(socketId: string, message: string) {
//    
//    // This would typically involve finding the relevant handler and injecting a system message
//    // into the conversation history, then potentially triggering a new AI response.
// }