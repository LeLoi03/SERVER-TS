// src/chatbot/utils/mapHistoryItemToChatMessage.ts
import { ChatHistoryItem, ChatMessage } from "../shared/types";
// Import Part from the new SDK
import { Part } from "@google/genai";
// import logToFile from '../../utils/logger';

/**
 * Maps a `ChatHistoryItem` (internal history format, typically for LLM)
 * to a `ChatMessage` (frontend-compatible message format).
 */
export function mapHistoryItemToChatMessage(historyItem: ChatHistoryItem): ChatMessage {
    let messageText = "";

    if (historyItem.parts && historyItem.parts.length > 0) {
        // Find the first part that has a 'text' property and it's a string
        // The type guard `(part): part is Part & { text: string }` is good if ChatHistoryItem.parts
        // could contain other things. If it's already Part[], a simpler check is fine.
        const textPart = historyItem.parts.find(
            (part): part is (Part & { text: string }) => // Type guard to ensure part has a text string
                part != null && typeof part.text === 'string'
        );

        if (textPart) {
            messageText = textPart.text; // textPart.text is now known to be a string
        } else {
            // logToFile(`[HistoryMapper] Warning: ChatHistoryItem (UUID: ${historyItem.uuid || 'N/A'}) has parts but no text part found.`);
        }
    }

    const messageId = historyItem.uuid || '';
    // if (!messageId) {
    //     logToFile(`[HistoryMapper] Warning: ChatHistoryItem is missing UUID. Generated ID will be empty string.`);
    // }

    return {
        id: messageId,
        message: messageText,
        isUser: historyItem.role === 'user',
        type: 'text',
        timestamp: historyItem.timestamp || new Date().toISOString(),
    };
}