import { ChatHistoryItem, ChatMessage } from "../shared/types";
import { Part } from "@google/generative-ai";
// import logToFile from '../../utils/logger'; // Uncomment if you want to log missing IDs/text

/**
 * Maps a `ChatHistoryItem` (internal history format, typically for LLM)
 * to a `ChatMessage` (frontend-compatible message format).
 *
 * This function extracts relevant information from the `ChatHistoryItem`
 * to construct a `ChatMessage` object, ensuring compatibility between
 * backend history and frontend display requirements.
 *
 * @param {ChatHistoryItem} historyItem - The history item to map.
 * @returns {ChatMessage} The mapped ChatMessage object.
 */
export function mapHistoryItemToChatMessage(historyItem: ChatHistoryItem): ChatMessage {
    // Basic mapping, adjust as needed for your ChatMessage structure.
    // Ensure ChatMessage in shared/types (backend) matches frontend ChatMessageType closely enough.

    let messageText = "";
    // Check if 'parts' array exists and has elements
    if (historyItem.parts && historyItem.parts.length > 0) {
        // Find the first part that has a 'text' property
        const textPart = historyItem.parts.find((part): part is Part & { text: string } => 
            'text' in part && typeof (part as Part & { text: string }).text === 'string'
        );

        if (textPart) {
            messageText = textPart.text;
        } else {
            // Optional: Log a warning if no text part is found but parts exist
            // logToFile(`[HistoryMapper] Warning: ChatHistoryItem (UUID: ${historyItem.uuid || 'N/A'}) has parts but no text part found.`);
        }
    }

    const messageId = historyItem.uuid || '';
    // Optional: Log a warning if UUID is missing
    // if (!messageId) {
    //     logToFile(`[HistoryMapper] Warning: ChatHistoryItem is missing UUID. Generated ID will be empty string.`);
    // }

    return {
        id: messageId, // Use uuid as id
        message: messageText,
        isUser: historyItem.role === 'user',
        type: 'text', // Default to 'text', or determine from historyItem if possible (e.g., from 'metadata')
        timestamp: historyItem.timestamp || new Date().toISOString(), // Use existing timestamp or current
        // `thoughts`, `action`, `errorCode` would need to be populated if available
        // For `editedUserMessage` and `newBotMessage` (which are typically frontend-only states),
        // these might not have separate `thoughts`/`actions` unless your AI handler populates them on the `ChatHistoryItem`.
        // If these properties are required on ChatMessage and can be derived from ChatHistoryItem,
        // you would add logic here to extract them. For now, they are omitted as per the original structure.
    };
}