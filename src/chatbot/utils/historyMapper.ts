// src/chatbot/utils/historyMapper.ts
import { ChatHistoryItem, ChatMessage } from '../shared/types';
import { Part } from '@google/generative-ai'; // Explicitly import Part if using its type directly

/**
 * Maps an array of internal `ChatHistoryItem` objects (used by the backend/LLM)
 * to an array of `ChatMessage` objects (suitable for frontend display).
 *
 * It filters out history items that do not contain valid text content.
 *
 * @param {ChatHistoryItem[]} history - An array of `ChatHistoryItem` objects from the chat history.
 * @returns {ChatMessage[]} An array of `ChatMessage` objects, ready for frontend consumption.
 */
export const mapHistoryToFrontendMessages = (history: ChatHistoryItem[]): ChatMessage[] => {
    // Robust input validation
    if (!history || !Array.isArray(history)) {
        console.warn('[historyMapper] mapHistoryToFrontendMessages received invalid history (not an array or null/undefined):', history);
        return [];
    }

    // Filter out items that don't have a user or model role with actual text content.
    const filteredHistory = history.filter(item => {
        // Ensure item has a role and at least one part with non-empty text.
        return item.role && item.parts?.some(part => 'text' in part && typeof part.text === 'string' && part.text.trim() !== '');
    });

    // Map filtered history items to ChatMessage format.
    return filteredHistory.map((item): ChatMessage | null => {
        // Find the first part that contains valid text.
        const textPart = item.parts?.find(part =>
            'text' in part && typeof (part as Part & { text: string }).text === 'string' && (part as Part & { text: string }).text.trim() !== ''
        ) as (Part & { text: string }) | undefined;

        // If no valid text part or UUID is missing, this item cannot be mapped to a displayable message.
        if (!textPart || !item.uuid) {
            console.warn('[historyMapper] Skipping history item due to missing text content or UUID:', item);
            return null; // Return null to be filtered out later
        }

        const messageText = textPart.text;

        // Determine the basic message type. For now, assuming all mapped messages are 'text'.
        const messageType: ChatMessage['type'] = 'text';

        // Construct the ChatMessage object.
        return {
            id: item.uuid, // Use the unique ID from the internal ChatHistoryItem
            message: messageText,
            isUser: item.role === 'user',
            type: messageType,
            // These properties are undefined unless explicitly populated later or in another mapping step.
            thoughts: undefined,
            location: undefined,
            timestamp: item.timestamp || new Date().toISOString(), // Use existing timestamp or current
            // Other properties of ChatMessage might be populated based on context or further processing
        };
    }).filter(Boolean) as ChatMessage[]; // Filter out any nulls resulting from invalid items and assert type.
};