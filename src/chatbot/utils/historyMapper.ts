// // src/chatbot/utils/historyMapper.ts
// import { ChatHistoryItem, ChatMessage } from '../shared/types';
// // Import Part from the new SDK
// import { Part } from '@google/genai';

// /**
//  * Maps an array of internal `ChatHistoryItem` objects (used by the backend/LLM)
//  * to an array of `ChatMessage` objects (suitable for frontend display).
//  *
//  * It filters out history items that do not contain valid text content.
//  *
//  * @param {ChatHistoryItem[]} history - An array of `ChatHistoryItem` objects from the chat history.
//  * @returns {ChatMessage[]} An array of `ChatMessage` objects, ready for frontend consumption.
//  */
// export const mapHistoryToFrontendMessages = (history: ChatHistoryItem[]): ChatMessage[] => {
//     if (!history || !Array.isArray(history)) {
//         console.warn('[historyMapper] mapHistoryToFrontendMessages received invalid history (not an array or null/undefined):', history);
//         return [];
//     }

//     const filteredHistory = history.filter(item => {
//         // Check if item.role exists and item.parts is an array
//         // Then check if any part has a 'text' property that is a non-empty string
//         return item.role &&
//                Array.isArray(item.parts) &&
//                item.parts.some(part => part && typeof part.text === 'string' && part.text.trim() !== '');
//     });

//     return filteredHistory.map((item): ChatMessage | null => {
//         // Find the first part that contains valid text.
//         // The 'part as Part' cast is okay if ChatHistoryItem.parts elements are indeed SDK Parts.
//         const textPart = item.parts?.find(part =>
//             part && typeof part.text === 'string' && part.text.trim() !== ''
//         ) as Part | undefined; // Cast to SDK Part for clarity, or ensure ChatHistoryItem.parts are typed as Part[]

//         if (!textPart || !item.uuid) { // textPart.text will be checked below
//             console.warn('[historyMapper] Skipping history item due to missing text content or UUID:', item);
//             return null;
//         }

//         // textPart is now guaranteed to be a Part with a non-empty text string
//         const messageText = textPart.text!; // Use non-null assertion if find guarantees it due to filter

//         const messageType: ChatMessage['type'] = 'text';

//         return {
//             id: item.uuid,
//             message: messageText,
//             isUser: item.role === 'user',
//             type: messageType,
//             thoughts: undefined,
//             location: undefined,
//             timestamp: item.timestamp || new Date().toISOString(),
//         };
//     }).filter(Boolean) as ChatMessage[];
// };