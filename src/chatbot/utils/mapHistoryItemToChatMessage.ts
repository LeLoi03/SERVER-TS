import { HistoryItem, ChatMessage } from "../shared/types";
import { Part } from "@google/generative-ai";

// Helper function (or place it in a utility file)
export function mapHistoryItemToChatMessage(historyItem: HistoryItem): ChatMessage {
    // Basic mapping, adjust as needed for your ChatMessage structure
    // Ensure ChatMessage in shared/types (backend) matches frontend ChatMessageType closely enough
    let messageText = "";
    if (historyItem.parts && historyItem.parts.length > 0) {
        // Assuming the first part is the text part we care about
        const textPart = historyItem.parts.find(part => 'text' in part) as Part & { text: string } | undefined;
        if (textPart) {
            messageText = textPart.text;
        }
    }

    return {
        id: historyItem.uuid || '', // Use uuid as id
        message: messageText,
        isUser: historyItem.role === 'user',
        type: 'text', // Default to 'text', or determine from historyItem if possible
        timestamp: historyItem.timestamp || new Date().toISOString(),
        // thoughts, action, errorCode would need to be populated if available
        // For editedUserMessage and newBotMessage, these might not have separate thoughts/actions
        // unless your AI handler populates them on the HistoryItem.
    };
}
