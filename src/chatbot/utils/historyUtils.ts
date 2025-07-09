// src/utils/historyUtils.ts
import fs from 'fs/promises';
import { ChatHistoryItem } from '../shared/types'; // This is your internal type


/**
 * Formats a single chat history entry into a human-readable string.
 */
function formatHistoryEntry(entry: ChatHistoryItem): string {
    const role = entry.role === 'user' ? 'User' : 'Model';
    // Ensure parts is an array and part.text is a string before joining
    const partsText = entry.parts
        ?.filter(part => part && typeof part.text === 'string') // Filter for parts with string text
        .map(part => part.text) // Extract the text
        .join('\n') || ''; // Join, or default to empty string if no valid text parts
    return `${role}:\n${partsText}\n`;
}

/**
 * Saves the given chat history to a specified file path.
 */
async function saveHistoryToFile(history: ChatHistoryItem[], filePath: string): Promise<void> {
    try {
        const formattedHistory = history.map(formatHistoryEntry).join('\n---\n');
        await fs.writeFile(filePath, formattedHistory, 'utf-8');
        
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
    }
}

export { saveHistoryToFile };